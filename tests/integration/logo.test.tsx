import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReferencePreview, ReferenceWorkspace } from '../../src/features/documents/ReferenceWorkspace';
import { fresh, types, type Doc, type Kind } from '../../src/features/documents/model';
import { decodeDoc, saveDraft } from '../../src/features/documents/drafts';
import { mapStorage } from '../../src/features/workspace/workspace-storage';
import { catalogRaw, parseCatalogStore } from '../../src/features/catalogs/catalog-storage';
import { createWorkbook } from '../../src/features/documents/export';

const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
afterEach(() => vi.unstubAllGlobals());

function workspace(doc: Doc, busy = false) {
  vi.stubGlobal('localStorage', { getItem: () => null });
  return renderToStaticMarkup(<ReferenceWorkspace doc={doc} setDoc={vi.fn()} image={vi.fn()} text="" setText={vi.fn()} busy={busy} ai={false} aiRequiresToken={false} aiToken="" setAiToken={vi.fn()} consent={false} setConsent={vi.fn()} parse={vi.fn()} candidate={null} applyCandidate={vi.fn()} issues={[]} />);
}

describe('enterprise logo controls and persistence', () => {
  it('shows upload, but not deletion, before a logo has been uploaded', () => {
    const html = workspace(fresh('QT'));
    expect(html).toContain('上传企业 Logo');
    expect(html).not.toContain('aria-label="删除企业 Logo"');
    expect(html).not.toContain('更换企业 Logo');
  });
  it.each(Object.keys(types) as Kind[])('offers labeled replacement and deletion for an uploaded logo in %s', kind => {
    const doc = fresh(kind); doc.logo = logo;
    const html = workspace(doc);
    expect(html).toContain('更换企业 Logo');
    expect(html).toContain('aria-label="删除企业 Logo"');
    expect(html).toContain('删除 Logo');
    expect(html).not.toContain('logo-placeholder');
  });
  it('disables logo deletion only while busy', () => {
    const doc = fresh('QT'); doc.logo = logo;
    const button = workspace(doc, true).match(/<button[^>]*aria-label="删除企业 Logo"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button).toContain('disabled=""');
  });
  it('keeps saved documents editable, including logo deletion', () => {
    const doc = fresh('QT'); doc.logo = logo; doc.status = 'saved';
    const button = workspace(doc).match(/<button[^>]*aria-label="删除企业 Logo"[^>]*>/)?.[0];
    expect(button).toBeDefined(); expect(button).not.toContain('disabled=""');
  });
  it('persists a removed logo in the draft and latest seller copy without losing other fields', () => {
    const storage = mapStorage(new Map(), true), doc = fresh('QT');
    doc.fields.seller = 'Seller'; doc.logo = logo;
    const previous = saveDraft(doc, null, storage), removed = { ...doc, logo: '' };
    const raw = saveDraft(removed, previous, storage);
    expect(decodeDoc(JSON.parse(raw))).toEqual(removed);
    expect(parseCatalogStore(catalogRaw(storage)).records.sellers[0].images).toEqual([]);
    expect(workspace(removed)).not.toContain('aria-label="删除企业 Logo"');
  });
});

describe('logo output', () => {
  it.each(['zh', 'en', 'both'] as const)('keeps the %s upload hint on screen but excludes it from PDF capture', language => {
    const doc = fresh('QT'); doc.language = language;
    const html = renderToStaticMarkup(<ReferencePreview doc={doc} />);
    expect(html).toContain('<span class="logo-placeholder" data-html2canvas-ignore="true">');
    expect(html).toContain(language === 'en' ? 'Upload in editor' : '点击左侧上传');
  });
  it('hides only the placeholder in print styles, not the uploaded logo', () => {
    const css = readFileSync(new URL('../../src/styles/print.css', import.meta.url), 'utf8');
    expect(css).toContain('@media print');
    expect(css).toMatch(/\.reference-preview \.logo-placeholder\s*\{\s*display:\s*none\s*!important;/);
    const doc = fresh('QT'); doc.logo = logo;
    const html = renderToStaticMarkup(<ReferencePreview doc={doc} />);
    expect(html).toContain(`src="${logo}"`);
    expect(html).not.toContain('data-html2canvas-ignore');
  });
  it('includes a real logo in Excel, and no placeholder after logo removal', async () => {
    const doc = fresh('QT');
    expect((await createWorkbook(doc)).worksheets[0].getImages()).toHaveLength(0);
    doc.logo = logo;
    expect((await createWorkbook(doc)).worksheets[0].getImages()).toHaveLength(1);
    doc.logo = '';
    expect((await createWorkbook(doc)).worksheets[0].getImages()).toHaveLength(0);
  });
});
