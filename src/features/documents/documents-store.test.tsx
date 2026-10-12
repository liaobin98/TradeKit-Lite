import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fresh, types, type Kind } from '@/features/documents/model';
import { KEY } from '@/features/workspace/workspace-storage';
import { mapStorage } from '@/features/workspace/workspace-storage';
import { DOCUMENTS_DATA_KEY, initializeDocuments, newDocument, saveDocument, readDocument, documentRaw, recentDraft, previousDocument, deleteDocuments, parseDocumentsStore, documentsRaw } from '@/features/documents/documents-store';
import { listSavedDocuments, savedDocumentTabs, filterSavedDocuments } from '@/features/documents/saved-documents';
import { DocumentLibrary } from '@/features/documents/DocumentLibrary';
import { DocumentStatus } from '@/features/documents/DocumentStatus';
import { createWorkspaceBackup, workspaceBackupSummary, serializeWorkspaceBackup, parseWorkspaceBackup, restoreWorkspaceBackup, workspaceSnapshot } from '@/features/workspace/workspace-backup';
import { catalogRaw } from '@/features/catalogs/catalog-storage';
import { parseCatalogStore } from '@/features/catalogs/catalog-storage';
import { catalogSourceAvailable, catalogSourceDocumentId } from '@/features/catalogs/form-catalog';
import { serializeBackup } from '@/features/documents/drafts';

function environment() {
  const data = new Map<string, string>(), storage = mapStorage(data, true);
  initializeDocuments(storage);
  return { data, storage };
}
afterEach(() => vi.unstubAllGlobals());

