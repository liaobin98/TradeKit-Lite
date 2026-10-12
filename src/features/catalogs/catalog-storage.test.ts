import { describe, expect, it, vi } from 'vitest';
import { fresh, type Doc } from '@/features/documents/model';
import { KEY } from '@/features/workspace/workspace-storage';
import { deleteDraft, saveDraft } from '@/features/documents/drafts';
import { readSavedCatalogs } from '@/features/catalogs/catalog-sync';
import { catalogCategories, catalogRaw, deleteCatalogRecords, parseCatalogStore, captureCatalogDocuments, emptyCatalogStore } from '@/features/catalogs/catalog-storage';
import { readLookupCatalog, applyCatalogSelection, catalogSelections } from '@/features/catalogs/catalog-lookup';
import { buildFormCatalog, catalogValue, catalogSourceAvailable } from '@/features/catalogs/form-catalog';
import { catalogIdentity } from '@/features/catalogs/catalog-identity';
import { createWorkspaceBackup, parseWorkspaceBackup, serializeWorkspaceBackup, restoreWorkspaceBackup, workspaceBackupSummary, workspaceSnapshot } from '@/features/workspace/workspace-backup';

function storage() {
  const data = new Map<string, string>();
  const api = { getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }) } as unknown as Storage;
  return { data, api };
}
function fixture(kind: Doc['kind'] = 'QT', suffix = 'One') {
  const doc = fresh(kind);
  Object.assign(doc.fields, { number: kind + '-' + suffix, seller: 'Seller ' + suffix, sellerContact: 'Contact ' + suffix,
    buyer: 'Buyer ' + suffix, buyerPhone: '123', currency: 'USD' });
  Object.assign(doc.rows[0], { name: 'Product ' + suffix, code: 'SKU-' + suffix, qty: '2', price: '3.25', image: 'data:image/png;base64,AAAA' });
  doc.logo = 'data:image/png;base64,AAAA';
  return doc;
}
function legacyCopies(documents: Doc[]) {
  const partyCopies = (category: 'sellers' | 'buyers') => {
    const records = documents.flatMap(doc => buildFormCatalog([doc], category)).map(record => ({ ...record, id: catalogIdentity(JSON.stringify([category, ...record.fields.map(field => field.value)])) }));
    return [...new Map(records.map(record => [record.id, record])).values()];
  };
  return { ...emptyCatalogStore(), version: 1, records: {
    sellers: partyCopies('sellers'),
    buyers: partyCopies('buyers'),
    products: buildFormCatalog(documents, 'products'),
  } };
}

