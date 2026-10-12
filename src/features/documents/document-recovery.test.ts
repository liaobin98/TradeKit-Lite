import { describe, expect, it } from 'vitest';
import { KEY, mapStorage } from '@/features/workspace/workspace-storage';
import { damagedDocuments, documentRaw, documentRecords, documentsRaw, initializeDocuments, newDocument, previousDocument, readDocument, readDocumentsEnvelope, recoverPreviousDocument, saveDocument } from '@/features/documents/documents-store';
import { createWorkspaceBackup, parseWorkspaceBackup, restoreWorkspaceBackup, serializeWorkspaceBackup, workspaceBackupSummary, workspaceSnapshot } from '@/features/workspace/workspace-backup';
import { readSavedCatalogs } from '@/features/catalogs/catalog-sync';

function fixture() {
  const storage = mapStorage(new Map(), true);
  initializeDocuments(storage);
  const bad = newDocument('QT'), good = newDocument('PI');
  saveDocument(bad, null, storage); saveDocument(good, null, storage);
  const store = readDocumentsEnvelope(documentsRaw(storage));
  store.records[bad.id!].previousRaw = store.records[bad.id!].raw;
  store.records[bad.id!].raw = '{broken original';
  storage.setItem(KEY + 'documents', JSON.stringify(store));
  return { storage, bad, good };
}

describe('damaged document isolation and rescue backups', () => {
  it('starts with one damaged record, reads and saves healthy records, and keeps the damaged raw untouched', () => {
    const { storage, bad, good } = fixture();
    initializeDocuments(storage);
    expect(readDocument(good.id!, storage)).toEqual(good);
    expect(documentRecords(storage).map(record => record.document.id)).toEqual([good.id]);
    expect(previousDocument(bad.id!, storage)).toEqual(bad);
    const raw = documentRaw(good.id!, storage);
    saveDocument({ ...good, notes: 'Updated healthy record' }, raw, storage);
    expect(documentRaw(bad.id!, storage)).toBe('{broken original');
    expect(() => readSavedCatalogs(storage)).not.toThrow();
  });
  it('restores a previous version while archiving the original, and round trips the archive', () => {
    const { storage, bad } = fixture();
    const record = damagedDocuments(storage)[0];
    recoverPreviousDocument(bad.id!, record.expected, storage);
    expect(readDocument(bad.id!, storage)).toEqual(bad);
    const archive = readDocumentsEnvelope(documentsRaw(storage)).quarantine!;
    expect(JSON.parse(archive[0]).record.raw).toBe('{broken original');
    expect(damagedDocuments(storage)).toHaveLength(0);
    const target = mapStorage(new Map(), true);
    restoreWorkspaceBackup(parseWorkspaceBackup(serializeWorkspaceBackup(createWorkspaceBackup(storage))), workspaceSnapshot(target), target);
    expect(readDocumentsEnvelope(documentsRaw(target)).quarantine).toEqual(archive);
  });
  it('does not overwrite another tab changing the record after recovery was offered', () => {
    const { storage, bad } = fixture();
    const record = damagedDocuments(storage)[0];
    const store = readDocumentsEnvelope(documentsRaw(storage));
    store.records[bad.id!].raw = JSON.stringify({ ...bad, notes: 'Other tab' });
    storage.setItem(KEY + 'documents', JSON.stringify(store));
    expect(() => recoverPreviousDocument(bad.id!, record.expected, storage)).toThrow();
    expect(readDocument(bad.id!, storage)?.notes).toBe('Other tab');
  });
  it('retains malformed entries and rejects an unrelated or damaged recovery version', () => {
    const { storage, bad, good } = fixture();
    const store = readDocumentsEnvelope(documentsRaw(storage));
    store.records[bad.id!].previousRaw = JSON.stringify(good);
    (store.records as Record<string, unknown>).malformed = null;
    storage.setItem(KEY + 'documents', JSON.stringify(store));
    expect(previousDocument(bad.id!, storage)).toBeNull();
    expect(damagedDocuments(storage)).toHaveLength(2);
    saveDocument({ ...good, notes: 'Still writable' }, documentRaw(good.id!, storage), storage);
    expect(readDocumentsEnvelope(documentsRaw(storage)).records.malformed).toBeNull();
  });
  it('backs up damaged and healthy records together without requiring a write', () => {
    const { storage, bad, good } = fixture();
    const original = documentsRaw(storage);
    const backup = createWorkspaceBackup(storage);
    expect(workspaceBackupSummary(backup).documents).toBe(1);
    expect(workspaceBackupSummary(backup).unreadable).toBe(1);
    const target = mapStorage(new Map(), true);
    restoreWorkspaceBackup(parseWorkspaceBackup(serializeWorkspaceBackup(backup)), workspaceSnapshot(target), target);
    expect(documentsRaw(storage)).toBe(original);
    expect(readDocument(good.id!, target)).toEqual(good);
    expect(previousDocument(bad.id!, target)).toEqual(bad);
  });
  it('rescues the unsaved editor as a separate record and retains the other tab version', () => {
    const { storage, good } = fixture();
    const editing = { ...good, notes: 'UNSAVED EDITING COPY' };
    const before = workspaceSnapshot(storage);
    const backup = createWorkspaceBackup(storage, editing);
    expect(backup.version).toBe(2);
    expect(workspaceSnapshot(storage)).toEqual(before);
    const plan = parseWorkspaceBackup(serializeWorkspaceBackup(backup));
    const target = mapStorage(new Map(), true);
    restoreWorkspaceBackup(plan, workspaceSnapshot(target), target);
    expect(readDocument(good.id!, target)).toEqual(good);
    const rescued = documentRecords(target).find(record => record.document.notes === editing.notes)!.document;
    expect(rescued.id).not.toBe(good.id);
    expect(rescued.status).toBe('draft');
  });
  it('rejects unsafe editing copies and refuses restore after a concurrent write', () => {
    const { storage, good } = fixture();
    const backup = createWorkspaceBackup(storage, good);
    expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, editing: { ...good, logo: 'javascript:alert(1)' } }))).toThrow();
    const expected = workspaceSnapshot(storage);
    saveDocument({ ...good, notes: 'Concurrent update' }, documentRaw(good.id!, storage), storage);
    expect(() => restoreWorkspaceBackup(parseWorkspaceBackup(serializeWorkspaceBackup(backup)), expected, storage)).toThrow();
  });
});
