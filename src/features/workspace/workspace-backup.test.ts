import { describe, expect, it, vi } from 'vitest';
import { fresh, type Kind } from '@/features/documents/model';
import { KEY } from '@/features/workspace/workspace-storage';
import { saveDraft, serializeBackup } from '@/features/documents/drafts';
import { issueDocument } from '@/features/documents/document-status';
import { buildFormCatalog } from '@/features/catalogs/form-catalog';
import { createWorkspaceBackup, parseWorkspaceBackup, serializeWorkspaceBackup, restoreWorkspaceBackup,
  workspaceBackupSummary, workspaceSnapshot, WorkspaceRestoreError, WORKSPACE_BACKUP_FORMAT } from '@/features/workspace/workspace-backup';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const api = { getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }) } as unknown as Storage;
  return { data, api };
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
function doc(kind: Kind) {
  const value = fresh(kind);
  Object.assign(value.fields, { seller: 'Seller', sellerPhone: '123', bankAccount: 'BANK', buyer: kind + ' Buyer' });
  Object.assign(value.rows[0], { name: kind + ' Product', code: kind + '-SKU', qty: '2', price: '3', image: png });
  value.logo = png;
  return value;
}
const plan = (api: Storage) => parseWorkspaceBackup(serializeWorkspaceBackup(createWorkspaceBackup(api)));