describe('multi-document storage and user-controlled draft state', () => {
  it('resets legacy documents once without clearing independent directories, settings or unrelated data', () => {
    const data = new Map<string, string>(), storage = mapStorage(data, true);
    for (const kind of Object.keys(types)) for (const prefix of ['draft:', 'draft-previous:', 'draft-corrupt:']) data.set(KEY + prefix + kind, 'old original');
    for (const key of ['catalogs', 'seller', 'settings', 'rates']) data.set(KEY + key, `retained ${key}`);
    data.set('another-app', 'retained');
    initializeDocuments(storage);
    expect([...data.keys()].some(key => key.startsWith(KEY + 'draft'))).toBe(false);
    for (const key of ['catalogs', 'seller', 'settings', 'rates']) expect(data.get(KEY + key)).toBe(`retained ${key}`);
    expect(data.get('another-app')).toBe('retained');
    // Reload does not run the reset again.
    data.set(KEY + 'draft:QT', 'created by an old tab');
    initializeDocuments(storage); expect(data.get(KEY + 'draft:QT')).toBe('created by an old tab');
  });
  it.each(Object.keys(types) as Kind[])('retains several %s records independently, even with the same document number', kind => {
    const { storage } = environment(), first = newDocument(kind), second = newDocument(kind);
    first.fields.number = second.fields.number = 'SAME-NUMBER';
    first.fields.buyer = 'First'; second.fields.buyer = 'Second';
    let raw = saveDocument(first, null, storage); saveDocument(second, null, storage);
    raw = saveDocument({ ...first, notes: 'Updated first' }, raw, storage);
    expect(listSavedDocuments(storage).documents).toHaveLength(2);
    expect(documentRaw(first.id!, storage)).toBe(raw);
    expect(readDocument(second.id!, storage)).toEqual(second);
    expect(previousDocument(first.id!, storage)).toEqual(first);
    expect(savedDocumentTabs(listSavedDocuments(storage).documents).find(tab => tab.value === kind)?.count).toBe(2);
  });
  it('allows saving incomplete and invalid numeric content without business validation', () => {
    const { storage } = environment(), document = newDocument('QT');
    document.rows[0].price = '-bad'; document.status = 'saved';
    const raw = saveDocument(document, null, storage);
    expect(readDocument(document.id!, storage)?.status).toBe('saved');
    expect(JSON.parse(raw).rows[0].price).toBe('-bad');
  });
  it('keeps saved records saved after editing and autosaving, and only changes on explicit draft saving', () => {
    const { storage } = environment(), document = newDocument('QT');
    let raw = saveDocument(document, null, storage);
    expect(readDocument(document.id!, storage)?.status).toBe('draft');
    document.status = 'saved'; raw = saveDocument(document, raw, storage, { syncProducts: true });
    document.fields.buyer = 'Edited'; raw = saveDocument(document, raw, storage);
    expect(readDocument(document.id!, storage)?.status).toBe('saved');
    document.status = 'draft'; saveDocument(document, raw, storage, { syncProducts: true });
    expect(readDocument(document.id!, storage)?.status).toBe('draft');
    expect(listSavedDocuments(storage).documents).toHaveLength(1);
  });
  it('restores only the latest corresponding draft, ignoring saved records and other types', () => {
    const { storage } = environment(), old = newDocument('QT'), saved = newDocument('QT'), other = newDocument('PI');
    saveDocument(old, null, storage); saved.status = 'saved';
    saveDocument(saved, null, storage); saveDocument(other, null, storage);
    expect(recentDraft('QT', storage)?.id).toBe(old.id);
    old.status = 'saved'; saveDocument(old, documentRaw(old.id!, storage), storage);
    expect(recentDraft('QT', storage)).toBeNull();
    expect(recentDraft('PI', storage)?.id).toBe(other.id);
  });
  it('uses the same committed records for homepage restoration and the document list after writes and deletion', () => {
    const { storage } = environment(), first = newDocument('QT'), second = newDocument('QT');
    expect(recentDraft('QT', storage)).toBeNull(); expect(listSavedDocuments(storage).documents).toHaveLength(0);
    first.fields.buyer = 'First'; second.fields.buyer = 'Second';
    const raw = saveDocument(first, null, storage); const latest = saveDocument(second, null, storage);
    expect(listSavedDocuments(storage).documents.map(doc => doc.id)).toContain(recentDraft('QT', storage)!.id);
    expect(recentDraft('QT', storage)?.id).toBe(second.id);
    deleteDocuments([{ id: second.id!, expectedRaw: latest }], storage);
    expect(listSavedDocuments(storage).documents).toEqual([first]); expect(recentDraft('QT', storage)).toEqual(first);
    deleteDocuments([{ id: first.id!, expectedRaw: raw }], storage);
    expect(recentDraft('QT', storage)).toBeNull(); expect(listSavedDocuments(storage).documents).toHaveLength(0);
  });
  it('selects the latest edited draft reliably even when saves share the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T00:00:00Z'));
    try {
      const { storage } = environment(), first = newDocument('QT'), second = newDocument('QT');
      const raw = saveDocument(first, null, storage); saveDocument(second, null, storage);
      expect(recentDraft('QT', storage)?.id).toBe(second.id);
      saveDocument({ ...first, notes: 'Newest edit' }, raw, storage);
      expect(recentDraft('QT', storage)?.id).toBe(first.id);
      expect(listSavedDocuments(storage).documents).toHaveLength(2);
    } finally { vi.restoreAllMocks(); }
  });
  it('rejects stale writes but allows independent same-type records to be updated', () => {
    const { storage } = environment(), first = newDocument('QT'), second = newDocument('QT');
    const old = saveDocument(first, null, storage), other = saveDocument(second, null, storage);
    saveDocument({ ...first, notes: 'Other tab' }, old, storage);
    expect(() => saveDocument({ ...first, notes: 'Stale edit' }, old, storage)).toThrow('另一标签页');
    expect(() => saveDocument({ ...second, notes: 'Independent edit' }, other, storage)).not.toThrow();
  });
  it('deletes selected IDs only, preserves same-type neighbors, and never recreates a deleted record', () => {
    const { storage } = environment(), first = newDocument('QT'), second = newDocument('QT');
    const raw = saveDocument(first, null, storage); saveDocument(second, null, storage);
    deleteDocuments([{ id: first.id!, expectedRaw: raw }], storage);
    expect(readDocument(first.id!, storage)).toBeNull(); expect(readDocument(second.id!, storage)).toEqual(second);
    expect(() => saveDocument(first, raw, storage)).toThrow('另一标签页');
  });
  it('validates a whole deletion batch before removing any record', () => {
    const { storage } = environment(), first = newDocument('QT'), second = newDocument('QT');
    const raw = saveDocument(first, null, storage), other = saveDocument(second, null, storage), before = documentsRaw(storage);
    expect(() => deleteDocuments([{ id: first.id!, expectedRaw: raw }, { id: second.id!, expectedRaw: 'stale' }], storage)).toThrow();
    expect(documentsRaw(storage)).toBe(before);
    expect(() => deleteDocuments([{ id: first.id!, expectedRaw: raw }, { id: first.id!, expectedRaw: raw }], storage)).toThrow('重复');
    deleteDocuments([{ id: first.id!, expectedRaw: raw }, { id: second.id!, expectedRaw: other }], storage);
    expect(listSavedDocuments(storage).documents).toEqual([]);
  });
  it('leaves both content and status unchanged when saving the collection fails', () => {
    const { storage } = environment(), document = newDocument('QT');
    const raw = saveDocument(document, null, storage), before = catalogRaw(storage);
    const failing = { ...storage, setItem: (key: string, value: string) => {
      if (key === KEY + DOCUMENTS_DATA_KEY) throw Error('quota'); storage.setItem(key, value);
    } } as Storage;
    expect(() => saveDocument({ ...document, status: 'saved', fields: { ...document.fields, seller: 'Uncommitted' } }, raw, failing)).toThrow('quota');
    expect(documentRaw(document.id!, storage)).toBe(raw); expect(catalogRaw(storage)).toBe(before);
  });
  it('does not overwrite a damaged collection during initialization', () => {
    const { storage } = environment(); storage.setItem(KEY + DOCUMENTS_DATA_KEY, '{broken');
    expect(() => initializeDocuments(storage)).toThrow(); expect(documentsRaw(storage)).toBe('{broken');
    expect(() => parseDocumentsStore('{"version":1,"records":[]}')).toThrow();
  });
});

