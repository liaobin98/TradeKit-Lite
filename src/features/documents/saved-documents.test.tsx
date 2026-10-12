import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { listSavedDocuments, savedDocumentRaw, savedDocumentTabs, filterSavedDocuments } from '@/features/documents/saved-documents';
import { DocumentLibrary } from '@/features/documents/DocumentLibrary';
import { decodeDoc, deleteDraft, saveDraft } from '@/features/documents/drafts';
import { fresh, types, type Kind } from '@/features/documents/model';
import { KEY } from '@/features/workspace/workspace-storage';

function storage() {
  const data = new Map<string, string>();
  const api = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }),
  } as unknown as Storage;
  return { data, api };
}
afterEach(() => vi.unstubAllGlobals());

describe('saved documents collection', () => {
  it('does not create drafts for an empty browser', () => {
    const s = storage();
    expect(listSavedDocuments(s.api)).toEqual({ documents: [], unreadable: [], rawByKind: {} });
    expect(s.api.setItem).not.toHaveBeenCalled(); expect(s.data.size).toBe(0);
  });
  it('collects saved documents of all types without writing or crossing types', () => {
    const s = storage(), kinds = Object.keys(types) as Kind[];
    for (const kind of kinds) saveDraft(fresh(kind), null, s.api);
    vi.mocked(s.api.setItem).mockClear();
    const result = listSavedDocuments(s.api);
    expect(result.documents.map(doc => doc.kind)).toEqual(kinds);
    expect(result.unreadable).toEqual([]); expect(s.api.setItem).not.toHaveBeenCalled();
    for (const kind of kinds) expect(result.rawByKind?.[kind]).toBe(s.data.get(KEY + 'draft:' + kind));
  });
  it('only lists each current document, not recovery copies or preferences', () => {
    const s = storage(), doc = fresh('QT');
    const first = saveDraft(doc, null, s.api);
    saveDraft({ ...doc, notes: '当前版本' }, first, s.api);
    s.data.set(KEY + 'seller', JSON.stringify({ seller: '默认公司' }));
    const result = listSavedDocuments(s.api);
    expect(result.documents).toHaveLength(1); expect(result.documents[0].notes).toBe('当前版本');
  });
  it('shows valid documents even when another is damaged and preserves the original', () => {
    const s = storage(); saveDraft(fresh('SC'), null, s.api);
    s.data.set(KEY + 'draft:QT', '{broken');
    s.data.set(KEY + 'draft:PI', JSON.stringify(fresh('CI')));
    const result = listSavedDocuments(s.api);
    expect(result.documents.map(doc => doc.kind)).toEqual(['SC']);
    expect(result.unreadable.map(doc => doc.kind)).toEqual(['QT', 'PI']);
    expect(s.data.get(KEY + 'draft:QT')).toBe('{broken'); expect(s.api.removeItem).not.toHaveBeenCalled();
  });
  it('retains incomplete and invalid numeric drafts so they can be edited', () => {
    const s = storage(), doc = fresh('QT'); doc.rows[0].price = '-1';
    saveDraft(doc, null, s.api);
    expect(listSavedDocuments(s.api).documents[0].rows[0].price).toBe('-1');
  });
});