describe('all business data backups', () => {
  it('round trips all document types, status, images, previous saved copies and defaults without writing during backup', () => {
    const s = storage();
    for (const kind of ['QT', 'PI', 'SC', 'CI', 'PL', 'CD'] as Kind[]) {
      const current = doc(kind);
      s.data.set(KEY + 'draft:' + kind, JSON.stringify(kind === 'QT' ? issueDocument(current, current, 'pdf') : current));
      s.data.set(KEY + 'draft-previous:' + kind, JSON.stringify({ ...current, notes: 'History' }));
    }
    s.data.set(KEY + 'seller', JSON.stringify({ seller: 'Remembered', bankAccount: 'Remembered bank' }));
    s.data.set(KEY + 'settings', JSON.stringify({ language: 'en', layout: 'swiss', theme: '#123456', logo: png, defaults: { currency: 'EUR' } }));
    const backup = createWorkspaceBackup(s.api);
    expect(s.api.setItem).not.toHaveBeenCalled();
    expect(workspaceBackupSummary(backup)).toEqual({ documents: 6, sellers: 1, buyers: 6, products: 6, previous: 6, unreadable: 0 });
    const target = storage();
    restoreWorkspaceBackup(parseWorkspaceBackup(serializeWorkspaceBackup(backup)), workspaceSnapshot(target.api), target.api);
    expect(workspaceSnapshot(target.api)).toEqual(workspaceSnapshot(s.api));
    expect(JSON.parse(target.data.get(KEY + 'draft:QT')!).issued.via).toBe('pdf');
    const restored = ['QT', 'PI', 'SC', 'CI', 'PL', 'CD'].map(kind => JSON.parse(target.data.get(KEY + 'draft:' + kind)!));
    expect(buildFormCatalog(restored, 'products').every(record => record.images[0] === png)).toBe(true);
  });

  it('backs up only business data, leaving unrelated apps, caches and credentials untouched', () => {
    const s = storage({ [KEY + 'draft:QT']: JSON.stringify(doc('QT')), [KEY + 'rates']: '{"rates":{}}',
      [KEY + 'zones']: '["Asia/Dubai"]', [KEY + 'ai-token']: 'private', otherApp: 'untouched' });
    const backup = createWorkspaceBackup(s.api);
    expect(backup.entries.map(entry => entry.key)).toEqual(['draft:QT']);
    const blank = storage();
    restoreWorkspaceBackup(plan(blank.api), workspaceSnapshot(s.api), s.api);
    expect(s.data.get('otherApp')).toBe('untouched'); expect(s.data.get(KEY + 'ai-token')).toBe('private');
    expect(s.data.get(KEY + 'rates')).toBe('{"rates":{}}'); expect(s.data.get(KEY + 'zones')).toBe('["Asia/Dubai"]');
    expect(s.data.has(KEY + 'draft:QT')).toBe(false);
  });

  it('backs up and restores only one rotating previous saved copy per document type, not a full history', () => {
    const s = storage(), first = { ...doc('QT'), notes: 'First save' };
    const second = { ...first, notes: 'Second save' }, third = { ...first, notes: 'Third save' };
    const firstRaw = saveDraft(first, null, s.api);
    const secondRaw = saveDraft(second, firstRaw, s.api);
    const thirdRaw = saveDraft(third, secondRaw, s.api);
    const backup = createWorkspaceBackup(s.api);
    const copies = backup.entries.filter(entry => entry.key.startsWith('draft:') || entry.key.startsWith('draft-previous:'));
    expect(copies).toEqual([
      { key: 'draft:QT', raw: thirdRaw },
      { key: 'draft-previous:QT', raw: secondRaw },
    ]);
    expect(workspaceBackupSummary(backup).previous).toBe(1);
    const target = storage();
    restoreWorkspaceBackup(parseWorkspaceBackup(serializeWorkspaceBackup(backup)), workspaceSnapshot(target.api), target.api);
    expect(target.data.get(KEY + 'draft:QT')).toBe(thirdRaw);
    expect(target.data.get(KEY + 'draft-previous:QT')).toBe(secondRaw);
    expect([...target.data.values()]).not.toContain(firstRaw);
  });

  it('preserves damaged document originals explicitly without pretending they are readable', () => {
    const s = storage({ [KEY + 'draft:QT']: '{broken', [KEY + 'draft-previous:PI']: 'bad history',
      [KEY + 'draft-corrupt:SC']: 'original raw', [KEY + 'draft:CI']: JSON.stringify(doc('CI')) });
    const backup = createWorkspaceBackup(s.api);
    expect(workspaceBackupSummary(backup).unreadable).toBe(3);
    expect(backup.entries.find(entry => entry.key === 'draft:QT')?.unreadable).toBe(true);
    const target = storage();
    restoreWorkspaceBackup(plan(s.api), workspaceSnapshot(target.api), target.api);
    expect(workspaceSnapshot(target.api)).toEqual(workspaceSnapshot(s.api));
  });

  it('supports legacy single-document backups while retaining other types and old versions', () => {
    const original = doc('QT'), incoming = { ...original, notes: 'Imported' };
    const other = JSON.stringify(doc('SC'));
    const s = storage({ [KEY + 'draft:QT']: JSON.stringify(original), [KEY + 'draft:SC']: other,
      [KEY + 'seller']: '{"seller":"Keep"}' });
    const parsed = parseWorkspaceBackup(serializeBackup(incoming));
    expect(parsed.scope).toBe('document');
    restoreWorkspaceBackup(parsed, workspaceSnapshot(s.api), s.api);
    expect(JSON.parse(s.data.get(KEY + 'draft:QT')!).notes).toBe('Imported');
    expect(s.data.get(KEY + 'draft-previous:QT')).toBe(JSON.stringify(original));
    expect(s.data.get(KEY + 'draft:SC')).toBe(other);
    expect(s.data.get(KEY + 'seller')).toBe('{"seller":"Keep"}');
    expect(parseWorkspaceBackup(JSON.stringify(incoming)).scope).toBe('document');
  });

  it.each([
    { format: 'unknown', version: 1, entries: [] },
    { format: WORKSPACE_BACKUP_FORMAT, version: 2, savedAt: new Date().toISOString(), entries: [] },
    { format: WORKSPACE_BACKUP_FORMAT, version: 1, savedAt: 'bad date', entries: [] },
  ])('rejects incompatible envelopes: %s', data => {
    expect(() => parseWorkspaceBackup(JSON.stringify(data))).toThrow();
  });

  it.each(['__proto__', 'ai-token', 'rates', 'draft:UNKNOWN', '../other', 'otherApp'])('rejects unsafe storage keys: %s', key => {
    const backup = createWorkspaceBackup(storage().api);
    expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, entries: [{ key, raw: '{}' }] }))).toThrow('不安全');
  });

  it('rejects duplicate entries, unmarked corrupt documents, external images and invalid settings', () => {
    const backup = createWorkspaceBackup(storage().api);
    const entry = { key: 'draft:QT', raw: JSON.stringify(doc('QT')) };
    for (const entries of [[entry, entry], [{ ...entry, raw: '{broken' }],
      [{ ...entry, raw: JSON.stringify({ ...doc('QT'), logo: 'https://external.example/image' }) }],
      [{ key: 'settings', raw: '{"issued":true}' }], [{ key: 'settings', raw: '{"logo":"https://external.example/logo"}' }],
      [{ key: 'seller', raw: '{"seller":123}' }]]) {
      expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, entries }))).toThrow();
    }
    expect(() => parseWorkspaceBackup('{broken')).toThrow('有效的 JSON');
  });

  it('refuses changes made after file selection before writing anything', () => {
    const s = storage({ [KEY + 'draft:QT']: JSON.stringify(doc('QT')) }), expected = workspaceSnapshot(s.api);
    s.data.set(KEY + 'draft:QT', JSON.stringify({ ...doc('QT'), notes: 'Concurrent update' }));
    const before = [...s.data];
    expect(() => restoreWorkspaceBackup(plan(storage().api), expected, s.api)).toThrow('已发生变化');
    expect([...s.data]).toEqual(before); expect(s.api.setItem).not.toHaveBeenCalled();
  });

  it('rolls back partial writes and removals after a quota failure', () => {
    const s = storage({ [KEY + 'draft:QT']: JSON.stringify(doc('QT')), [KEY + 'draft:SC']: JSON.stringify(doc('SC')) });
    const incoming = storage({ [KEY + 'draft:QT']: JSON.stringify({ ...doc('QT'), notes: 'Replacement' }),
      [KEY + 'draft:PI']: JSON.stringify(doc('PI')) });
    const before = workspaceSnapshot(s.api);
    const failing = { ...s.api, setItem: (key: string, value: string) => {
      if (key === KEY + 'draft:PI') throw Error('quota');
      s.api.setItem(key, value);
    } } as Storage;
    expect(() => restoreWorkspaceBackup(plan(incoming.api), before, failing)).toThrow('已撤回');
    expect(workspaceSnapshot(s.api)).toEqual(before);
  });

  it('reports an incomplete rollback without hiding the need for the downloaded safety backup', () => {
    const s = storage({ [KEY + 'draft:QT']: JSON.stringify(doc('QT')), [KEY + 'draft:SC']: JSON.stringify(doc('SC')) });
    const incoming = storage({ [KEY + 'draft:PI']: JSON.stringify(doc('PI')) });
    const failing = { ...s.api, setItem: () => { throw Error('quota'); } } as Storage;
    try { restoreWorkspaceBackup(plan(incoming.api), workspaceSnapshot(s.api), failing); throw Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(WorkspaceRestoreError);
      expect((error as WorkspaceRestoreError).rollbackSucceeded).toBe(false);
      expect((error as Error).message).toContain('安全备份');
    }
  });

  it('checks each value again during restoration and preserves concurrent external writes', () => {
    const s = storage({ [KEY + 'draft:QT']: JSON.stringify(doc('QT')) });
    const incoming = storage({ [KEY + 'draft:QT']: JSON.stringify({ ...doc('QT'), notes: 'Incoming' }),
      [KEY + 'draft:PI']: JSON.stringify(doc('PI')) });
    const before = workspaceSnapshot(s.api), external = JSON.stringify({ ...doc('PI'), notes: 'Other tab' });
    const concurrent = { ...s.api, setItem: (key: string, value: string) => {
      s.api.setItem(key, value);
      if (key === KEY + 'draft:QT') s.data.set(KEY + 'draft:PI', external);
    } } as Storage;
    expect(() => restoreWorkspaceBackup(plan(incoming.api), before, concurrent)).toThrow('另一标签页');
    expect(s.data.get(KEY + 'draft:QT')).toBe(before['draft:QT']);
    expect(s.data.get(KEY + 'draft:PI')).toBe(external);
  });
});
