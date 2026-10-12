import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fresh, row, types, type Kind } from '@/features/documents/model';
import { copyProductRow, removeProductRow, needsProductRemovalConfirmation } from '@/features/documents/product-rows';
import { ReferenceWorkspace } from '@/features/documents/ReferenceWorkspace';

afterEach(() => vi.unstubAllGlobals());

describe('product row actions', () => {
  it('copies every product field into an independent row immediately after its source', () => {
    const original = { ...row(), name: '产品', nameEn: 'Product', code: 'SKU', spec: 'Large', qty: '3', price: '12.50', packing: 'Box', cartons: '2', net: '4 kg', gross: '5 kg', volume: '1', hs: '8471', elements: 'Details', origin: 'China', image: 'data:image/png;base64,image' };
    const next = row(), rows = [original, next], before = JSON.stringify(rows);
    const result = copyProductRow(rows, original.id);
    expect(result).toHaveLength(3); expect(result[0]).toBe(original); expect(result[2]).toBe(next);
    expect(result[1]).toEqual({ ...original, id: result[1].id }); expect(result[1].id).not.toBe(original.id);
    expect(result[1]).not.toBe(original); result[1].name = 'New product';
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('generates unique identifiers on repeated copies', () => {
    const rows = [row()]; const once = copyProductRow(rows, rows[0].id), twice = copyProductRow(once, rows[0].id);
    expect(new Set(twice.map(product => product.id)).size).toBe(3);
  });
  it('deletes the entire selected product and leaves other rows unchanged', () => {
    const rows = [row(), row(), row()]; rows[1].name = 'To delete'; rows[1].image = 'image';
    expect(removeProductRow(rows, rows[1].id)).toEqual([rows[0], rows[2]]); expect(rows).toHaveLength(3);
  });
  it('keeps a new blank editable row when deleting the only product', () => {
    const original = { ...row(), name: 'Last product', qty: '9', image: 'image' };
    const result = removeProductRow([original], original.id);
    expect(result).toHaveLength(1); expect(result[0].id).not.toBe(original.id);
    expect(result[0]).toMatchObject({ name: '', qty: '', price: '', image: '' });
  });
  it('ignores actions for rows that no longer exist', () => {
    const rows = [row()]; expect(copyProductRow(rows, 'missing')).toBe(rows); expect(removeProductRow(rows, 'missing')).toBe(rows);
  });
});

describe('product removal confirmation', () => {
  it('skips confirmation for an empty row with default unit and carton count', () => {
    expect(needsProductRemovalConfirmation(row())).toBe(false);
  });
  it('skips confirmation when only one attribute is filled', () => {
    expect(needsProductRemovalConfirmation({ ...row(), name: '产品' })).toBe(false);
    expect(needsProductRemovalConfirmation({ ...row(), qty: '2' })).toBe(false);
    expect(needsProductRemovalConfirmation({ ...row(), unit: '箱 / CTN' })).toBe(false);
    expect(needsProductRemovalConfirmation({ ...row(), image: 'data:image/png;base64,image' })).toBe(false);
  });
  it('requires confirmation from exactly two filled attributes onward', () => {
    expect(needsProductRemovalConfirmation({ ...row(), name: '产品', spec: 'Large' })).toBe(true);
    expect(needsProductRemovalConfirmation({ ...row(), name: '产品', qty: '2', price: '10' })).toBe(true);
    expect(needsProductRemovalConfirmation({ ...row(), name: '产品', image: 'data:image/png;base64,image' })).toBe(true);
    expect(needsProductRemovalConfirmation({ ...row(), unit: '箱 / CTN', cartons: '3' })).toBe(true);
  });
  it('ignores whitespace and equivalent default values', () => {
    expect(needsProductRemovalConfirmation({ ...row(), name: '产品', spec: '  ', unit: ' 件 / PCS ', cartons: '0.00' })).toBe(false);
  });
  it('counts explicitly entered quantity and price even when zero', () => {
    expect(needsProductRemovalConfirmation({ ...row(), qty: '0', price: '0.00' })).toBe(true);
  });
});

describe('product action layout', () => {
  it.each(Object.keys(types) as Kind[])('places labeled icon actions under the image picker without an operation column in %s', kind => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const doc = fresh(kind); doc.rows[0].image = 'data:image/png;base64,image';
    const html = renderToStaticMarkup(<ReferenceWorkspace doc={doc} setDoc={vi.fn()} image={vi.fn()} text="" setText={vi.fn()} busy={false} ai={false} aiRequiresToken={false} aiToken="" setAiToken={vi.fn()} consent={false} setConsent={vi.fn()} parse={vi.fn()} candidate={null} applyCandidate={vi.fn()} issues={[]} />);
    const table = html.match(/<table class="product-editor-table">([\s\S]*?)<\/table>/)?.[1];
    expect(table).toBeDefined(); expect(table).not.toContain('<th>操作</th>');
    expect(table?.match(/<th>/g)).toHaveLength(6);
    const imageArea = table?.slice(table.indexOf('class="product-image-input"'), table.indexOf('class="product-names-input"'));
    expect(imageArea).toContain('换图');
    const preview = imageArea?.match(/<div class="product-image-preview">([\s\S]*?)<\/div>/)?.[1];
    expect(preview).toContain('<img');
    expect(preview).toMatch(/<button[^>]*class="[^"]*product-image-remove/);
    expect(preview).toContain('aria-label="删除产品 1 图片"');
    expect(preview).toContain('title="删除图片"');
    expect(preview).toContain('data-variant="outline"');
    expect(preview).toContain('lucide-x');
    expect(preview).not.toContain('>删除图片<');
    expect(imageArea).toContain('aria-label="删除产品 1"'); expect(imageArea).toContain('aria-label="复制产品 1"');
    expect(imageArea!.indexOf('换图')).toBeLessThan(imageArea!.indexOf('product-row-actions'));
    if (kind === 'CD') expect(table).toContain('colSpan="6"');
  });
  it('does not show an image removal button for an empty image', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const doc = fresh('PI');
    const html = renderToStaticMarkup(<ReferenceWorkspace doc={doc} setDoc={vi.fn()} image={vi.fn()} text="" setText={vi.fn()} busy={false} ai={false} aiRequiresToken={false} aiToken="" setAiToken={vi.fn()} consent={false} setConsent={vi.fn()} parse={vi.fn()} candidate={null} applyCandidate={vi.fn()} issues={[]} />);
    expect(html).toContain('product-image-preview');
    expect(html).toContain('上传图片');
    expect(html).not.toContain('product-image-remove');
  });
});