describe('latest company copies', () => {
  it('replaces progressive autosaves by company name, including cleared fields and the latest logo', () => {
    const s = storage(), doc = fixture();
    let raw = saveDraft(doc, null, s.api);
    for (const contact of ['First', 'Second', '']) {
      doc.fields.sellerContact = contact; doc.fields.buyerContact = contact;
      doc.fields.buyerPhone = contact ? '456' : '';
      doc.logo = contact ? 'data:image/png;base64,BBBB' : '';
      raw = saveDraft(doc, raw, s.api);
    }
    const store = readSavedCatalogs(s.api).store;
    expect(store.records.sellers).toHaveLength(1); expect(store.records.buyers).toHaveLength(1);
    expect(catalogValue(store.records.sellers[0], 'sellerContact')).toBe('');
    expect(catalogValue(store.records.buyers[0], 'buyerPhone')).toBe('');
    expect(store.records.sellers[0].images).toEqual([]);
    expect(store.records.sellers[0].sources).toHaveLength(1);
    expect(readLookupCatalog('buyers', s.api)).toHaveLength(1);
  });
  it('uses save order rather than document type/date and never rolls back on read, recovery or source deletion', () => {
    const s = storage(), older = fixture('QT'), latest = fixture('PI');
    older.fields.date = '2030-01-01'; latest.fields.date = '2020-01-01';
    latest.fields.buyerPhone = 'Latest phone'; latest.fields.sellerContact = 'Latest contact';
    const olderRaw = saveDraft(older, null, s.api), latestRaw = saveDraft(latest, null, s.api);
    const expected = parseCatalogStore(catalogRaw(s.api));
    for (let index = 0; index < 3; index++) readSavedCatalogs(s.api);
    deleteDraft('QT', olderRaw, s.api); deleteDraft('PI', latestRaw, s.api);
    const result = readSavedCatalogs(s.api).store;
    expect(result.records.buyers).toEqual(expected.records.buyers);
    expect(result.records.sellers).toEqual(expected.records.sellers);
    expect(catalogValue(result.records.buyers[0], 'buyerPhone')).toBe('Latest phone');
    expect(catalogValue(result.records.sellers[0], 'sellerContact')).toBe('Latest contact');
  });
  it('does not revert after a save in an earlier-listed document type', () => {
    const s = storage(), first = fixture('QT'), second = fixture('PI');
    let raw = saveDraft(first, null, s.api); second.fields.buyerPhone = 'Second'; saveDraft(second, null, s.api);
    first.fields.buyerPhone = 'Newest'; raw = saveDraft(first, raw, s.api);
    expect(catalogValue(readSavedCatalogs(s.api).store.records.buyers[0], 'buyerPhone')).toBe('Newest');
    expect(s.data.get(KEY + 'draft:QT')).toBe(raw);
  });
  it('migrates existing V1 duplicate companies to their last collected complete snapshot without changing documents or products', () => {
    const s = storage(), first = fixture(), latest = fixture();
    first.fields.buyerContact = 'Earlier'; latest.fields.buyerContact = 'Latest';
    first.fields.buyerEmail = 'old@example.test'; latest.fields.buyerEmail = '';
    latest.fields.sellerPhone = 'Updated'; latest.logo = '';
    const legacy = legacyCopies([first, latest]);
    s.data.set(KEY + 'catalogs', JSON.stringify(legacy)); s.data.set(KEY + 'draft:QT', JSON.stringify(latest));
    const original = s.data.get(KEY + 'draft:QT'), store = readSavedCatalogs(s.api).store;
    expect(store.version).toBe(3);
    expect(store.records.sellers).toHaveLength(1); expect(store.records.buyers).toHaveLength(1);
    expect(catalogValue(store.records.buyers[0], 'buyerContact')).toBe('Latest');
    expect(catalogValue(store.records.buyers[0], 'buyerEmail')).toBe('');
    expect(store.records.sellers[0].images).toEqual([]);
    expect(store.records.products).toEqual(legacy.records.products);
    expect(s.data.get(KEY + 'draft:QT')).toBe(original);
    const committed = catalogRaw(s.api); readSavedCatalogs(s.api);
    expect(catalogRaw(s.api)).toBe(committed);
  });
  it('matches trimmed names exactly, keeps different named companies separate, and does not group unrelated unnamed parties', () => {
    const first = fixture(), second = fixture('PI'); second.fields.buyer = '  Buyer One  '; second.fields.buyerPhone = 'Updated';
    expect(buildFormCatalog([first, second], 'buyers')).toHaveLength(1);
    second.fields.buyer = 'Buyer Two'; expect(buildFormCatalog([first, second], 'buyers')).toHaveLength(2);
    first.fields.buyer = ''; second.fields.buyer = '';
    expect(buildFormCatalog([first, second], 'buyers')).toHaveLength(2);
  });
  it('migrates a later legacy edit that reverted to previously collected information using its current source', () => {
    const s = storage(), initial = fixture(), laterVariant = fixture(); laterVariant.fields.buyerPhone = 'A different intermediate version';
    s.data.set(KEY + 'catalogs', JSON.stringify(legacyCopies([initial, laterVariant])));
    // The last save returned to the first variant; V1 never moved its array entry.
    s.data.set(KEY + 'draft:QT', JSON.stringify(initial));
    expect(catalogValue(readSavedCatalogs(s.api).store.records.buyers[0], 'buyerPhone')).toBe(initial.fields.buyerPhone);
  });
  it.each(['sellers', 'buyers'] as const)('keeps a deleted %s company excluded even when its contact information changes', category => {
    const s = storage(), doc = fixture(); let raw = saveDraft(doc, null, s.api);
    const record = readSavedCatalogs(s.api).store.records[category][0];
    deleteCatalogRecords(category, [record.id], catalogRaw(s.api)!, s.api);
    doc.fields.sellerContact = 'Changed'; doc.fields.buyerPhone = 'Changed';
    raw = saveDraft(doc, raw, s.api);
    expect(readSavedCatalogs(s.api).store.records[category]).toEqual([]);
    expect(readLookupCatalog(category, s.api)).toEqual([]);
    expect(s.data.get(KEY + 'draft:QT')).toBe(raw);
  });
  it('recognizes opaque V1 deletion markers and does not re-import their company', () => {
    const s = storage(), doc = fixture(), legacy = legacyCopies([doc]);
    legacy.deleted.buyers.push(legacy.records.buyers[0].id); legacy.records.buyers = [];
    s.data.set(KEY + 'catalogs', JSON.stringify(legacy)); s.data.set(KEY + 'draft:QT', JSON.stringify(doc));
    expect(readSavedCatalogs(s.api).store.records.buyers).toEqual([]);
    doc.fields.buyerPhone = 'Changed'; saveDraft(doc, s.data.get(KEY + 'draft:QT')!, s.api);
    expect(readSavedCatalogs(s.api).store.records.buyers).toEqual([]);
  });
  it('restores old full backups with duplicate companies and previews the deduplicated counts', () => {
    const source = storage(), old = fixture(), latest = fixture(); latest.fields.buyerPhone = 'Latest'; latest.fields.sellerContact = 'Latest';
    source.data.set(KEY + 'catalogs', JSON.stringify(legacyCopies([old, latest])));
    const backup = createWorkspaceBackup(source.api);
    expect(workspaceBackupSummary(backup)).toMatchObject({ buyers: 1, sellers: 1, products: 1 });
    const target = storage();
    restoreWorkspaceBackup(parseWorkspaceBackup(serializeWorkspaceBackup(backup)), workspaceSnapshot(target.api), target.api);
    const records = readSavedCatalogs(target.api).store.records;
    expect(records.buyers).toHaveLength(1); expect(records.sellers).toHaveLength(1);
    expect(catalogValue(records.buyers[0], 'buyerPhone')).toBe('Latest');
  });
  it('does not replace the latest company when its document write fails', () => {
    const s = storage(), doc = fixture(), raw = saveDraft(doc, null, s.api), before = catalogRaw(s.api);
    doc.fields.buyerPhone = 'Uncommitted';
    vi.mocked(s.api.setItem).mockImplementation((key, value) => { if (key === KEY + 'draft:QT') throw Error('quota'); s.data.set(key, value); });
    expect(() => saveDraft(doc, raw, s.api)).toThrow('quota');
    expect(catalogRaw(s.api)).toBe(before);
    expect(s.data.get(KEY + 'draft:QT')).toBe(raw);
  });
});

