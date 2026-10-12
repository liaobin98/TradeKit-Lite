import { describe, expect, it } from 'vitest';
import { createBlankDocument, hasDocumentContent } from '@/features/documents/blank-document';
import { fresh, row, types, type Kind } from '@/features/documents/model';
import { sellerFields } from '@/features/documents/reference-model';
import { saveDraft, previousDraft } from '@/features/documents/drafts';
import { catalogRaw, parseCatalogStore } from '@/features/catalogs/catalog-storage';
import { mapStorage } from '@/features/workspace/workspace-storage';

describe('toolbar blank documents', () => {
  it.each(Object.keys(types) as Kind[])('clears all seller details and logo while retaining presentation and trade defaults in %s', kind => {
    const defaults = fresh(kind);
    Object.assign(defaults, { language: 'en', layout: 'executive', theme: '#123456', logo: 'data:image/png;base64,AAAA' });
    Object.assign(defaults.fields, Object.fromEntries(sellerFields.map(([key]) => [key, `Remembered ${key}`])));
    Object.assign(defaults.fields, { number: 'OLD-NUMBER', buyer: 'Previous buyer', currency: 'EUR', incoterm: 'EXW', payment: 'Custom payment', delivery: 'Custom delivery', freight: '99' });
    defaults.rows[0].name = 'Previous product'; defaults.notes = 'Previous notes';
    const before = JSON.stringify(defaults), blank = createBlankDocument(kind, defaults);
    for (const [key] of sellerFields) expect(blank.fields[key] || '').toBe('');
    expect(blank.logo).toBe(''); expect(blank.seal).toBe(''); expect(blank.notes).toBe('');
    expect(blank.fields.buyer || '').toBe(''); expect(blank.fields.freight).toBe('');
    expect(blank.fields.number).not.toBe('OLD-NUMBER');
    expect(blank.rows).toHaveLength(1);
    expect(blank.rows[0]).toMatchObject({ name: '', qty: '', price: '', image: '' });
    expect(blank).toMatchObject({ kind, language: 'en', layout: 'executive', theme: '#123456' });
    expect(blank.fields).toMatchObject({ currency: 'EUR', incoterm: 'EXW', payment: 'Custom payment', delivery: 'Custom delivery' });
    expect(JSON.stringify(defaults)).toBe(before);
  });
  it('retains the original seller in the previous saved document and independent directory', () => {
    const storage = mapStorage(new Map(), true), original = fresh('QT');
    Object.assign(original.fields, { seller: 'Original seller', sellerPhone: '123', bankAccount: 'BANK-001' });
    original.logo = 'data:image/png;base64,AAAA';
    const raw = saveDraft(original, null, storage, { syncProducts: false });
    const sellerCopies = parseCatalogStore(catalogRaw(storage)).records.sellers;
    const blank = createBlankDocument('QT', original);
    saveDraft(blank, raw, storage, { syncProducts: false });
    expect(previousDraft('QT', storage)).toEqual(original);
    expect(parseCatalogStore(catalogRaw(storage)).records.sellers).toEqual(sellerCopies);
  });
});

describe('blank autosave eligibility', () => {
  it.each(Object.keys(types) as Kind[])('ignores generated and remembered defaults in an untouched %s document', kind => {
    const defaults = fresh(kind);
    Object.assign(defaults.fields, { currency: 'EUR', payment: 'Remembered terms', delivery: 'Remembered delivery' });
    const blank = createBlankDocument(kind, defaults);
    const next = { ...blank, id: 'new-document', status: 'draft' as const, theme: '#123456', layout: 'swiss', rows: [row(), row()] };
    expect(hasDocumentContent(next, blank)).toBe(false);
    expect(hasDocumentContent({ ...next, fields: { ...next.fields, buyer: '  ' }, notes: '\n' }, blank)).toBe(false);
  });
  it.each(['seller', 'buyer', 'buyerAddress', 'bankName', 'freight', 'customsNotes', 'number', 'date', 'payment'])('counts a user-entered %s field without requiring a complete document', key => {
    const blank = fresh('CD'), next = { ...blank, fields: { ...blank.fields, [key]: 'User entry' } };
    expect(hasDocumentContent(next, blank)).toBe(true);
  });
  it.each(['name', 'nameEn', 'code', 'qty', 'price', 'cartons', 'net', 'gross', 'volume', 'hs', 'image', 'unit'])('counts a product %s entry, including zero quantity/price', key => {
    const blank = fresh('QT'), next = { ...blank, rows: [{ ...blank.rows[0], [key]: key === 'qty' || key === 'price' ? '0' : 'User entry' }] };
    expect(hasDocumentContent(next, blank)).toBe(true);
  });
  it.each(['notes', 'logo', 'seal'] as const)('counts %s as document content', key => {
    const blank = fresh('QT'); expect(hasDocumentContent({ ...blank, [key]: 'Content' }, blank)).toBe(true);
  });
  it('returns to blank when all uncommitted entries are cleared', () => {
    const blank = fresh('QT'), next = { ...blank, fields: { ...blank.fields, buyer: '' }, rows: [row()] };
    expect(hasDocumentContent(next, blank)).toBe(false);
  });
});
