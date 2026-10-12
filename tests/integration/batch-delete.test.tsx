import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { deleteDrafts, type DraftDeletion } from '../../src/features/documents/drafts';
import { DocumentLibrary } from '../../src/features/documents/DocumentLibrary';
import { catalogRaw, parseCatalogStore } from '../../src/features/catalogs/catalog-storage';
import { fresh, type Kind } from '../../src/features/documents/model';
import { KEY } from '../../src/features/workspace/workspace-storage';
import { mapStorage } from '../../src/features/workspace/workspace-storage';

function fixture() {
  const data = new Map<string, string>(), api = mapStorage(data, true);
  const records: DraftDeletion[] = [];
  for (const kind of ['QT', 'PI', 'SC'] as Kind[]) {
    const doc = fresh(kind);
    Object.assign(doc.fields, { seller: `${kind} Seller`, buyer: `${kind} Buyer`, number: `${kind}-BATCH` });
    doc.rows[0].name = `${kind} Product`;
    doc.rows[0].code = `${kind}-SKU`;
    if (kind === 'PI') doc.issued = { via: 'pdf', at: '2026-10-11T00:00:00Z' };
    const expectedRaw = JSON.stringify(doc);
    for (const prefix of ['draft:', 'draft-previous:']) data.set(KEY + prefix + kind, expectedRaw);
    data.set(KEY + 'draft-corrupt:' + kind, '{original corrupt copy');
    records.push({ kind, expectedRaw });
  }
  data.set(KEY + 'seller', '{"seller":"Remembered seller"}');
  data.set(KEY + 'settings', '{"language":"both"}');
  return { data, api, records };
}
afterEach(() => vi.unstubAllGlobals());

describe('batch document deletion', () => {
  it('removes selected drafts and issued documents with recovery copies, preserving other documents and independent directories', () => {
    const s = fixture(), before = new Map(s.data);
    deleteDrafts(s.records.slice(0, 2), s.api);
    for (const kind of ['QT', 'PI']) for (const prefix of ['draft:', 'draft-previous:', 'draft-corrupt:'])
      expect(s.data.has(KEY + prefix + kind)).toBe(false);
    for (const [key, raw] of before) if (!key.endsWith('QT') && !key.endsWith('PI')) expect(s.data.get(key)).toBe(raw);
    const copies = parseCatalogStore(catalogRaw(s.api));
    for (const category of ['sellers', 'buyers', 'products'] as const) expect(copies.records[category]).toHaveLength(2);
  });
  it('supports selecting every visible document without recreating empty drafts', () => {
    const s = fixture(); deleteDrafts(s.records, s.api);
    expect([...s.data.keys()].some(key => key.startsWith(KEY + 'draft'))).toBe(false);
    expect(parseCatalogStore(catalogRaw(s.api)).records.products).toHaveLength(3);
  });
  it('makes no storage changes for an empty selection', () => {
    const s = fixture(), before = new Map(s.data); deleteDrafts([], s.api); expect(s.data).toEqual(before);
  });
  it.each(['changed', 'deleted', 'corrupt'] as const)('validates the whole batch before writes when a later record is %s', mode => {
    const s = fixture();
    if (mode === 'deleted') s.data.delete(KEY + 'draft:PI');
    else s.data.set(KEY + 'draft:PI', mode === 'corrupt' ? '{broken' : JSON.stringify({ ...fresh('PI'), notes: 'New update' }));
    if (mode === 'corrupt') s.records[1].expectedRaw = '{broken';
    const before = new Map(s.data);
    expect(() => deleteDrafts(s.records, s.api)).toThrow(); expect(s.data).toEqual(before);
  });
  it('rejects duplicate or unknown types without deleting anything', () => {
    const s = fixture(), before = new Map(s.data);
    expect(() => deleteDrafts([s.records[0], s.records[0]], s.api)).toThrow('重复');
    expect(() => deleteDrafts([...s.records, { kind: 'invalid' as Kind, expectedRaw: '{}' }], s.api)).toThrow('不支持');
    expect(s.data).toEqual(before);
  });
  it('rolls back prior deletions and new directory copies if a later write fails in legacy storage', () => {
    const s = fixture(), before = new Map(s.data);
    const failing = { ...s.api, removeItem(key: string) {
      if (key === KEY + 'draft:PI') throw Error('permission denied');
      s.api.removeItem(key);
    } } as Storage;
    expect(() => deleteDrafts(s.records, failing)).toThrow('已撤回本次批量删除');
    expect(s.data).toEqual(before);
  });
  it('preserves an external edit encountered during a legacy batch, rather than overriding it on rollback', () => {
    const s = fixture(), external = JSON.stringify({ ...fresh('PI'), notes: 'Other tab' });
    const concurrent = { ...s.api, removeItem(key: string) {
      s.api.removeItem(key);
      if (key === KEY + 'draft:QT') s.data.set(KEY + 'draft:PI', external);
    } } as Storage;
    expect(() => deleteDrafts(s.records, concurrent)).toThrow('另一标签页');
    expect(s.data.get(KEY + 'draft:QT')).toBe(s.records[0].expectedRaw);
    expect(s.data.get(KEY + 'draft:PI')).toBe(external);
    expect(s.data.get(KEY + 'draft:SC')).toBe(s.records[2].expectedRaw);
  });
  it('reports incomplete rollback without claiming all records were restored', () => {
    const s = fixture();
    const failing = { ...s.api, removeItem(key: string) {
      if (key === KEY + 'draft:PI') throw Error('remove denied');
      s.api.removeItem(key);
    }, setItem(key: string, value: string) {
      if (key === KEY + 'draft:QT') throw Error('restore denied');
      s.api.setItem(key, value);
    } } as Storage;
    expect(() => deleteDrafts(s.records, failing)).toThrow('部分资料无法恢复');
  });
  it('exposes labeled checkboxes and a disabled bulk action before selection without changing any data', () => {
    const s = fixture(), before = new Map(s.data); vi.stubGlobal('localStorage', s.api);
    const html = renderToStaticMarkup(<DocumentLibrary onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('aria-label="全选当前分类单据"');
    expect(html).toContain('aria-label="选择报价单 QT-BATCH"');
    expect(html).toContain('aria-label="选择PI PI-BATCH"');
    expect(html).toContain('documents-bulk-delete');
    expect(html).toMatch(/disabled=""[^>]*><svg[^]*?删除所选/);
    expect(html).toContain('取消选择'); expect(html).not.toContain('data-variant="destructive"');
    expect(s.data).toEqual(before);
  });
  it('limits the footer to local-storage, backup and deletion warnings', () => {
    const s = fixture(); vi.stubGlobal('localStorage', s.api);
    const html = renderToStaticMarkup(<DocumentLibrary onOpen={() => {}} onCreate={() => {}} />);
    const note = html.match(/<p class="documents-note text-pretty">([^<]*)<\/p>/)?.[1];
    expect(note).toBe('资料仅保存在当前浏览器，请定期备份。删除单据无法撤销，不影响已下载文件及独立资料副本。');
    expect(note).not.toMatch(/全选|切换分类|完整性要求|重新编辑|旧单据/);
  });
});