describe('product collection eligibility', () => {
  it('saves unfinished edits and images without collecting a product until both name and SKU are present', () => {
    const s = storage(), doc = fresh('QT');
    doc.rows[0].image = 'data:image/png;base64,AAAA';
    let raw = saveDraft(doc, null, s.api);
    doc.rows[0].name = 'Product'; raw = saveDraft(doc, raw, s.api);
    doc.rows[0].qty = '2'; raw = saveDraft(doc, raw, s.api);
    expect(JSON.parse(raw).rows[0]).toMatchObject({ name: 'Product', qty: '2', image: 'data:image/png;base64,AAAA' });
    expect(parseCatalogStore(catalogRaw(s.api))).toMatchObject({ version: 3, records: { products: [] } });
    expect(readSavedCatalogs(s.api).store.records.products).toEqual([]);
    doc.rows[0].code = 'SKU-001'; raw = saveDraft(doc, raw, s.api);
    const records = parseCatalogStore(catalogRaw(s.api)).records.products;
    expect(records).toHaveLength(1);
    expect(records[0].title).toBe('Product');
    expect(records[0].sources[0].row?.image).toBe(doc.rows[0].image);
    expect(s.data.get(KEY + 'draft:QT')).toBe(raw);
  });
  it('does not write catalog data again for unrelated draft changes', () => {
    const s = storage(), doc = fixture(), raw = saveDraft(doc, null, s.api), before = catalogRaw(s.api);
    vi.mocked(s.api.setItem).mockClear();
    saveDraft({ ...doc, notes: 'Only remarks changed' }, raw, s.api);
    expect(catalogRaw(s.api)).toBe(before);
    expect(vi.mocked(s.api.setItem).mock.calls.some(([key]) => key === KEY + 'catalogs')).toBe(false);
  });
  it('keeps collected products when the source name or SKU is later cleared', () => {
    const s = storage(), doc = fixture(); let raw = saveDraft(doc, null, s.api);
    const before = parseCatalogStore(catalogRaw(s.api)).records.products;
    doc.rows[0].code = ''; raw = saveDraft(doc, raw, s.api);
    doc.rows[0].name = ''; raw = saveDraft(doc, raw, s.api);
    expect(readSavedCatalogs(s.api).store.records.products).toEqual(before);
    expect(s.data.get(KEY + 'draft:QT')).toBe(raw);
  });
  it('does not collect unfinished legacy current or recovery rows on read, backup or source deletion', () => {
    const s = storage(), doc = fixture(); doc.rows[0].code = '';
    const raw = JSON.stringify(doc);
    s.data.set(KEY + 'draft:QT', raw); s.data.set(KEY + 'draft-previous:QT', raw);
    expect(readSavedCatalogs(s.api).store.records.products).toEqual([]);
    expect(workspaceBackupSummary(createWorkspaceBackup(s.api)).products).toBe(0);
    deleteDraft('QT', raw, s.api);
    expect(readSavedCatalogs(s.api).store.records.products).toEqual([]);
  });
  it('preserves incomplete product copies that were already collected by older versions', () => {
    const s = storage(), record = buildFormCatalog([fixture()], 'products')[0];
    record.title = '未填写产品名称';
    for (const field of record.fields) if (['name', 'nameEn', 'code'].includes(field.key)) field.value = '';
    Object.assign(record.sources[0].row!, { name: '', nameEn: '', code: '' });
    const store = emptyCatalogStore(); store.records.products = [record];
    s.data.set(KEY + 'catalogs', JSON.stringify(store));
    const doc = fresh('QT'); doc.rows[0].image = 'data:image/png;base64,BBBB';
    saveDraft(doc, null, s.api);
    expect(readSavedCatalogs(s.api).store.records.products).toEqual([record]);
  });
});

