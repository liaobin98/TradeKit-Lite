import { describe, expect, it, vi } from 'vitest';
import { fresh, types, type Kind } from '@/features/documents/model';
import { selectHomeDocument } from '@/features/documents/home-document';

function previous(kind: Kind) {
  const document = fresh(kind);
  Object.assign(document.fields, { number: 'PREVIOUS-001', seller: 'Previous seller', buyer: 'Previous buyer', bankAccount: 'BANK-001' });
  Object.assign(document.rows[0], { name: 'Previous product', qty: '8', price: '12.50' });
  document.notes = 'Previous notes';
  return document;
}

describe('homepage new-document choices', () => {
  it.each(Object.keys(types) as Kind[])('opens a genuinely blank %s form without prompting when no draft exists', async kind => {
    const ask = vi.fn();
    const selected = await selectHomeDocument(kind, null, ask);
    expect(ask).not.toHaveBeenCalled(); expect(selected.unsaved).toBe(true);
    expect(selected.document.kind).toBe(kind); expect(selected.document.rows).toHaveLength(1);
    expect(selected.document.rows[0]).toMatchObject({ name: '', qty: '', price: '', image: '' });
    expect(selected.document.fields.seller).toBeUndefined(); expect(selected.document.fields.buyer).toBeUndefined();
    expect(selected.document.notes).toBe(''); expect(selected.document.logo).toBe('');
  });
  it.each(Object.keys(types) as Kind[])('prompts only for the existing %s draft and restores its full contents on confirmation', async kind => {
    const document = previous(kind), raw = JSON.stringify(document), ask = vi.fn(async () => true);
    const selected = await selectHomeDocument(kind, raw, ask);
    expect(ask).toHaveBeenCalledExactlyOnceWith(document); expect(selected.document).toEqual(document);
    expect(selected.unsaved).toBe(false); expect(JSON.stringify(document)).toBe(raw);
  });
  it('creates a new empty document when restoration is declined without altering the previous contents', async () => {
    const document = previous('QT'), raw = JSON.stringify(document);
    const selected = await selectHomeDocument('QT', raw, async () => false);
    expect(selected.unsaved).toBe(true); expect(selected.document.rows[0].id).not.toBe(document.rows[0].id);
    expect(selected.document.fields.number).not.toBe('PREVIOUS-001'); expect(selected.document.fields.bankAccount).toBeUndefined();
    expect(selected.document.rows[0].name).toBe(''); expect(JSON.stringify(document)).toBe(raw);
  });
  it('does not open a document or change the prior content when the dialog is dismissed', async () => {
    const document = previous('QT'), raw = JSON.stringify(document);
    const selected = await selectHomeDocument('QT', raw, async () => null);
    expect(selected).toBeNull(); expect(JSON.stringify(document)).toBe(raw);
  });
  it('does not prompt to restore an already saved legacy issued document', async () => {
    const document = previous('PI'); document.issued = { via: 'excel', at: '2026-10-11T00:00:00Z' };
    const ask = vi.fn(async () => true);
    const selected = await selectHomeDocument('PI', JSON.stringify(document), ask);
    expect(selected.document.issued).toBeUndefined(); expect(selected.unsaved).toBe(true);
    expect(selected.document.rows[0].name).toBe(''); expect(document.issued.via).toBe('excel');
    expect(ask).not.toHaveBeenCalled();
  });
  it('only offers restoration for a draft, never for an explicitly saved document', async () => {
    const document = previous('QT'); document.id = crypto.randomUUID(); document.status = 'saved';
    const ask = vi.fn(async () => true);
    const selected = await selectHomeDocument('QT', JSON.stringify(document), ask);
    expect(ask).not.toHaveBeenCalled(); expect(selected.unsaved).toBe(true);
    document.status = 'draft';
    const restored = await selectHomeDocument('QT', JSON.stringify(document), ask);
    expect(ask).toHaveBeenCalledOnce(); expect(restored.document).toEqual(document);
  });
  it.each(['{broken', JSON.stringify(previous('PI'))])('does not try to restore damaged or mismatched content', async raw => {
    const ask = vi.fn(), selected = await selectHomeDocument('QT', raw, ask);
    expect(ask).not.toHaveBeenCalled(); expect(selected.unsaved).toBe(true); expect(selected.warning).toContain('原始内容仍保留');
    expect(selected.document.rows[0].name).toBe('');
  });
});
