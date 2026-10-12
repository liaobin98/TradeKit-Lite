import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fresh, types, type Doc, type Kind } from '../../src/features/documents/model';
import { tradeOptions, paymentOptions, deliveryOptions, units, presetText } from '../../src/features/documents/reference-model';
import { ReferencePreview, ReferenceWorkspace } from '../../src/features/documents/ReferenceWorkspace';
import { createWorkbook } from '../../src/features/documents/export';

const presets = [...tradeOptions, ...paymentOptions, ...deliveryOptions, ...units];

describe('selected document language', () => {
  it.each(presets)('localizes the preset %s without changing the bilingual value', value => {
    const en = presetText(value, 'en');
    const zh = presetText(value, 'zh');
    expect(en).not.toMatch(/[\u4e00-\u9fff]/);
    expect(zh).toMatch(/[\u4e00-\u9fff]/);
    expect(presetText(value, 'both')).toBe(value);
    expect(presetText(en, 'both')).toBe(value);
    expect(presetText(zh, 'en')).toBe(en);
  });

  it('preserves trade abbreviations and slashes inside English terms', () => {
    expect(presetText(tradeOptions[1], 'en')).toBe('FOB / Free On Board');
    expect(presetText(paymentOptions[0], 'en')).toBe('100% T/T in advance');
    expect(presetText(paymentOptions[2], 'en')).toBe('30% deposit, 70% against B/L copy');
    expect(presetText(paymentOptions[3], 'en')).toBe('L/C at sight');
  });

  it.each(['en', 'zh', 'both'] as const)('never alters custom text in %s mode', language => {
    for (const value of ['定制付款 / 60 days net', 'Custom / agreed / terms', 'PCS / special pack', '', '  客户确认后发货  ']) {
      expect(presetText(value, language)).toBe(value);
    }
  });

  it.each(Object.keys(types) as Kind[])('renders English preset values in %s without changing saved data', kind => {
    const d = fresh(kind); d.language = 'en'; d.rows[0].qty = '2'; d.rows[0].price = '3.25';
    const original = JSON.stringify(d);
    const html = renderToStaticMarkup(<ReferencePreview doc={d} />);
    expect(html).not.toMatch(/[\u4e00-\u9fff]/);
    expect(html).toContain('FOB / Free On Board');
    expect(html).toContain('30% deposit, 70% before shipment');
    expect(html).toContain('30 days after deposit');
    expect(html).toContain('2 PCS');
    expect(JSON.stringify(d)).toBe(original);
  });

  it.each(['en', 'zh', 'both'] as const)('uses localized values in the editor controls for %s', language => {
    const d = fresh('QT'); d.language = language;
    const noop = vi.fn();
    const html = renderToStaticMarkup(<ReferenceWorkspace doc={d} setDoc={noop} image={noop} text="" setText={noop} busy={false} ai={false} aiRequiresToken={false} aiToken="" setAiToken={noop} consent={false} setConsent={noop} parse={noop} candidate={null} applyCandidate={noop} issues={[]} />);
    for (const value of [d.fields.incoterm, d.fields.payment, d.fields.delivery, d.rows[0].unit]) {
      expect(html).toContain(`<span>${presetText(value, language)}</span>`);
    }
  });

  it.each(Object.keys(types) as Kind[])('stacks English above Chinese in the quantity and price headings for %s', kind => {
    const d = fresh(kind); d.language = 'both';
    const html = renderToStaticMarkup(<ReferencePreview doc={d} />);
    expect(html).toContain('<th><span class="preview-header-line" lang="en">QTY / UNIT</span><span class="preview-header-line" lang="zh-CN">数量 / 单位</span></th>');
    expect(html).toContain('<th><span class="preview-header-line" lang="en">UNIT PRICE</span><span class="preview-header-line" lang="zh-CN">单价</span></th>');
    expect(html.match(/class="preview-header-line"/g)).toHaveLength(4);
  });

  it.each(['en', 'zh'] as const)('keeps the quantity and price headings on one line in %s mode', language => {
    const d = fresh('QT'); d.language = language;
    const html = renderToStaticMarkup(<ReferencePreview doc={d} />);
    expect(html).not.toContain('preview-header-line');
    expect(html).toContain(language === 'en' ? '<th>QTY / UNIT</th>' : '<th>数量 / 单位</th>');
    expect(html).toContain(language === 'en' ? '<th>UNIT PRICE</th>' : '<th>单价</th>');
  });

  it.each(['en', 'zh', 'both'] as const)('localizes Excel headers and selected values in %s', async language => {
    const d = fresh('PI'); d.language = language;
    const original = JSON.stringify(d);
    const book = await createWorkbook(d);
    const rows: unknown[] = [];
    book.worksheets[0].eachRow(row => rows.push(row.values));
    const text = JSON.stringify(rows);
    for (const value of [d.fields.incoterm, d.fields.payment, d.fields.delivery, d.rows[0].unit]) {
      expect(text).toContain(presetText(value, language));
    }
    if (language === 'en') expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    expect(JSON.stringify(d)).toBe(original);
  });

  it('preserves custom business text in the preview and spreadsheet', async () => {
    const d: Doc = fresh('QT'); d.language = 'en';
    d.fields.payment = '按合同约定 / Custom agreement'; d.rows[0].unit = '客户单位 / pack'; d.rows[0].qty = '2';
    const html = renderToStaticMarkup(<ReferencePreview doc={d} />);
    expect(html).toContain(d.fields.payment); expect(html).toContain(d.rows[0].unit);
    const rows: unknown[] = []; const book = await createWorkbook(d);
    book.worksheets[0].eachRow(row => rows.push(row.values));
    expect(JSON.stringify(rows)).toContain(d.fields.payment); expect(JSON.stringify(rows)).toContain(d.rows[0].unit);
  });
});
