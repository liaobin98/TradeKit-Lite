import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fresh, row, types, fields, columns, type Kind } from '../../src/features/documents/model';
import { amount, totals, decimal } from '../../src/features/documents/calculations';
import { loadDoc } from '../../src/features/documents/drafts';
import { KEY } from '../../src/features/workspace/workspace-storage';
import { numeric, validateDoc, assertExportable } from '../../src/features/documents/validation';
import { decodeDoc, parseBackup, serializeBackup, saveDraft, draftRaw, previousDraft, hasPreviousDraft, DraftConflictError } from '../../src/features/documents/drafts';
import { createWorkbook } from '../../src/features/documents/export';
import { ReferencePreview } from '../../src/features/documents/ReferenceWorkspace';
import { customsFields, customsRowFields } from '../../src/features/documents/reference-model';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
function storage() {
  const map = new Map<string, string>();
  return { map, api: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => map.delete(k) } as unknown as Storage };
}
function fixture(kind: Kind) {
  const d = fresh(kind);
  for (const [key] of fields(kind)) d.fields[key] = 'unique-' + key;
  Object.assign(d.fields, { currency: 'USD', date: '2026-10-11', declarationDate: '2026-10-10', freight: '4.25', totalPackages: '12', totalNet: '120 kg', totalGross: '135 kg', totalVolume: '12.5 CBM' });
  d.rows = [{ ...row(), name: '独立中文产品', nameEn: 'Distinct English product', code: 'SKU-TEST', spec: '规格测试', qty: '3', price: '0.1', hs: '8471300000', origin: '中国', packing: 'CTN-TEST', net: '10 kg', gross: '12 kg', volume: '0.25 CBM', image: png }];
  d.logo = png; d.notes = '独立备注\n第二行';
  return d;
}

describe('number validation', () => {
  it('distinguishes blank, zero and decimal input', () => {
    expect(numeric('').state).toBe('empty'); expect(numeric('   ').state).toBe('empty');
    expect(numeric('0').state).toBe('valid'); expect(numeric('.5').state).toBe('valid');
    expect(amount({ ...row(), qty: '', price: '2' })).toBe('');
    expect(amount({ ...row(), qty: '0', price: '2' })).toBe('0.00');
  });
  it.each(['-1', 'abc', 'NaN', 'Infinity', '1e20', '1,000', '1.', '1.0000001', '1000000000001', '2 USD'])('rejects invalid input %s', value => {
    expect(numeric(value).state).toBe('invalid'); expect(() => decimal(value)).toThrow();
  });
  it('never presents invalid prices as zero', () => {
    const d = fresh('QT'); d.rows[0].qty = '2'; d.rows[0].price = '-1';
    expect(amount(d.rows[0])).toBe('—'); expect(totals(d)).toEqual({ subtotal: '—', total: '—' });
    expect(validateDoc(d)[0].path).toBe(`rows.${d.rows[0].id}.price`); expect(() => assertExportable(d)).toThrow();
  });
  it('validates PI freight independently of subtotal', () => {
    const d = fresh('PI'); d.rows = [{ ...row(), qty: '3', price: '0.1' }]; d.fields.freight = '0.2';
    expect(totals(d).total).toBe('0.50'); d.fields.freight = '-1';
    expect(validateDoc(d).some(i => i.path === 'fields.freight')).toBe(true); expect(totals(d).total).toBe('—');
  });
  it('compares weights across units and enforces whole package counts', () => {
    const d = fresh('CD'); d.rows[0].net = '1000 g'; d.rows[0].gross = '1 kg';
    d.fields.totalNet = '1000 kg'; d.fields.totalGross = '1 t'; d.fields.totalVolume = '12.5 CBM';
    expect(validateDoc(d)).toEqual([]);
    d.rows[0].net = '1001 g'; d.fields.totalPackages = '1.5'; d.fields.totalVolume = '-1';
    expect(validateDoc(d).map(i => i.path)).toEqual(expect.arrayContaining([`rows.${d.rows[0].id}.net`, 'fields.totalPackages', 'fields.totalVolume']));
  });
  it('rejects excessive line amounts without crashing preview', () => {
    const d = fresh('QT'); d.rows[0].qty = '1000000000000'; d.rows[0].price = '10000';
    expect(amount(d.rows[0])).toBe('—'); expect(validateDoc(d)).not.toHaveLength(0);
  });
  it('retains full multiplication precision before monetary rounding', () => {
    const qty = numeric('999999999.999999'), price = numeric('999999.999999');
    if (qty.state !== 'valid' || price.state !== 'valid') throw Error('Invalid fixture');
    const product = 999999999999999n * 999999999999n;
    const exact = `${product / 1000000000000n}.${String(product % 1000000000000n).padStart(12, '0')}`;
    expect(qty.value.mul(price.value).toFixed(12)).toBe(exact);
  });
});

