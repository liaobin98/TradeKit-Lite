import { describe, expect, it, vi } from 'vitest';
import { fresh, type Doc } from '@/features/documents/model';
import { KEY } from '@/features/workspace/workspace-storage';
import { saveDraft, deleteDraft, deleteDrafts } from '@/features/documents/drafts';
import { catalogRaw, emptyCatalogStore, parseCatalogStore, deleteCatalogRecords, captureCatalogDocuments } from '@/features/catalogs/catalog-storage';
import { buildFormCatalog, catalogValue } from '@/features/catalogs/form-catalog';
import { readSavedCatalogs } from '@/features/catalogs/catalog-sync';
import { readLookupCatalog, applyCatalogSelection, catalogSelections } from '@/features/catalogs/catalog-lookup';
import { catalogIdentity } from '@/features/catalogs/catalog-identity';
import { createWorkspaceBackup, parseWorkspaceBackup, serializeWorkspaceBackup, restoreWorkspaceBackup, workspaceSnapshot } from '@/features/workspace/workspace-backup';

function storage() {
  const data = new Map<string, string>();
  const api = { getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: (key: string) => { data.delete(key); } } as unknown as Storage;
  return { data, api };
}
function product(kind: Doc['kind'] = 'QT') {
  const doc = fresh(kind);
  Object.assign(doc.rows[0], { name: 'P1', code: 'P1', spec: '', price: '10', image: 'data:image/png;base64,AAAA' });
  doc.fields.currency = 'USD';
  return doc;
}
const products = (api: Storage) => readSavedCatalogs(api).store.records.products;
const autosave = (doc: Doc, raw: string | null, api: Storage) => saveDraft(doc, raw, api, { syncProducts: false });

