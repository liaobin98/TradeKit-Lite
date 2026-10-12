import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { documentStatus, editDocument, issueDocument, reopenDocument, sameDocumentContent, validIssue, deferDocumentIssue, retainPendingIssue, issuePendingDocument } from '@/features/documents/document-status';
import { fresh, types, type Kind, type Doc } from '@/features/documents/model';
import { decodeDoc, saveDraft, parseBackup, serializeBackup, previousDraft, DraftConflictError } from '@/features/documents/drafts';
import { DocumentLibrary } from '@/features/documents/DocumentLibrary';
import { assertExportable, validateIssueCompleteness } from '@/features/documents/validation';

const at = '2026-10-11T06:00:00.000Z';
function complete(kind: Kind): Doc {
  const doc = fresh(kind);
  doc.fields.seller = 'Test Seller'; doc.fields.buyer = 'Test Buyer';
  doc.rows[0] = { ...doc.rows[0], name: 'Test Product', qty: '2', price: '3.25' };
  return doc;
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as unknown as Storage;
}
afterEach(() => vi.unstubAllGlobals());

describe('document issue status', () => {
  it.each(Object.keys(types) as Kind[])('treats new, auto-saved and manually saved %s as draft', kind => {
    const doc = fresh(kind), s = storage();
    const raw = saveDraft(doc, null, s);
    saveDraft(doc, raw, s);
    expect(documentStatus(decodeDoc(JSON.parse(raw))).label).toBe('草稿单');
    expect(doc.issued).toBeUndefined();
  });

  it.each(['excel', 'pdf', 'print'] as const)('records %s output and preserves it across saving, decoding and backup', via => {
    const doc = complete('QT'), issued = issueDocument(doc, doc, via, at), s = storage();
    expect(issued.issued).toEqual({ via, at });
    expect(documentStatus(issued).label).toBe('已出单');
    expect(doc.issued).toBeUndefined();
    const raw = saveDraft(issued, null, s);
    expect(saveDraft(issued, raw, s)).toBe(raw);
    expect(decodeDoc(JSON.parse(raw))).toEqual(issued);
    expect(parseBackup(serializeBackup(issued))).toEqual(issued);
  });

  it.each([
    (doc: Doc) => ({ ...doc, fields: { ...doc.fields, buyer: 'Changed' } }),
    (doc: Doc) => ({ ...doc, rows: doc.rows.map(row => ({ ...row, qty: '3' })) }),
    (doc: Doc) => ({ ...doc, notes: 'Changed' }),
    (doc: Doc) => ({ ...doc, language: 'en' as const }),
    (doc: Doc) => ({ ...doc, layout: 'compact' }),
    (doc: Doc) => ({ ...doc, theme: '#123456' }),
    (doc: Doc) => ({ ...doc, logo: 'data:image/png;base64,AA==' }),
    (doc: Doc) => ({ ...doc, seal: 'data:image/png;base64,AA==' }),
  ])('refuses content edits while a document is issued', change => {
    const doc = complete('CI'), issued = issueDocument(doc, doc, 'pdf', at);
    const edited = editDocument(issued, change(issued));
    expect(edited).toBe(issued);
    expect(documentStatus(edited).value).toBe('issued');
    expect(issued.issued).toEqual({ via: 'pdf', at });
  });

  it('explicitly reopens a document as a draft without altering its contents', () => {
    const doc = complete('CI'), issued = issueDocument(doc, doc, 'pdf', at);
    const reopened = reopenDocument(issued);
    expect(reopened.issued).toBeUndefined();
    expect(sameDocumentContent(reopened, issued)).toBe(true);
    const edited = editDocument(reopened, { ...reopened, notes: 'New revision' });
    expect(edited.notes).toBe('New revision');
    expect(documentStatus(edited).value).toBe('draft');
    const s = storage(), raw = saveDraft(issued, null, s);
    const draftRaw = saveDraft(reopened, raw, s);
    expect(decodeDoc(JSON.parse(draftRaw))).toEqual(reopened);
  });

  it('retains the issued status for a no-op edit and ignores property order', () => {
    const doc = complete('PL'), issued = issueDocument(doc, doc, 'excel', at);
    const reordered = { ...issued, fields: Object.fromEntries(Object.entries(issued.fields).reverse()) };
    expect(sameDocumentContent(issued, reordered)).toBe(true);
    expect(editDocument(issued, reordered).issued).toEqual(issued.issued);
  });

  it('does not mark intervening edits or a different document as issued', () => {
    const doc = complete('QT'), changed = { ...doc, notes: 'Edited during output' };
    expect(issueDocument(changed, doc, 'pdf', at)).toBe(changed);
    const different = fresh('SC');
    expect(issueDocument(different, doc, 'print', at)).toBe(different);
  });

  it('does not allow an editor update to introduce an issued status', () => {
    const doc = complete('SC'), issued = issueDocument(doc, doc, 'pdf', at);
    expect(editDocument(doc, issued).issued).toBeUndefined();
  });

  it('allows reissuing an edited version and preserves previous draft history', () => {
    const doc = complete('PI'), s = storage();
    const first = issueDocument(doc, doc, 'pdf', at);
    const raw = saveDraft(first, null, s);
    const reopened = reopenDocument(first);
    const edited = editDocument(reopened, { ...reopened, notes: 'Revision 2' });
    const secondRaw = saveDraft(edited, raw, s);
    expect(previousDraft('PI', s)?.issued).toEqual(first.issued);
    const second = issueDocument(edited, edited, 'excel', at);
    saveDraft(second, secondRaw, s);
    expect(documentStatus(second).value).toBe('issued');
    expect(previousDraft('PI', s)?.issued).toBeUndefined();
  });

  it('still refuses output-status writes over changes made in another tab', () => {
    const doc = complete('QT'), s = storage(), raw = saveDraft(doc, null, s);
    const other = saveDraft({ ...doc, notes: 'Other tab' }, raw, s);
    expect(() => saveDraft(issueDocument(doc, doc, 'excel', at), raw, s)).toThrow(DraftConflictError);
    expect(s.getItem('trade-toolbox:v1:draft:QT')).toBe(other);
  });

  it.each([undefined, null, true, 'issued', { via: 'print', at: 'bad' }, { via: 'backup', at }, { via: '__proto__', at }])('ignores malformed status without losing the document: %s', issued => {
    const doc = fresh('QT');
    const decoded = decodeDoc({ ...doc, issued });
    expect(validIssue(issued)).toBe(false);
    expect(decoded).toEqual(doc);
    expect(documentStatus(decoded).value).toBe('draft');
  });

  it('explains that a print request is not confirmation of physical printing', () => {
    const doc = complete('CD');
    expect(documentStatus(issueDocument(doc, doc, 'print', at)).description).toContain('无法确认实际打印完成或取消');
  });

  it.each(Object.keys(types) as Kind[])('keeps %s editable after every output method and issues only its unchanged snapshot on departure', kind => {
    for (const via of ['print', 'excel', 'pdf'] as const) {
      const doc = complete(kind), pending = deferDocumentIssue(doc, doc, via, at);
      expect(pending).not.toBeNull(); expect(doc.issued).toBeUndefined();
      expect(documentStatus(doc).value).toBe('draft');
      const issued = issuePendingDocument(doc, pending);
      expect(issued.issued).toEqual({ via, at });
      expect(sameDocumentContent(doc, issued)).toBe(true);
      expect(doc.issued).toBeUndefined();
    }
  });
  it.each([
    (doc: Doc) => ({ ...doc, fields: { ...doc.fields, buyer: 'Changed' } }),
    (doc: Doc) => ({ ...doc, rows: doc.rows.map(row => ({ ...row, qty: '3' })) }),
    (doc: Doc) => ({ ...doc, notes: 'Changed' }),
    (doc: Doc) => ({ ...doc, language: 'en' as const }),
    (doc: Doc) => ({ ...doc, layout: 'executive' }),
    (doc: Doc) => ({ ...doc, theme: '#123456' }),
    (doc: Doc) => ({ ...doc, logo: 'data:image/png;base64,AA==' }),
    (doc: Doc) => ({ ...doc, seal: 'data:image/png;base64,AA==' }),
  ])('cancels pending output on a real edit, even when the user later undoes it', change => {
    const doc = complete('QT'), changed = editDocument(doc, change(doc));
    for (const via of ['print', 'excel', 'pdf'] as const) {
      const pending = deferDocumentIssue(doc, doc, via, at);
      expect(changed).not.toBe(doc);
      expect(issuePendingDocument(changed, pending)).toBe(changed);
      const cancelled = retainPendingIssue(pending, changed);
      expect(cancelled).toBeNull(); expect(retainPendingIssue(cancelled, doc)).toBeNull();
      expect(issuePendingDocument(doc, cancelled)).toBe(doc);
    }
  });
  it('allows a fresh print after edits and ignores no-op changes or property order', () => {
    const doc = complete('QT'), changed = { ...doc, notes: 'Revision 2' };
    const pending = deferDocumentIssue(changed, changed, 'print', at);
    const reordered = { ...changed, fields: Object.fromEntries(Object.entries(changed.fields).reverse()) };
    expect(retainPendingIssue(pending, reordered)).toBe(pending);
    expect(issuePendingDocument(reordered, pending).issued?.via).toBe('print');
  });
  it('does not create a print issue for failed/changed output or override an already issued Excel/PDF document', () => {
    const doc = complete('QT'), changed = { ...doc, notes: 'Changed during print' };
    expect(deferDocumentIssue(changed, doc, 'print', at)).toBeNull();
    expect(deferDocumentIssue(doc, doc, 'print', 'invalid date')).toBeNull();
    expect(issuePendingDocument(doc, null)).toBe(doc);
    const pending = deferDocumentIssue(doc, doc, 'print', at);
    for (const via of ['excel', 'pdf'] as const) {
      const issued = issueDocument(doc, doc, via, at);
      expect(deferDocumentIssue(issued, issued, 'print', at)).toBeNull();
      expect(issuePendingDocument(issued, pending)).toBe(issued);
      expect(retainPendingIssue(pending, issued)).toBeNull();
    }
  });
  it('detaches the print snapshot and does not carry it into another document', () => {
    const doc = complete('QT');
    const pending = deferDocumentIssue(doc, doc, 'print', at)!;
    doc.fields.buyer = 'Changed in memory';
    expect(pending.snapshot.fields.buyer).toBe('Test Buyer');
    expect(issuePendingDocument(doc, pending)).toBe(doc);
    const other = fresh('PI'); expect(issuePendingDocument(other, pending)).toBe(other);
  });
  it('records the latest successful output method and timestamp on departure', () => {
    const doc = complete('QT');
    let pending = deferDocumentIssue(doc, doc, 'print', at);
    const later = '2026-10-11T07:00:00.000Z';
    pending = deferDocumentIssue(doc, doc, 'pdf', later);
    expect(issuePendingDocument(doc, pending).issued).toEqual({ via: 'pdf', at: later });
  });

  it.each(Object.keys(types) as Kind[])('does not issue incomplete %s through any output method', kind => {
    const doc = fresh(kind);
    expect(() => assertExportable(doc)).not.toThrow();
    expect(validateIssueCompleteness(doc).length).toBeGreaterThan(0);
    for (const via of ['print', 'excel', 'pdf'] as const) {
      expect(deferDocumentIssue(doc, doc, via, at)).toBeNull();
      expect(issueDocument(doc, doc, via, at)).toBe(doc);
      expect(issuePendingDocument(doc, { snapshot: structuredClone(doc), via, at })).toBe(doc);
      expect(documentStatus(doc).value).toBe('draft');
    }
  });
  it.each(['number', 'date', 'seller', 'buyer', 'currency'])('requires nonblank %s without blocking draft output', key => {
    const doc = complete('QT'); doc.fields[key] = ' \t ';
    expect(() => assertExportable(doc)).not.toThrow();
    expect(validateIssueCompleteness(doc).some(issue => issue.path === `fields.${key}`)).toBe(true);
    expect(deferDocumentIssue(doc, doc, 'pdf', at)).toBeNull();
  });
  it.each(['not a date', '2026-02-30', '2026-13-01', '2026-2-01'])('requires a real calendar date: %s', date => {
    const doc = complete('QT'); doc.fields.date = date;
    expect(validateIssueCompleteness(doc).some(issue => issue.path === 'fields.date')).toBe(true);
    expect(issueDocument(doc, doc, 'print', at)).toBe(doc);
  });
  it.each(['name', 'qty', 'unit', 'price'] as const)('requires %s on every row, including partially filled trailing rows', key => {
    const doc = complete('PL');
    const extra = { ...doc.rows[0], id: 'extra-row', [key]: ' ' }; doc.rows.push(extra);
    expect(validateIssueCompleteness(doc).some(issue => issue.path === `rows.extra-row.${key}`)).toBe(true);
    expect(deferDocumentIssue(doc, doc, 'excel', at)).toBeNull();
  });
  it.each(['0', '-1', 'abc', '1e3'])('rejects nonpositive/invalid quantities: %s', qty => {
    const doc = complete('QT'); doc.rows[0].qty = qty;
    expect(issueDocument(doc, doc, 'pdf', at)).toBe(doc);
  });
  it('requires at least one complete row and rejects extra blank rows', () => {
    const doc = complete('QT'); doc.rows = [];
    expect(validateIssueCompleteness(doc).some(issue => issue.path === 'rows')).toBe(true);
    doc.rows = [complete('QT').rows[0], fresh('QT').rows[0]];
    expect(deferDocumentIssue(doc, doc, 'print', at)).toBeNull();
  });
  it('allows zero prices, English-only product names and optional fields left empty', () => {
    const doc = complete('QT'); doc.rows[0].price = '0'; doc.rows[0].name = ''; doc.rows[0].nameEn = 'Gift';
    doc.fields.date = '2024-02-29';
    expect(validateIssueCompleteness(doc)).toEqual([]);
    expect(issuePendingDocument(doc, deferDocumentIssue(doc, doc, 'excel', at)).issued?.via).toBe('excel');
  });
  it('reuses numerical checks for customs totals, weights, freight and row amounts', () => {
    for (const doc of [complete('CD'), complete('PI'), complete('CI')]) {
      if (doc.kind === 'CD') { doc.fields.totalNet = '2 kg'; doc.fields.totalGross = '1 kg'; }
      else if (doc.kind === 'PI') doc.fields.freight = '-1';
      else { doc.rows[0].qty = '1000000000000'; doc.rows[0].price = '1000000000000'; }
      expect(validateIssueCompleteness(doc).length).toBeGreaterThan(0);
      expect(issueDocument(doc, doc, 'pdf', at)).toBe(doc);
    }
  });
  it('requires fresh output after filling missing information', () => {
    const doc = complete('QT'); doc.fields.seller = '';
    const pending = deferDocumentIssue(doc, doc, 'print', at);
    doc.fields.seller = 'Completed Seller';
    expect(issuePendingDocument(doc, pending)).toBe(doc);
    expect(issuePendingDocument(doc, deferDocumentIssue(doc, doc, 'pdf', at)).issued?.via).toBe('pdf');
  });
  it('preserves historical issued metadata rather than silently rewriting saved documents', () => {
    const historical = { ...fresh('QT'), issued: { via: 'pdf' as const, at } };
    expect(documentStatus(decodeDoc(historical)).value).toBe('issued');
    expect(deferDocumentIssue(historical, historical, 'print', at)).toBeNull();
    expect(issuePendingDocument(historical, null)).toBe(historical);
  });

  it('shows only draft labels even when listing legacy output metadata', () => {
    const draft = fresh('QT'), doc = complete('PI'), s = storage();
    saveDraft(draft, null, s); saveDraft(issueDocument(doc, doc, 'pdf', at), null, s);
    vi.stubGlobal('localStorage', s);
    const html = renderToStaticMarkup(<DocumentLibrary onOpen={() => {}} onCreate={() => {}} />);
    expect(html).toContain('<th scope="col">状态</th>');
    expect(html).toContain('document-status-draft'); expect(html).not.toContain('document-status-issued');
    expect(html).toContain('草稿'); expect(html).not.toContain('已出单');
    expect(html).toContain('全部 (2)');
  });
});