describe('independent directory copies', () => {
  it('does not open changed/replaced source content even with the same type, number and date', () => {
    const doc = fixture(), store = captureCatalogDocuments(emptyCatalogStore(), [doc]);
    const seller = store.records.sellers[0], product = store.records.products[0];
    expect(catalogSourceAvailable(seller, seller.sources[0], [doc])).toBe(true);
    expect(catalogSourceAvailable(product, product.sources[0], [doc])).toBe(true);
    const changed = structuredClone(doc);
    changed.fields.sellerContact = 'Replacement contact'; changed.rows[0].price = '99';
    expect(catalogSourceAvailable(seller, seller.sources[0], [changed])).toBe(false);
    expect(catalogSourceAvailable(product, product.sources[0], [changed])).toBe(false);
    expect(catalogSourceAvailable(seller, seller.sources[0], [])).toBe(false);
  });
  it('merges identical current/recovery sources but preserves different transaction details', () => {
    const doc = fixture();
    let store = captureCatalogDocuments(emptyCatalogStore(), [doc]);
    store = captureCatalogDocuments(store, [doc], 'previous');
    expect(store.records.products[0].sources).toHaveLength(1);
    const changed = structuredClone(doc); changed.rows[0].price = '9.50';
    store = captureCatalogDocuments(store, [changed]);
    expect(store.records.products[0].sources).toHaveLength(2);
    expect(store.records.products[0].sources.map(source => source.row?.price)).toEqual(['9.50', '3.25']);
  });
  it('captures all three directories on save, and detaches fields, source rows and images', () => {
    const s = storage(), doc = fixture();
    saveDraft(doc, null, s.api);
    doc.fields.seller = 'Changed in memory'; doc.rows[0].price = '999'; doc.logo = '';
    const store = parseCatalogStore(catalogRaw(s.api));
    expect(store.records.sellers[0].title).toBe('Seller One');
    expect(store.records.sellers[0].images).toEqual(['data:image/png;base64,AAAA']);
    expect(store.records.buyers[0].title).toBe('Buyer One');
    expect(store.records.products[0].sources[0].row?.price).toBe('3.25');
  });
  it('keeps original and changed identities after a source document is edited or deleted', () => {
    const s = storage(), doc = fixture(), raw = saveDraft(doc, null, s.api);
    const updated = saveDraft(fixture('QT', 'Two'), raw, s.api);
    deleteDraft('QT', updated, s.api);
    const saved = readSavedCatalogs(s.api);
    expect(saved.documents).toEqual([]);
    for (const category of catalogCategories) expect(saved.store.records[category]).toHaveLength(2);
    expect(readLookupCatalog('products', s.api)).toHaveLength(2);
    const selection = catalogSelections(readLookupCatalog('products', s.api))[0], target = fresh('SC');
    expect(applyCatalogSelection(target, selection, target.rows[0].id).document.rows[0].price).toBe('3.25');
  });
  it('migrates legacy current and previous records without overwriting originals', () => {
    const s = storage(), current = fixture(), previous = fixture('QT', 'Old');
    s.data.set(KEY + 'draft:QT', JSON.stringify(current));
    s.data.set(KEY + 'draft-previous:QT', JSON.stringify(previous));
    readSavedCatalogs(s.api);
    expect(parseCatalogStore(catalogRaw(s.api)).records.buyers).toHaveLength(2);
    expect(s.data.get(KEY + 'draft:QT')).toBe(JSON.stringify(current));
    expect(s.data.get(KEY + 'draft-previous:QT')).toBe(JSON.stringify(previous));
  });
  it('preserves legacy copies even when their document is deleted before opening a directory', () => {
    const s = storage(), raw = JSON.stringify(fixture());
    s.data.set(KEY + 'draft:QT', raw);
    s.data.set(KEY + 'draft-previous:QT', JSON.stringify(fixture('QT', 'Old')));
    deleteDraft('QT', raw, s.api);
    for (const category of catalogCategories) expect(readSavedCatalogs(s.api).store.records[category]).toHaveLength(2);
  });
  it('collects prior legacy and imported copies when restoring a single document', () => {
    const s = storage();
    s.data.set(KEY + 'draft:QT', JSON.stringify(fixture('QT', 'Old')));
    restoreWorkspaceBackup(parseWorkspaceBackup(JSON.stringify(fixture())), workspaceSnapshot(s.api), s.api);
    for (const category of catalogCategories) expect(parseCatalogStore(catalogRaw(s.api)).records[category]).toHaveLength(2);
  });
  it('does not accumulate copies when old source rows had missing IDs', () => {
    const s = storage(), doc = fixture();
    delete (doc.rows[0] as Partial<Doc['rows'][number]>).id;
    s.data.set(KEY + 'draft:QT', JSON.stringify(doc));
    readSavedCatalogs(s.api);
    const first = catalogRaw(s.api);
    readSavedCatalogs(s.api); readSavedCatalogs(s.api);
    expect(catalogRaw(s.api)).toBe(first);
  });
  it.each(catalogCategories)('bulk deletes only selected %s copies and prevents re-import on refresh or save', category => {
    const s = storage(), first = fixture(), second = fixture('PI', 'Two'), third = fixture('SC', 'Three');
    const raw = saveDraft(first, null, s.api); saveDraft(second, null, s.api); saveDraft(third, null, s.api);
    const before = new Map(s.data), store = parseCatalogStore(catalogRaw(s.api));
    deleteCatalogRecords(category, store.records[category].slice(0, 2).map(record => record.id), catalogRaw(s.api)!, s.api);
    readSavedCatalogs(s.api);
    saveDraft({ ...first, notes: 'Another save, unchanged profile' }, raw, s.api);
    const result = readSavedCatalogs(s.api).store;
    expect(result.records[category].map(record => record.title)).toEqual([store.records[category][2].title]);
    expect(result.deleted[category]).toHaveLength(2);
    expect(result.deleted[category].every(id => /^catalog-[0-9a-f]{32}$/.test(id))).toBe(true);
    expect(JSON.stringify(result.deleted)).not.toMatch(/Seller|Buyer|Product|Contact/);
    for (const other of catalogCategories.filter(value => value !== category)) expect(result.records[other]).toHaveLength(3);
    expect(s.data.get(KEY + 'draft:PI')).toBe(before.get(KEY + 'draft:PI'));
    expect(s.data.get(KEY + 'draft:SC')).toBe(before.get(KEY + 'draft:SC'));
    expect(readLookupCatalog(category, s.api)).toHaveLength(1);
  });
  it('refuses stale batch deletions without partial removal', () => {
    const s = storage(); saveDraft(fixture(), null, s.api);
    const before = catalogRaw(s.api)!, ids = parseCatalogStore(before).records.sellers.map(record => record.id);
    saveDraft(fixture('PI', 'Two'), null, s.api);
    const updated = catalogRaw(s.api);
    expect(() => deleteCatalogRecords('sellers', ids, before, s.api)).toThrow('另一标签页');
    expect(catalogRaw(s.api)).toBe(updated);
    expect(() => deleteCatalogRecords('sellers', [...ids, 'not-found'], updated!, s.api)).toThrow('已发生变化');
    expect(catalogRaw(s.api)).toBe(updated);
  });
  it('leaves all copies and original documents intact on a bulk storage failure', () => {
    const s = storage(); saveDraft(fixture(), null, s.api); saveDraft(fixture('PI', 'Two'), null, s.api);
    const raw = catalogRaw(s.api)!, before = new Map(s.data);
    vi.mocked(s.api.setItem).mockImplementation(() => { throw Error('quota'); });
    expect(() => deleteCatalogRecords('buyers', parseCatalogStore(raw).records.buyers.map(record => record.id), raw, s.api)).toThrow('quota');
    expect(s.data).toEqual(before);
  });
  it('does not save a document without copies when storing the copies fails', () => {
    const s = storage();
    vi.mocked(s.api.setItem).mockImplementation(key => { if (key === KEY + 'catalogs') throw Error('quota'); });
    expect(() => saveDraft(fixture(), null, s.api)).toThrow('quota');
    expect(s.data.size).toBe(0);
  });
  it('rolls back new copies if the main draft cannot be saved', () => {
    const s = storage();
    vi.mocked(s.api.setItem).mockImplementation((key, value) => {
      if (key === KEY + 'draft:QT') throw Error('quota'); s.data.set(key, value);
    });
    expect(() => saveDraft(fixture(), null, s.api)).toThrow('quota');
    expect(s.data.size).toBe(0);
  });
  it('preserves corrupt stored copies instead of silently replacing or deleting them', () => {
    const s = storage(); s.data.set(KEY + 'catalogs', '{broken');
    expect(() => saveDraft(fixture(), null, s.api)).toThrow();
    expect(() => readSavedCatalogs(s.api)).toThrow();
    expect(s.data.get(KEY + 'catalogs')).toBe('{broken');
    expect(s.data.has(KEY + 'draft:QT')).toBe(false);
  });
  it('backs up and restores orphan copies, images and deletion markers', () => {
    const s = storage(); const raw = saveDraft(fixture(), null, s.api); saveDraft(fixture('PI', 'Two'), null, s.api);
    const store = parseCatalogStore(catalogRaw(s.api));
    deleteCatalogRecords('buyers', [store.records.buyers[0].id], catalogRaw(s.api)!, s.api);
    deleteDraft('QT', raw, s.api);
    const backup = createWorkspaceBackup(s.api);
    expect(workspaceBackupSummary(backup)).toMatchObject({ documents: 1, sellers: 2, buyers: 1, products: 2 });
    const target = storage();
    restoreWorkspaceBackup(parseWorkspaceBackup(serializeWorkspaceBackup(backup)), workspaceSnapshot(target.api), target.api);
    expect(readSavedCatalogs(target.api).store).toEqual(readSavedCatalogs(s.api).store);
    expect(target.data.get(KEY + 'draft:QT')).toBeUndefined();
  });
  it('rejects remote images and arbitrary fillable fields in imported copies', () => {
    const s = storage(); saveDraft(fixture(), null, s.api);
    const store = parseCatalogStore(catalogRaw(s.api));
    store.records.products[0].images = ['https://remote.example/image'];
    expect(() => parseCatalogStore(JSON.stringify(store))).toThrow();
    store.records.products[0].images = [];
    store.records.products[0].fields[0].key = 'id';
    expect(() => parseCatalogStore(JSON.stringify(store))).toThrow('不支持的字段');
  });
});
