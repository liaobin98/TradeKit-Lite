import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fresh, row, type Doc, type Row } from '@/features/documents/model';
import { KEY } from '@/features/workspace/workspace-storage';
import { buildFormCatalog, catalogSourceCount, catalogValue, searchFormCatalog } from '@/features/catalogs/form-catalog';
import { applyCatalogSelection, catalogSelections, mergeLookupCatalog, readLookupCatalog } from '@/features/catalogs/catalog-lookup';
import { CatalogLibrary } from '@/features/catalogs/CatalogLibrary';
import { CatalogLookupInput } from '@/features/catalogs/CatalogLookupInput';

function fixture(kind: Doc['kind'] = 'QT') {
  const doc = fresh(kind);
  Object.assign(doc.fields, { seller: 'Source seller', sellerContact: 'Seller contact', sellerPhone: '123', sellerEmail: 'seller@example.test', sellerAddress: 'Seller address', bankAccount: 'BANK-001', buyer: 'Source buyer', buyerContact: 'Buyer contact', buyerPhone: '456', buyerEmail: 'buyer@example.test', buyerAddress: 'Buyer address', buyerCountry: 'Japan', currency: 'USD' });
  Object.assign(doc.rows[0], { name: 'Sample product', nameEn: 'English product', code: 'SKU-001', spec: 'Large', qty: '20', price: '12.50', hs: '8471300000', origin: 'China', cartons: '5', packing: '10 units per box' });
  return doc;
}
function storage(docs: Doc[] = []) {
  const data = new Map(docs.map(doc => [KEY + 'draft:' + doc.kind, JSON.stringify(doc)]));
  const api = { getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn((key: string, value: string) => data.set(key, value)), removeItem: vi.fn() } as unknown as Storage;
  return { api, data };
}
afterEach(() => vi.unstubAllGlobals());