describe('confirmed product snapshots', () => {
  it('publishes output products without replacing independent seller or buyer information', () => {
    const original = product(); original.fields.seller = 'Company'; original.fields.sellerPhone = 'Latest phone'; original.fields.buyer = 'Buyer';
    const store = captureCatalogDocuments(emptyCatalogStore(), [original]);
    const output = structuredClone(original); output.fields.sellerPhone = 'Older exported phone'; output.rows[0].spec = 'Output spec';
    const next = captureCatalogDocuments(store, [output], 'current', 'latest', true, ['products']);
    expect(next.records.sellers).toEqual(store.records.sellers); expect(next.records.buyers).toEqual(store.records.buyers);
    expect(catalogValue(next.records.products[0], 'spec')).toBe('Output spec');
  });
  it('keys products by trimmed exact SKU, updating names, specifications, units and images rather than adding variants', () => {
    const s = storage(), doc = product(); let raw = saveDraft(doc, null, s.api);
    const id = products(s.api)[0].id;
    for (const spec of ['1111', '2222', '']) {
      Object.assign(doc.rows[0], { name: 'Renamed', spec, unit: 'box', image: spec ? 'data:image/png;base64,BBBB' : '' });
      raw = saveDraft(doc, raw, s.api);
      const list = products(s.api);
      expect(list).toHaveLength(1); expect(list[0].id).toBe(id);
      expect(catalogValue(list[0], 'name')).toBe('Renamed'); expect(catalogValue(list[0], 'spec')).toBe(spec);
      expect(catalogValue(list[0], 'unit')).toBe('box'); expect(list[0].images).toEqual(spec ? ['data:image/png;base64,BBBB'] : []);
      expect(list[0].sources[0].row?.spec).toBe(spec);
    }
    doc.rows[0].code = '  P1  '; raw = saveDraft(doc, raw, s.api);
    expect(products(s.api)).toHaveLength(1);
    doc.rows[0].code = 'p1'; saveDraft(doc, raw, s.api);
    expect(products(s.api)).toHaveLength(2);
  });
  it('keeps auto-saved intermediate names, SKU and specifications out of directory reads and lookup', () => {
    const s = storage(), doc = product(); let raw = autosave(doc, null, s.api);
    for (const edit of [{ spec: '1111' }, { name: 'P2' }, { code: 'P2' }]) {
      Object.assign(doc.rows[0], edit); raw = autosave(doc, raw, s.api);
      expect(products(s.api)).toEqual([]); expect(readLookupCatalog('products', s.api)).toEqual([]);
      expect(parseCatalogStore(catalogRaw(s.api)).version).toBe(3);
    }
    expect(JSON.parse(raw).rows[0]).toMatchObject({ name: 'P2', code: 'P2', spec: '1111' });
    saveDraft(doc, raw, s.api); // Explicit save after autosave, with unchanged JSON.
    expect(products(s.api)).toHaveLength(1); expect(products(s.api)[0].title).toBe('P2');
    expect(catalogValue(products(s.api)[0], 'code')).toBe('P2');
  });
  it('does not alter the confirmed catalog during later autosaves, route flushes, reads or source deletion', () => {
    const s = storage(), doc = product(); let raw = saveDraft(doc, null, s.api);
    const before = products(s.api);
    Object.assign(doc.rows[0], { name: 'P2', code: 'P2', spec: 'Unconfirmed' });
    raw = autosave(doc, raw, s.api);
    for (let index = 0; index < 3; index++) expect(products(s.api)).toEqual(before);
    deleteDraft('QT', raw, s.api);
    expect(products(s.api)).toEqual(before);
  });
  it('does not collect unconfirmed products when an auto-saved source is deleted singly or in a batch', () => {
    const s = storage(), first = product(), second = product('PI'); second.rows[0].code = 'P2';
    const firstRaw = autosave(first, null, s.api), secondRaw = autosave(second, null, s.api);
    deleteDrafts([{ kind: 'QT', expectedRaw: firstRaw }, { kind: 'PI', expectedRaw: secondRaw }], s.api);
    expect(products(s.api)).toEqual([]);
  });
  it('uses confirmation order across document types without changing any already saved document', () => {
    const s = storage(), qt = product(), pi = product('PI');
    const qtRaw = saveDraft(qt, null, s.api); pi.rows[0].spec = 'PI';
    const piRaw = saveDraft(pi, null, s.api);
    expect(products(s.api)).toHaveLength(1); expect(catalogValue(products(s.api)[0], 'spec')).toBe('PI');
    qt.rows[0].spec = 'QT newest'; const latest = saveDraft(qt, qtRaw, s.api);
    expect(catalogValue(products(s.api)[0], 'spec')).toBe('QT newest');
    expect(s.data.get(KEY + 'draft:PI')).toBe(piRaw);
    expect(JSON.parse(piRaw).rows[0].spec).toBe('PI');
    deleteDraft('QT', latest, s.api); deleteDraft('PI', piRaw, s.api);
    expect(products(s.api)).toHaveLength(1); expect(catalogValue(products(s.api)[0], 'spec')).toBe('QT newest');
  });
  it('keeps independent products with different SKUs even if their names match', () => {
    const s = storage(), doc = product(); let raw = saveDraft(doc, null, s.api);
    doc.rows[0].code = 'P2'; raw = saveDraft(doc, raw, s.api);
    expect(products(s.api)).toHaveLength(2);
    deleteDraft('QT', raw, s.api); expect(products(s.api)).toHaveLength(2);
  });
  it('preserves existing historical duplicates until explicit saves update one matching copy without appending another', () => {
    const s = storage(), doc = product();
    const first = buildFormCatalog([doc], 'products')[0];
    first.id = catalogIdentity(JSON.stringify(['products', ...first.fields.map(field => field.value)]));
    doc.rows[0].spec = '1111'; const second = buildFormCatalog([doc], 'products')[0];
    second.id = catalogIdentity(JSON.stringify(['products', ...second.fields.map(field => field.value)]));
    const legacy = { ...emptyCatalogStore(), version: 2, records: { sellers: [], buyers: [], products: [first, second] } };
    s.data.set(KEY + 'catalogs', JSON.stringify(legacy));
    const raw = JSON.stringify(doc); s.data.set(KEY + 'draft:QT', raw);
    expect(products(s.api)).toEqual([first, second]);
    doc.rows[0].spec = 'Newest'; saveDraft(doc, raw, s.api);
    const list = products(s.api);
    expect(list).toHaveLength(2); expect(list[0]).toEqual(first);
    expect(list[1].id).toBe(second.id); expect(catalogValue(list[1], 'spec')).toBe('Newest');
  });
  it('prevents deleted SKUs from returning after confirmed edits change name, spec, unit or picture', () => {
    const s = storage(), doc = product(); const raw = saveDraft(doc, null, s.api);
    deleteCatalogRecords('products', [products(s.api)[0].id], catalogRaw(s.api)!, s.api);
    Object.assign(doc.rows[0], { name: 'Renamed', spec: 'Other', unit: 'box', image: '' });
    saveDraft(doc, raw, s.api); expect(products(s.api)).toEqual([]);
  });
  it('also prevents a deleted legacy copy from returning under a new SKU identity', () => {
    const s = storage(), doc = product(), record = buildFormCatalog([doc], 'products')[0];
    record.id = catalogIdentity(JSON.stringify(['products', ...record.fields.map(field => field.value)]));
    const store = emptyCatalogStore(); store.records.products = [record];
    s.data.set(KEY + 'catalogs', JSON.stringify(store));
    deleteCatalogRecords('products', [record.id], catalogRaw(s.api)!, s.api);
    doc.rows[0].spec = 'Changed'; saveDraft(doc, null, s.api);
    expect(products(s.api)).toEqual([]);
  });
  it('restores backups with an empty confirmed catalog without collecting the autosaved draft', () => {
    const source = storage(), doc = product(); autosave(doc, null, source.api);
    const plan = parseWorkspaceBackup(serializeWorkspaceBackup(createWorkspaceBackup(source.api))), target = storage();
    restoreWorkspaceBackup(plan, workspaceSnapshot(target.api), target.api);
    expect(products(target.api)).toEqual([]);
    expect(target.data.get(KEY + 'draft:QT')).toBe(JSON.stringify(doc));
  });
  it('does not update a product if the draft write fails, and allows retry after restoring storage', () => {
    const s = storage(), doc = product(); const raw = saveDraft(doc, null, s.api), before = catalogRaw(s.api);
    doc.rows[0].spec = 'Uncommitted';
    vi.mocked(s.api.setItem).mockImplementation((key, value) => { if (key === KEY + 'draft:QT') throw Error('quota'); s.data.set(key, value); });
    expect(() => saveDraft(doc, raw, s.api)).toThrow('quota');
    expect(catalogRaw(s.api)).toBe(before); expect(s.data.get(KEY + 'draft:QT')).toBe(raw);
    vi.mocked(s.api.setItem).mockImplementation((key, value) => { s.data.set(key, value); });
    saveDraft(doc, raw, s.api); expect(catalogValue(products(s.api)[0], 'spec')).toBe('Uncommitted');
  });
  it('refuses stale explicit saves before touching the confirmed catalog', () => {
    const s = storage(), doc = product(), raw = saveDraft(doc, null, s.api);
    const next = structuredClone(doc); next.notes = 'Another tab'; saveDraft(next, raw, s.api);
    const before = new Map(s.data); doc.rows[0].spec = 'Stale';
    expect(() => saveDraft(doc, raw, s.api)).toThrow('另一标签页'); expect(s.data).toEqual(before);
  });
  it('offers the latest confirmed product information for explicit selection without altering existing documents', () => {
    const s = storage(), original = product(), raw = saveDraft(original, null, s.api);
    const latest = structuredClone(original); latest.rows[0].spec = 'Latest'; latest.rows[0].price = '20'; latest.rows[0].image = '';
    saveDraft(latest, raw, s.api);
    const target = fresh('SC'); target.fields.currency = 'USD'; const before = JSON.stringify(target);
    const result = applyCatalogSelection(target, catalogSelections(readLookupCatalog('products', s.api))[0], target.rows[0].id);
    expect(result.document.rows[0]).toMatchObject({ name: 'P1', spec: 'Latest', price: '20', image: '' });
    expect(JSON.stringify(target)).toBe(before); expect(original.rows[0].spec).toBe('');
  });
});