describe('multi-document lists and backups', () => {
  it('opens the exact directory source even when two same-type documents share a number', () => {
    const { storage } = environment(), first = newDocument('QT'), second = newDocument('QT');
    first.fields.number = second.fields.number = 'SHARED-NUMBER';
    Object.assign(first.rows[0], { name: 'Product', code: 'SKU' });
    Object.assign(second.rows[0], { name: 'Product', code: 'SKU' });
    saveDocument(first, null, storage, { syncProducts: true }); saveDocument(second, null, storage, { syncProducts: true });
    const product = parseCatalogStore(catalogRaw(storage)).records.products[0], source = product.sources[0];
    expect(source.documentId).toBe(second.id);
    expect(catalogSourceDocumentId(product, source, [first, second])).toBe(second.id);
    expect(catalogSourceAvailable(product, source, [first])).toBe(false);
  });
  it('shows all same-type records and only draft labels, never a saved/issued label', () => {
    const { storage } = environment(), draft = newDocument('QT'), saved = newDocument('QT');
    draft.fields.number = 'FIRST-QT'; saved.fields.number = 'SECOND-QT'; saved.status = 'saved';
    saveDocument(draft, null, storage); saveDocument(saved, null, storage);
    vi.stubGlobal('localStorage', storage);
    const html = renderToStaticMarkup(<DocumentLibrary onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('FIRST-QT'); expect(html).toContain('SECOND-QT'); expect(html).toContain('报价单 (2)');
    expect(renderToStaticMarkup(<DocumentStatus doc={draft} />)).toContain('草稿');
    expect(renderToStaticMarkup(<DocumentStatus doc={saved} />)).toBe('');
    expect(html).not.toMatch(/已出单|已定稿|正式单/);
    expect(filterSavedDocuments(listSavedDocuments(storage).documents, 'QT')).toHaveLength(2);
  });
  it('backs up and restores all IDs, statuses, images and per-record recovery copies', () => {
    const { storage } = environment(), first = newDocument('QT'), second = newDocument('QT');
    first.logo = 'data:image/png;base64,AAAA'; second.status = 'saved';
    const raw = saveDocument(first, null, storage); saveDocument({ ...first, notes: 'Edited' }, raw, storage);
    saveDocument(second, null, storage);
    const backup = createWorkspaceBackup(storage), target = environment().storage;
    expect(workspaceBackupSummary(backup)).toMatchObject({ documents: 2, previous: 1 });
    restoreWorkspaceBackup(parseWorkspaceBackup(serializeWorkspaceBackup(backup)), workspaceSnapshot(target), target);
    expect(documentsRaw(target)).toBe(documentsRaw(storage));
    expect(readDocument(second.id!, target)?.status).toBe('saved');
  });
  it('imports a single older backup as an additional document, without overwriting same-type records', () => {
    const { storage } = environment(), current = newDocument('QT'); saveDocument(current, null, storage);
    const incoming = fresh('QT'); incoming.fields.buyer = 'Imported';
    const plan = parseWorkspaceBackup(serializeBackup(incoming));
    restoreWorkspaceBackup(plan, workspaceSnapshot(storage), storage);
    const documents = listSavedDocuments(storage).documents;
    expect(documents).toHaveLength(2); expect(readDocument(current.id!, storage)).toEqual(current);
    expect(documents.some(doc => doc.fields.buyer === 'Imported' && doc.id !== current.id)).toBe(true);
  });
});