describe('draft protection and backups', () => {
  it.each(Object.keys(types) as Kind[])('round trips all fields, images and extra saved attributes for %s', kind => {
    const d = fixture(kind); d.fields.legacy = '保留的附加字段';
    expect(parseBackup(serializeBackup(d))).toEqual(d);
    expect(parseBackup(JSON.stringify(d))).toEqual(d);
    const s = storage(); saveDraft(d, null, s.api); expect(loadDoc(kind, s.api)).toEqual(d);
  });
  it('preserves invalid edits in drafts while blocking spreadsheet export', async () => {
    const d = fresh('PI'); d.rows[0].price = '-2'; const s = storage();
    saveDraft(d, null, s.api); expect(loadDoc('PI', s.api)?.rows[0].price).toBe('-2');
    expect(parseBackup(serializeBackup(d)).rows[0].price).toBe('-2'); await expect(createWorkbook(d)).rejects.toThrow();
  });
  it('keeps a previous saved version without crossing document types', () => {
    const d = fresh('SC'), s = storage(); const first = saveDraft(d, null, s.api);
    const changed = { ...d, notes: '已修改' }; saveDraft(changed, first, s.api);
    expect(previousDraft('SC', s.api)).toEqual(d); expect(draftRaw('PI', s.api)).toBeNull();
  });
  it('only offers recovery for a document type with a valid previous version', () => {
    const d = fresh('QT'), s = storage();
    expect(hasPreviousDraft('QT', s.api)).toBe(false);
    const first = saveDraft(d, null, s.api);
    expect(hasPreviousDraft('QT', s.api)).toBe(false);
    saveDraft({ ...d, notes: '第二次保存' }, first, s.api);
    expect(hasPreviousDraft('QT', s.api)).toBe(true);
    for (const kind of (Object.keys(types) as Kind[]).filter(kind => kind !== 'QT')) {
      expect(hasPreviousDraft(kind, s.api)).toBe(false);
      expect(draftRaw(kind, s.api)).toBeNull();
    }
  });
  it('does not offer recovery for corrupt or mismatched history', () => {
    const s = storage();
    s.map.set(KEY + 'draft-previous:QT', '{broken');
    expect(hasPreviousDraft('QT', s.api)).toBe(false);
    s.map.set(KEY + 'draft-previous:QT', JSON.stringify(fresh('SC')));
    expect(hasPreviousDraft('QT', s.api)).toBe(false);
  });
  it('refuses stale tab overwrites', () => {
    const d = fresh('QT'), s = storage(); const first = saveDraft(d, null, s.api);
    const external = { ...d, notes: '其他标签页' }; const latest = saveDraft(external, first, s.api);
    expect(() => saveDraft({ ...d, notes: '旧页' }, first, s.api)).toThrow(DraftConflictError);
    expect(draftRaw('QT', s.api)).toBe(latest);
  });
  it('leaves the original intact when recovery-copy storage fails', () => {
    const d = fresh('CI'), s = storage(); const raw = saveDraft(d, null, s.api);
    const full = { getItem: s.api.getItem, setItem: () => { throw Error('quota'); } } as unknown as Storage;
    expect(() => saveDraft({ ...d, notes: '未保存' }, raw, full)).toThrow('quota');
    expect(draftRaw('CI', s.api)).toBe(raw);
  });
  it('leaves the original intact when the main write fails', () => {
    const d = fresh('CI'), s = storage(); const raw = saveDraft(d, null, s.api);
    const partial = { getItem: s.api.getItem, setItem: (k: string, v: string) => { if (k === KEY + 'draft:CI') throw Error('quota'); s.api.setItem(k, v); } } as unknown as Storage;
    expect(() => saveDraft({ ...d, notes: '未保存' }, raw, partial)).toThrow('quota');
    expect(draftRaw('CI', s.api)).toBe(raw); expect(previousDraft('CI', s.api)).toEqual(d);
  });
  it('preserves a corrupt original when explicitly replacing it', () => {
    const s = storage(); s.map.set(KEY + 'draft:QT', '{broken');
    expect(() => loadDoc('QT', s.api)).toThrow(); saveDraft(fresh('QT'), '{broken', s.api);
    expect(s.map.get(KEY + 'draft-corrupt:QT')).toBe('{broken');
  });
  it.each([{ version: 1, kind: '__proto__', fields: {}, rows: [] }, { ...fresh('QT'), fields: { seller: 123 } }, { ...fresh('QT'), logo: 'https://external.example/logo.png' }, { format: 'tradekit-lite-backup', version: 2, document: fresh('QT') }])('rejects malformed or unsafe backups', value => {
    expect(() => parseBackup(JSON.stringify(value))).toThrow();
  });
  it('migrates missing optional properties and duplicate row IDs', () => {
    const d = fresh('PL'); d.rows = [d.rows[0], { ...d.rows[0] }];
    const decoded = decodeDoc(d); expect(new Set(decoded.rows.map(r => r.id)).size).toBe(2);
  });
});