describe('form-derived directories', () => {
  it('does not turn blank fields or a default empty product row into records', () => {
    const doc = fresh('QT');
    for (const category of ['sellers', 'buyers', 'products'] as const) expect(buildFormCatalog([doc], category)).toEqual([]);
  });
  it('collects full seller and buyer details and keeps document sources', () => {
    const doc = fixture();
    const seller = buildFormCatalog([doc], 'sellers')[0], buyer = buildFormCatalog([doc], 'buyers')[0];
    expect(catalogValue(seller, 'bankAccount')).toBe('BANK-001'); expect(catalogValue(seller, 'sellerAddress')).toBe('Seller address');
    expect(catalogValue(buyer, 'buyerCountry')).toBe('Japan'); expect(buyer.sources[0].number).toBe(doc.fields.number);
  });
  it('keeps partially filled parties even before their company names are entered', () => {
    const doc = fresh('QT'); doc.fields.bankAccount = 'BANK-PARTIAL'; doc.fields.buyerEmail = 'partial@example.test';
    const seller = buildFormCatalog([doc], 'sellers')[0], buyer = buildFormCatalog([doc], 'buyers')[0];
    expect(seller.title).toBe('未填写公司名称'); expect(catalogValue(seller, 'bankAccount')).toBe('BANK-PARTIAL');
    expect(buyer.title).toBe('未填写公司名称'); expect(searchFormCatalog([buyer], 'PARTIAL@')).toHaveLength(1);
  });
  it('deduplicates parties by company name and takes the last supplied company information', () => {
    const first = fixture(), second = fixture('PI');
    const records = buildFormCatalog([first, second], 'sellers');
    expect(records).toHaveLength(1); expect(catalogSourceCount(records[0])).toBe(2);
    second.fields.sellerAddress = 'Different address';
    const sellers = buildFormCatalog([first, second], 'sellers');
    expect(sellers).toHaveLength(1); expect(catalogValue(sellers[0], 'sellerAddress')).toBe('Different address');
    second.fields.buyerPhone = 'Different phone';
    const buyers = buildFormCatalog([first, second], 'buyers');
    expect(buyers).toHaveLength(1); expect(catalogValue(buyers[0], 'buyerPhone')).toBe('Different phone');
  });
  it('groups product identities while retaining different prices and quantities in each source', () => {
    const first = fixture(), second = fixture('PI'); second.rows[0].qty = '10'; second.rows[0].price = '15.00';
    const records = buildFormCatalog([first, second], 'products');
    expect(records).toHaveLength(1); expect(records[0].sources).toHaveLength(2);
    expect(records[0].sources[1].row?.price).toBe('15.00'); expect(catalogSelections(records)).toHaveLength(2);
    second.rows[0].spec = 'Small';
    const updated = buildFormCatalog([first, second], 'products');
    expect(updated).toHaveLength(1); expect(catalogValue(updated[0], 'spec')).toBe('Small');
    second.rows[0].code = 'SKU-002'; expect(buildFormCatalog([first, second], 'products')).toHaveLength(2);
  });
  it('does not collect unidentified product rows solely because they have transaction details', () => {
    const doc = fresh('QT'); doc.rows = [{ ...row(), qty: '1' }, { ...row(), qty: '2' }];
    expect(buildFormCatalog([doc], 'products')).toEqual([]);
  });
  it.each<Partial<Row>>([
    { image: 'data:image/png;base64,AAAA' },
    { name: 'Product', spec: 'Large', qty: '2', price: '3' },
    { nameEn: 'Product' },
    { code: 'SKU-001', image: 'data:image/png;base64,AAAA' },
    { name: '  ', nameEn: '\n', code: 'SKU-001' },
    { name: 'Product', code: '  ' },
  ])('requires a nonblank name and SKU before collecting %j', fields => {
    const doc = fresh('QT'); Object.assign(doc.rows[0], fields);
    const before = JSON.stringify(doc);
    expect(buildFormCatalog([doc], 'products')).toEqual([]);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it.each(['name', 'nameEn'] as const)('collects a product with only %s and SKU, without requiring transaction fields', nameField => {
    const doc = fresh('QT'); Object.assign(doc.rows[0], { [nameField]: ' Product ', code: ' SKU-001 ' });
    const records = buildFormCatalog([doc], 'products');
    expect(records).toHaveLength(1);
    expect(records[0].title).toBe('Product');
    expect(catalogValue(records[0], 'code')).toBe('SKU-001');
    expect(records[0].sources[0].row?.qty).toBe('');
  });
  it('counts source documents rather than repeated product lines', () => {
    const doc = fixture(); doc.rows.push({ ...doc.rows[0], id: crypto.randomUUID(), qty: '3' });
    const record = buildFormCatalog([doc], 'products')[0];
    expect(record.sources).toHaveLength(2); expect(catalogSourceCount(record)).toBe(1);
  });
  it('searches company contacts, product codes and source numbers without changing the originals', () => {
    const doc = fixture(), before = JSON.stringify(doc);
    expect(searchFormCatalog(buildFormCatalog([doc], 'buyers'), 'buyer@example')).toHaveLength(1);
    expect(searchFormCatalog(buildFormCatalog([doc], 'products'), 'sku-001')).toHaveLength(1);
    expect(searchFormCatalog(buildFormCatalog([doc], 'sellers'), doc.fields.number)).toHaveLength(1);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('explicit selection and reusable form data', () => {
  it('reads current and valid previous suggestions without writing drafts', () => {
    const current = fixture(), previous = fixture(); previous.fields.buyer = 'Previous buyer';
    const s = storage([current]); s.data.set(KEY + 'draft-previous:QT', JSON.stringify(previous));
    const records = readLookupCatalog('buyers', s.api);
    expect(records.map(record => record.title)).toEqual(['Source buyer', 'Previous buyer']);
    expect(records[1].sources[0].version).toBe('previous');
    expect(vi.mocked(s.api.setItem).mock.calls.every(([key]) => key === KEY + 'catalogs')).toBe(true);
    expect(s.data.get(KEY + 'draft:QT')).toBe(JSON.stringify(current));
    expect(s.data.get(KEY + 'draft-previous:QT')).toBe(JSON.stringify(previous));
  });
  it('keeps starting suggestions during autosave without duplicating them each time the picker opens', () => {
    const before = buildFormCatalog([fixture()], 'buyers');
    expect(mergeLookupCatalog(before, before, before)).toHaveLength(1);
    expect(mergeLookupCatalog(before, before)[0].sources).toHaveLength(1);
  });
  it('keeps different product images available while merging refreshed suggestions', () => {
    const before = fixture(), after = structuredClone(before);
    before.rows[0].image = 'data:image/png;base64,previous'; after.rows[0].image = 'data:image/png;base64,current';
    const merged = mergeLookupCatalog(buildFormCatalog([after], 'products'), buildFormCatalog([before], 'products'));
    expect(merged).toHaveLength(1); expect(catalogSelections(merged)).toHaveLength(2);
    expect(merged[0].images).toEqual([after.rows[0].image, before.rows[0].image]);
  });
  it('skips damaged drafts and recovery copies without modifying their original contents', () => {
    const s = storage([fixture()]); s.data.set(KEY + 'draft:PI', '{broken'); s.data.set(KEY + 'draft-previous:QT', '{also broken');
    expect(readLookupCatalog('buyers', s.api)).toHaveLength(1);
    expect(s.data.get(KEY + 'draft:PI')).toBe('{broken'); expect(s.data.get(KEY + 'draft-previous:QT')).toBe('{also broken');
    expect(vi.mocked(s.api.setItem).mock.calls.every(([key]) => key === KEY + 'catalogs')).toBe(true);
    expect(s.api.removeItem).not.toHaveBeenCalled();
  });
  it('fills seller details only after selection and preserves the current transaction', () => {
    const source = fixture(), target = fresh('SC'); target.fields.sellerPhone = 'Stale phone';
    const record = buildFormCatalog([source], 'sellers')[0], before = JSON.stringify(target);
    const result = applyCatalogSelection(target, catalogSelections([record])[0]);
    expect(result.document.fields.seller).toBe('Source seller'); expect(result.document.fields.bankAccount).toBe('BANK-001');
    expect(result.document.fields.sellerPhone).toBe('123'); expect(result.document.fields.number).toBe(target.fields.number);
    expect(result.document.kind).toBe('SC'); expect(result.document.rows).toEqual(target.rows); expect(JSON.stringify(target)).toBe(before);
  });
  it('fills buyer details without bringing along currency, payment terms or other-party fields', () => {
    const target = fresh('SC'); Object.assign(target.fields, { seller: 'Current seller', currency: 'EUR', payment: 'Custom payment' });
    const result = applyCatalogSelection(target, catalogSelections(buildFormCatalog([fixture()], 'buyers'))[0]);
    expect(result.document.fields.buyerCountry).toBe('Japan'); expect(result.document.fields.seller).toBe('Current seller');
    expect(result.document.fields.currency).toBe('EUR'); expect(result.document.fields.payment).toBe('Custom payment');
  });
  it('copies the selected logo and clears stale seller fields absent in that record', () => {
    const source = fixture(), target = fresh('SC'); source.logo = 'data:image/png;base64,selected'; source.fields.bankAccount = '';
    target.logo = 'data:image/png;base64,old'; target.fields.bankAccount = 'STALE-ACCOUNT';
    const result = applyCatalogSelection(target, catalogSelections(buildFormCatalog([source], 'sellers'))[0]);
    expect(result.document.logo).toBe(source.logo); expect(result.document.fields.bankAccount).toBe('');
  });
  it('copies product identity and matching-currency price while keeping line id and transaction quantities', () => {
    const target = fresh('SC'); target.rows[0].qty = '7'; target.rows[0].cartons = '2'; target.rows.push(row());
    const selection = catalogSelections(buildFormCatalog([fixture()], 'products'))[0];
    const result = applyCatalogSelection(target, selection, target.rows[0].id);
    expect(result.document.rows[0]).toMatchObject({ id: target.rows[0].id, qty: '7', cartons: '2', code: 'SKU-001', nameEn: 'English product', price: '12.50' });
    expect(result.document.rows[1]).toEqual(target.rows[1]); expect(result.warning).toBe('');
  });
  it('does not mix currencies or silently retain a different product price', () => {
    const target = fresh('SC'); target.fields.currency = 'EUR'; target.rows[0].price = '99';
    const result = applyCatalogSelection(target, catalogSelections(buildFormCatalog([fixture()], 'products'))[0], target.rows[0].id);
    expect(result.document.rows[0].name).toBe('Sample product'); expect(result.document.rows[0].price).toBe('');
    expect(result.document.fields.currency).toBe('EUR'); expect(result.warning).toContain('USD'); expect(result.warning).toContain('EUR');
  });
  it('does not recreate a deleted line when selecting a product', () => {
    const target = fresh('QT'), result = applyCatalogSelection(target, catalogSelections(buildFormCatalog([fixture()], 'products'))[0], 'missing');
    expect(result.document).toBe(target); expect(result.warning).toContain('已不存在');
  });
  it('copies a product image without reusing the source line object', () => {
    const source = fixture(), target = fresh('SC'); source.rows[0].image = 'data:image/png;base64,product';
    const selection = catalogSelections(buildFormCatalog([source], 'products'))[0]; source.rows[0].image = '';
    const result = applyCatalogSelection(target, selection, target.rows[0].id);
    expect(result.document.rows[0].image).toBe('data:image/png;base64,product');
    expect(result.document.rows[0]).not.toBe(selection.source.row); expect(target.rows[0].image).toBe('');
  });
});

describe('directory and lookup surfaces', () => {
  it('explains the name and SKU requirement in an empty product directory', () => {
    vi.stubGlobal('localStorage', storage().api);
    const html = renderToStaticMarkup(<CatalogLibrary category="products" onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('还没有产品资料');
    expect(html).toContain('产品名称（中文或英文）和产品编码 / SKU');
  });
  it('shows an empty state without creating any catalog data', () => {
    const s = storage(); vi.stubGlobal('localStorage', s.api);
    const html = renderToStaticMarkup(<CatalogLibrary category="sellers" onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('还没有卖方资料'); expect(s.api.setItem).not.toHaveBeenCalled();
  });
  it('shows saved product records, source count and accessible detail controls', () => {
    vi.stubGlobal('localStorage', storage([fixture()]).api);
    const html = renderToStaticMarkup(<CatalogLibrary category="products" onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('Sample product'); expect(html).toContain('SKU-001'); expect(html).toContain('查看Sample product的产品资料'); expect(html).toContain('scope="row"');
  });
  it.each(['sellers', 'buyers', 'products'] as const)('makes %s data rows viewable with a native title button and only deletion in the action column', category => {
    vi.stubGlobal('localStorage', storage([fixture()]).api);
    const html = renderToStaticMarkup(<CatalogLibrary category={category} onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('class="documents-row"');
    expect(html).toMatch(/<button[^>]*class="[^"]*catalog-open[^\"]*"[^>]*aria-haspopup="dialog"/);
    const actions = html.match(/<td class="documents-actions"[^>]*>(.*?)<\/td>/)?.[1];
    expect(actions).toContain('catalog-delete'); expect(actions).not.toContain('catalog-open');
    expect(html).not.toContain('>查看资料');
  });
  it('keeps ordinary editable text input and does not select records just because a name matches', () => {
    vi.stubGlobal('localStorage', storage([fixture()]).api);
    const select = vi.fn(), change = vi.fn();
    const html = renderToStaticMarkup(<CatalogLookupInput category="sellers" label="卖方公司" showLabel value="Source seller" onChange={change} onSelect={select} />);
    expect(html).toContain('value="Source seller"'); expect(html).toContain('检索已有卖方资料'); expect(html).toContain('aria-label="卖方公司"');
    expect(select).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  });
});