describe('saved documents view', () => {
  it('has an empty state with a clear create action and no fake documents', () => {
    const s = storage(); vi.stubGlobal('localStorage', s.api);
    const html = renderToStaticMarkup(<DocumentLibrary onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('还没有保存的单据'); expect(html).toContain('开始制作单据');
    expect(html).not.toContain('<tbody>'); expect(s.api.setItem).not.toHaveBeenCalled();
  });
  it('displays each saved document number, customer and type in an accessible table', () => {
    const s = storage(), doc = fresh('SC');
    doc.fields.number = 'SC-LIBRARY-001'; doc.fields.buyer = 'Library buyer'; doc.rows[0].name = 'Product';
    saveDraft(doc, null, s.api); vi.stubGlobal('localStorage', s.api);
    const html = renderToStaticMarkup(<DocumentLibrary onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('SC-LIBRARY-001'); expect(html).toContain('Library buyer'); expect(html).toContain('销售合同');
    expect(html).toContain('scope="col"'); expect(html).toContain('scope="row"');
    expect(html).toContain('打开销售合同 SC-LIBRARY-001'); expect(html).not.toContain('还没有保存的单据');
    expect(html).toContain('class="documents-row"'); expect(html).toContain('document-open');
    expect(html).toContain('删除销售合同 SC-LIBRARY-001'); expect(html).toContain('title="删除单据"');
    expect(html).not.toContain('打开单据'); expect(html).not.toContain('role="button"');
    expect(html).toContain('role="tablist"'); expect(html).toContain('aria-label="单据类型"');
    expect(html).toContain('全部 (1)'); expect(html).toContain('销售合同 (1)');
    expect(html).not.toContain('报价单 (0)'); expect(html).not.toContain('value="QT"');
    expect(html).toContain('role="tabpanel"');
  });
  it('shows storage access errors without claiming there are no saved documents', () => {
    vi.stubGlobal('localStorage', { getItem() { throw Error('access denied'); } });
    const html = renderToStaticMarkup(<DocumentLibrary onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('role="alert"'); expect(html).toContain('无法读取浏览器存储');
    expect(html).not.toContain('还没有保存的单据');
  });
});

describe('delete saved document', () => {
  it('recovers missing list snapshots safely instead of rejecting a visible saved document', () => {
    const s = storage(), doc = fresh('PI'), raw = saveDraft(doc, null, s.api);
    const listed = listSavedDocuments(s.api).documents[0];
    const snapshot = savedDocumentRaw(listed, undefined, s.api);
    expect(snapshot).toBe(raw); deleteDraft('PI', snapshot, s.api);
    expect(s.data.has(KEY + 'draft:PI')).toBe(false);
  });
  it('keeps the original list snapshot when the stored record has subsequently changed', () => {
    const s = storage(), doc = fresh('QT'), raw = saveDraft(doc, null, s.api);
    const listed = listSavedDocuments(s.api);
    saveDraft({ ...doc, notes: 'Updated later' }, raw, s.api);
    expect(savedDocumentRaw(listed.documents[0], listed.rawByKind, s.api)).toBe(raw);
    expect(() => deleteDraft('QT', raw, s.api)).toThrow('另一标签页');
  });
  it('does not recover a missing snapshot by blindly accepting changed document content or status', () => {
    const s = storage(), doc = fresh('QT'), raw = saveDraft(doc, null, s.api);
    const listed = listSavedDocuments(s.api).documents[0];
    s.data.set(KEY + 'draft:QT', JSON.stringify({ ...doc, notes: 'Different contents' }));
    expect(() => savedDocumentRaw(listed, undefined, s.api)).toThrow('另一标签页');
    s.data.set(KEY + 'draft:QT', JSON.stringify({ ...doc, issued: { via: 'excel', at: '2026-10-11T00:00:00Z' } }));
    expect(() => savedDocumentRaw(listed, undefined, s.api)).toThrow('另一标签页');
    expect(s.api.removeItem).not.toHaveBeenCalled(); expect(raw).toBe(JSON.stringify(doc));
  });
  it('compares legacy records without their regenerated row IDs or default document number', () => {
    const s = storage(), source = fresh('SC');
    delete source.fields.number; delete source.fields.date;
    const legacy = { ...source, rows: source.rows.map(({ id: _id, ...contents }) => contents) };
    const raw = JSON.stringify(legacy); s.data.set(KEY + 'draft:SC', raw);
    const listed = decodeDoc(JSON.parse(raw), 'SC');
    expect(savedDocumentRaw(listed, undefined, s.api)).toBe(raw);
    deleteDraft('SC', raw, s.api); expect(s.data.has(KEY + 'draft:SC')).toBe(false);
  });
  it('handles legacy duplicate row IDs without mistaking migrations for content updates', () => {
    const s = storage(), doc = fresh('QT'); doc.rows.push({ ...doc.rows[0], name: 'Another product' });
    const raw = JSON.stringify(doc); s.data.set(KEY + 'draft:QT', raw);
    const listed = listSavedDocuments(s.api).documents[0];
    expect(savedDocumentRaw(listed, undefined, s.api)).toBe(raw);
    s.data.set(KEY + 'draft:QT', JSON.stringify({ ...doc, rows: [{ ...doc.rows[0], name: 'Changed' }, doc.rows[1]] }));
    expect(() => savedDocumentRaw(listed, undefined, s.api)).toThrow('另一标签页');
  });
  it('rejects missing or damaged records without changing storage', () => {
    const s = storage(), doc = fresh('QT');
    expect(() => savedDocumentRaw(doc, undefined, s.api)).toThrow('已被删除');
    s.data.set(KEY + 'draft:QT', '{broken');
    expect(() => savedDocumentRaw(doc, undefined, s.api)).toThrow();
    expect(s.api.setItem).not.toHaveBeenCalled(); expect(s.api.removeItem).not.toHaveBeenCalled();
  });
  it('removes only the selected record and its local recovery versions', () => {
    const s = storage(), doc = fresh('QT');
    const previous = saveDraft(doc, null, s.api);
    const raw = saveDraft({ ...doc, notes: 'current' }, previous, s.api);
    s.data.set(KEY + 'draft-corrupt:QT', '{damaged old version');
    const other = saveDraft(fresh('SC'), null, s.api);
    s.data.set(KEY + 'seller', '{"seller":"Default seller"}');
    s.data.set(KEY + 'settings', '{"language":"both"}');
    s.data.set('unrelated', 'keep');
    deleteDraft('QT', raw, s.api);
    for (const prefix of ['draft:', 'draft-previous:', 'draft-corrupt:']) expect(s.data.has(KEY + prefix + 'QT')).toBe(false);
    expect(s.data.get(KEY + 'draft:SC')).toBe(other);
    expect(s.data.get(KEY + 'seller')).toBe('{"seller":"Default seller"}');
    expect(s.data.get(KEY + 'settings')).toBe('{"language":"both"}');
    expect(s.data.get('unrelated')).toBe('keep');
    expect(listSavedDocuments(s.api).documents.map(value => value.kind)).toEqual(['SC']);
  });

  it('also deletes issued documents without creating a replacement draft', () => {
    const s = storage(), doc = fresh('PI');
    doc.issued = { via: 'excel', at: '2026-10-11T00:00:00Z' };
    const raw = saveDraft(doc, null, s.api);
    vi.mocked(s.api.setItem).mockClear();
    deleteDraft('PI', raw, s.api);
    expect(listSavedDocuments(s.api).documents).toEqual([]);
    expect(s.api.setItem).not.toHaveBeenCalled();
  });

  it('refuses a changed or already deleted record without removing recovery versions', () => {
    const s = storage(), doc = fresh('QT');
    const raw = saveDraft(doc, null, s.api);
    const newer = saveDraft({ ...doc, notes: 'newer from other tab' }, raw, s.api);
    expect(() => deleteDraft('QT', raw, s.api)).toThrow('另一标签页');
    expect(s.data.get(KEY + 'draft:QT')).toBe(newer);
    expect(s.data.get(KEY + 'draft-previous:QT')).toBe(raw);
    expect(s.api.removeItem).not.toHaveBeenCalled();
    s.data.delete(KEY + 'draft:QT');
    expect(() => deleteDraft('QT', raw, s.api)).toThrow('另一标签页');
    expect(s.api.removeItem).not.toHaveBeenCalled();
  });

  it('does not remove a record of a different type or damaged contents', () => {
    const s = storage();
    s.data.set(KEY + 'draft:QT', JSON.stringify(fresh('SC')));
    expect(() => deleteDraft('QT', s.data.get(KEY + 'draft:QT')!, s.api)).toThrow('草稿格式');
    s.data.set(KEY + 'draft:QT', '{broken');
    expect(() => deleteDraft('QT', '{broken', s.api)).toThrow();
    expect(s.api.removeItem).not.toHaveBeenCalled();
  });

  it('restores local recovery versions if removing the current record fails', () => {
    const s = storage(), doc = fresh('QT');
    const previous = saveDraft(doc, null, s.api);
    const raw = saveDraft({ ...doc, notes: 'current' }, previous, s.api);
    s.data.set(KEY + 'draft-corrupt:QT', 'damaged recovery');
    const before = new Map(s.data);
    vi.mocked(s.api.removeItem).mockImplementation(key => {
      if (key === KEY + 'draft:QT') throw Error('permission denied');
      s.data.delete(key);
    });
    expect(() => deleteDraft('QT', raw, s.api)).toThrow('已撤回本次删除');
    expect(s.data).toEqual(before);
  });

  it('does not overwrite a newer main record or newer recovery version during rollback', () => {
    const s = storage(), doc = fresh('QT');
    const previous = saveDraft(doc, null, s.api);
    const raw = saveDraft({ ...doc, notes: 'current' }, previous, s.api);
    const newer = JSON.stringify({ ...doc, notes: 'newer from other tab' });
    s.data.set(KEY + 'draft-corrupt:QT', 'old damaged recovery');
    vi.mocked(s.api.removeItem).mockImplementation(key => {
      s.data.delete(key);
      if (key === KEY + 'draft-corrupt:QT') {
        s.data.set(KEY + 'draft:QT', newer);
        s.data.set(KEY + 'draft-previous:QT', 'newer recovery from other tab');
      }
    });
    expect(() => deleteDraft('QT', raw, s.api)).toThrow('部分本地恢复版本无法恢复');
    expect(s.data.get(KEY + 'draft:QT')).toBe(newer);
    expect(s.data.get(KEY + 'draft-previous:QT')).toBe('newer recovery from other tab');
  });

  it('reports rollback failure without claiming complete recovery', () => {
    const s = storage(), doc = fresh('QT');
    const previous = saveDraft(doc, null, s.api);
    const raw = saveDraft({ ...doc, notes: 'current' }, previous, s.api);
    vi.mocked(s.api.removeItem).mockImplementation(key => {
      if (key === KEY + 'draft:QT') throw Error('permission denied');
      s.data.delete(key);
    });
    vi.mocked(s.api.setItem).mockImplementation(() => { throw Error('write denied'); });
    expect(() => deleteDraft('QT', raw, s.api)).toThrow('部分本地恢复版本无法恢复');
    expect(s.data.get(KEY + 'draft:QT')).toBe(raw);
  });
});

describe('document type tabs', () => {
  it('counts all documents and omits empty types in the existing type order', () => {
    const documents = [fresh('SC'), fresh('QT'), fresh('QT'), fresh('CD')];
    expect(savedDocumentTabs(documents)).toEqual([
      { value: 'all', label: '全部', count: 4 },
      { value: 'QT', label: '报价单', count: 2 },
      { value: 'SC', label: '销售合同', count: 1 },
      { value: 'CD', label: '报关信息', count: 1 },
    ]);
  });

  it('does not invent counts or type tabs for an empty collection', () => {
    expect(savedDocumentTabs([])).toEqual([{ value: 'all', label: '全部', count: 0 }]);
  });

  it('filters by type without mutating documents or their order', () => {
    const documents = [fresh('QT'), fresh('PI'), fresh('QT')];
    const original = JSON.stringify(documents);
    expect(filterSavedDocuments(documents, 'all')).toEqual(documents);
    expect(filterSavedDocuments(documents, 'QT')).toEqual([documents[0], documents[2]]);
    expect(filterSavedDocuments(documents, 'SC')).toEqual([]);
    expect(JSON.stringify(documents)).toBe(original);
  });

  it('does not count unreadable drafts or recovery copies as documents', () => {
    const s = storage(), d = fresh('PI');
    const first = saveDraft(d, null, s.api); saveDraft({ ...d, notes: 'updated' }, first, s.api);
    s.data.set(KEY + 'draft:QT', '{broken');
    const result = listSavedDocuments(s.api);
    expect(savedDocumentTabs(result.documents)).toEqual([
      { value: 'all', label: '全部', count: 1 }, { value: 'PI', label: 'PI', count: 1 },
    ]);
  });
});