describe('complete output', () => {
  it.each(Object.keys(types) as Kind[])('renders editable document values and writes a readable XLSX for %s', async kind => {
    const d = fixture(kind);
    const html = renderToStaticMarkup(<ReferencePreview doc={d} />);
    for (const [key] of fields(kind)) {
      if (key === 'currency') { expect(html).toContain('USD'); continue; }
      expect(html).toContain(`data-field="${key}"`);
    }
    for (const [, value] of Object.entries(d.fields).filter(([k]) => fields(kind).some(f => f[0] === k) && k !== 'freight')) expect(html).toContain(value);
    expect(html).toContain(d.notes); expect(html).toContain(d.rows[0].name); expect(html).toContain(d.rows[0].nameEn);
    if (kind === 'CD') for (const [key] of customsRowFields) expect(html).toContain(`data-row-field="${key}"`);
    const book = await createWorkbook(d); const buffer = await book.xlsx.writeBuffer();
    const { default: ExcelJS } = await import('exceljs'); const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(buffer);
    const rows: unknown[][] = []; loaded.worksheets[0].eachRow(r => rows.push(r.values as unknown[]));
    const text = JSON.stringify(rows);
    for (const [key] of fields(kind)) expect(text).toContain(d.fields[key]);
    expect(text).toContain(d.rows[0].name); expect(text).toContain(d.rows[0].nameEn);
    if (kind === 'CD') for (const [key] of customsRowFields) expect(text).toContain(d.rows[0][key as keyof typeof d.rows[0]]);
    expect(loaded.worksheets[0].getImages()).toHaveLength(2);
  });
  it('keeps empty spreadsheet numbers blank but preserves actual zero', async () => {
    const d = fresh('QT'); const book = await createWorkbook(d); const sheet = book.worksheets[0];
    const headerRow = fields('QT').length + 3, productRow = headerRow + 1;
    const qty = columns('QT').findIndex(c => c[0] === 'qty') + 2;
    expect(sheet.getRow(productRow).getCell(qty).value).toBeNull();
    d.rows[0].qty = '0'; d.rows[0].price = '0'; const zero = (await createWorkbook(d)).worksheets[0];
    expect(zero.getRow(productRow).getCell(qty).value).toBe(0);
    d.rows[0].qty = '100000000000.0001'; d.rows[0].price = '1';
    const precise = (await createWorkbook(d)).worksheets[0];
    expect(precise.getRow(productRow).getCell(qty).value).toBe('100000000000.0001');
  });
  it('uses only the selected product-name language when both names are available', () => {
    const d = fixture('QT'); d.language = 'en';
    const html = renderToStaticMarkup(<ReferencePreview doc={d} />);
    expect(html).not.toContain(d.rows[0].name); expect(html).toContain(d.rows[0].nameEn);
    d.language = 'zh';
    const chinese = renderToStaticMarkup(<ReferencePreview doc={d} />);
    expect(chinese).toContain(d.rows[0].name); expect(chinese).not.toContain(d.rows[0].nameEn);
  });
  it('preserves sub-cent unit prices in the preview while rounding line amounts', () => {
    const d = fixture('QT'); d.rows[0].price = '0.005'; d.rows[0].qty = '1';
    const html = renderToStaticMarkup(<ReferencePreview doc={d} />);
    expect(html).toContain('<td>0.005</td>'); expect(amount(d.rows[0])).toBe('0.01');
  });
  it.each(['', '  ', '0', '0.00'])('shows blank or zero PI freight %j as 0.00 without changing the draft', freight => {
    const d = fresh('PI'); d.fields.freight = freight;
    const before = JSON.stringify(d);
    const html = renderToStaticMarkup(<ReferencePreview doc={d} />);
    expect(html).toContain('<strong data-field="freight">USD 0.00</strong>');
    expect(JSON.stringify(d)).toBe(before);
  });
  it('keeps entered and invalid PI freight distinct from the blank zero display', () => {
    const d = fresh('PI'); d.fields.freight = '12.5';
    expect(renderToStaticMarkup(<ReferencePreview doc={d} />)).toContain('<strong data-field="freight">USD 12.50</strong>');
    d.fields.freight = 'invalid';
    expect(renderToStaticMarkup(<ReferencePreview doc={d} />)).toContain('<strong data-field="freight">USD —</strong>');
  });
  it('uses the complete customs field inventory for spreadsheet columns', () => {
    expect(columns('CD').slice(-6)).toEqual(customsRowFields); expect(fields('CD').slice(-18)).toEqual(customsFields);
  });
});
