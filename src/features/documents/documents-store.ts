import { fresh, types, type Doc, type Kind } from '@/features/documents/model';
import { KEY } from '@/features/workspace/workspace-storage';
import { decodeDoc, DraftConflictError } from '@/features/documents/drafts';
import { catalogRaw, captureCatalogDocuments, parseCatalogStore, CATALOG_DATA_KEY } from '@/features/catalogs/catalog-storage';
import { workspaceStorage } from '@/features/workspace/workspace-storage';

export const DOCUMENTS_DATA_KEY = 'documents';
export type DocumentRecord = { raw: string; previousRaw: string | null; updatedAt: string };
export type DocumentsStore = { version: 1; records: Record<string, DocumentRecord>; quarantine?: string[] };
const validId = (id: string) => /^[a-z\d-]{1,100}$/i.test(id);
export const documentId = (doc: Doc) => doc.id || doc.kind;
export const documentsRaw = (storage: Storage = workspaceStorage()) => storage.getItem(KEY + DOCUMENTS_DATA_KEY);

// 只校验容器；单条损坏记录保留原文，由读取入口逐条隔离。
export function readDocumentsEnvelope(raw: string | null): DocumentsStore {
  if (raw === null) return { version: 1, records: {} };
  const store = JSON.parse(raw);
  if (!store || store.version !== 1 || !store.records || typeof store.records !== 'object' || Array.isArray(store.records)) throw Error('单据资料格式不正确，原始内容未覆盖。');
  if (store.quarantine !== undefined && (!Array.isArray(store.quarantine) || !store.quarantine.every((item: unknown) => typeof item === 'string'))) throw Error('单据隔离资料格式不正确。');
  return store;
}
function decodeRecord(id: string, entry: DocumentRecord) {
  if (!validId(id) || !entry || typeof entry.raw !== 'string' || entry.previousRaw !== null && typeof entry.previousRaw !== 'string' || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) throw Error('单据记录格式不正确。');
  const doc = decodeDoc(JSON.parse(entry.raw));
  if (doc.id !== id || !doc.status) throw Error('单据标识或状态缺失。');
  return doc;
}
export function parseDocumentsStore(raw: string | null): DocumentsStore {
  const store = readDocumentsEnvelope(raw);
  for (const [id, entry] of Object.entries(store.records)) {
    const doc = decodeRecord(id, entry);
    if (entry.previousRaw !== null) {
      const previous = decodeDoc(JSON.parse(entry.previousRaw), doc.kind);
      if (previous.id !== id || !previous.status) throw Error('恢复版本标识不正确。');
    }
  }
  return store;
}

export function initializeDocuments(storage: Storage) {
  const raw = documentsRaw(storage);
  if (raw !== null) { readDocumentsEnvelope(raw); return; }
  // User-approved one-time reset of the old one-document-per-type model.
  // Independent directories, settings and unrelated browser data stay intact.
  for (const kind of Object.keys(types)) for (const prefix of ['draft:', 'draft-previous:', 'draft-corrupt:']) storage.removeItem(KEY + prefix + kind);
  storage.setItem(KEY + DOCUMENTS_DATA_KEY, JSON.stringify({ version: 1, records: {} }));
}

export function newDocument(kind: Kind, base: Doc = fresh(kind)): Doc {
  const { issued: _issued, ...contents } = base;
  return { ...contents, kind, id: crypto.randomUUID(), status: 'draft' };
}

export function documentRaw(id: string, storage: Storage = workspaceStorage()) {
  const records = readDocumentsEnvelope(documentsRaw(storage)).records;
  if (!Object.hasOwn(records, id)) return null;
  if (typeof records[id]?.raw !== 'string') throw Error('单据记录格式不正确，原文仍保留。');
  return records[id].raw;
}
export function readDocument(id: string, storage: Storage = workspaceStorage()): Doc | null {
  const records = readDocumentsEnvelope(documentsRaw(storage)).records;
  return Object.hasOwn(records, id) ? decodeRecord(id, records[id]) : null;
}
export function documentRecords(storage: Storage = workspaceStorage()) {
  return Object.entries(readDocumentsEnvelope(documentsRaw(storage)).records)
    .flatMap(([id, entry]) => { try { return [{ ...entry, document: decodeRecord(id, entry) }]; } catch { return []; } })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function recentDraft(kind: Kind, storage: Storage = workspaceStorage()): Doc | null {
  for (const { document: doc } of documentRecords(storage)) {
    if (doc.kind === kind && doc.status === 'draft') return doc;
  }
  return null;
}
export function previousDocument(id: string, storage: Storage = workspaceStorage()): Doc | null {
  const records = readDocumentsEnvelope(documentsRaw(storage)).records;
  if (!validId(id) || !Object.hasOwn(records, id)) return null;
  try {
    const raw = records[id]?.previousRaw;
    if (typeof raw !== 'string') return null;
    const doc = decodeDoc(JSON.parse(raw));
    return doc.id === id && doc.status ? doc : null;
  } catch { return null; }
}

export function damagedDocuments(storage: Storage = workspaceStorage()) {
  return Object.entries(readDocumentsEnvelope(documentsRaw(storage)).records).flatMap(([id, entry]) => {
    try { decodeRecord(id, entry); return []; }
    catch { return [{ id, previous: previousDocument(id, storage), expected: JSON.stringify(entry) }]; }
  });
}

export function recoverPreviousDocument(id: string, expectedRecord: string, storage: Storage = workspaceStorage()) {
  const expected = documentsRaw(storage), store = readDocumentsEnvelope(expected);
  if (!Object.hasOwn(store.records, id) || JSON.stringify(store.records[id]) !== expectedRecord) throw new DraftConflictError();
  const previous = previousDocument(id, storage);
  if (!previous) throw Error('此单据没有可读取的上一版本，请恢复 JSON 备份。');
  // 恢复前归档完整记录，保留损坏原文及原来的恢复版本。
  store.quarantine = [...(store.quarantine ?? []), JSON.stringify({ id, record: store.records[id] })];
  const raw = JSON.stringify(previous);
  store.records[id] = { raw, previousRaw: null, updatedAt: new Date().toISOString() };
  const expectedCatalog = catalogRaw(storage);
  writeDocuments(store, expected, expectedCatalog ?? JSON.stringify(parseCatalogStore(null)), expectedCatalog, storage);
  return previous;
}

function writeDocuments(store: DocumentsStore, expected: string | null, catalog: string, expectedCatalog: string | null, storage: Storage) {
  if (documentsRaw(storage) !== expected || catalogRaw(storage) !== expectedCatalog) throw new DraftConflictError();
  const changedCatalog = catalog !== expectedCatalog;
  if (changedCatalog) storage.setItem(KEY + CATALOG_DATA_KEY, catalog);
  try {
    if (documentsRaw(storage) !== expected) throw new DraftConflictError();
    storage.setItem(KEY + DOCUMENTS_DATA_KEY, JSON.stringify(store));
  } catch (error) {
    if (changedCatalog && catalogRaw(storage) === catalog) {
      if (expectedCatalog === null) storage.removeItem(KEY + CATALOG_DATA_KEY);
      else storage.setItem(KEY + CATALOG_DATA_KEY, expectedCatalog);
    }
    throw error;
  }
}

export function saveDocument(doc: Doc, expectedRaw: string | null, storage: Storage = workspaceStorage(), options: { syncProducts?: boolean } = {}): string {
  if (!doc.id || !validId(doc.id)) throw Error('单据缺少独立标识。');
  const expected = documentsRaw(storage), store = readDocumentsEnvelope(expected), entry = Object.hasOwn(store.records, doc.id) ? store.records[doc.id] : undefined;
  if ((entry?.raw ?? null) !== expectedRaw) throw new DraftConflictError();
  const { issued: _issued, ...contents } = doc;
  const previous = entry ? decodeDoc(JSON.parse(entry.raw)) : null;
  if (previous && previous.kind !== doc.kind) throw Error('不能更改单据类型。');
  const next: Doc = { ...contents, status: doc.status ?? previous?.status ?? 'draft' };
  decodeDoc(next); // Structural safety only; required fields/numeric values are user-controlled on save.
  const raw = JSON.stringify(next);
  if (raw === entry?.raw && !options.syncProducts) return raw;
  const expectedCatalog = catalogRaw(storage), parsed = parseCatalogStore(expectedCatalog);
  parsed.version = 3;
  const catalog = captureCatalogDocuments(captureCatalogDocuments(parsed, previous ? [previous] : [], 'current', 'collect'), [next], 'current', 'latest', options.syncProducts === true);
  if (raw !== entry?.raw) {
    if (entry?.previousRaw && !previousDocument(doc.id, storage)) {
      store.quarantine = [...(store.quarantine ?? []), JSON.stringify({ id: doc.id, record: entry })];
    }
    const latest = Object.values(store.records).reduce((time, record) => Math.max(time, Date.parse(record?.updatedAt) || 0), 0);
    store.records[doc.id] = { raw, previousRaw: entry?.raw ?? null, updatedAt: new Date(Math.max(Date.now(), latest + 1)).toISOString() };
  }
  writeDocuments(store, expected, JSON.stringify(catalog), expectedCatalog, storage);
  return raw;
}

export function deleteDocuments(records: { id: string; expectedRaw: string }[], storage: Storage = workspaceStorage()) {
  if (!records.length) return;
  const expected = documentsRaw(storage), store = readDocumentsEnvelope(expected), seen = new Set<string>();
  for (const { id, expectedRaw } of records) {
    if (seen.has(id)) throw Error('不能重复删除同一单据。');
    seen.add(id);
    if (!store.records[id] || store.records[id].raw !== expectedRaw) throw new DraftConflictError();
  }
  // Copies already live independently; deleting a document never removes them.
  const expectedCatalog = catalogRaw(storage);
  for (const { id } of records) delete store.records[id];
  if (documentsRaw(storage) !== expected || catalogRaw(storage) !== expectedCatalog) throw new DraftConflictError();
  storage.setItem(KEY + DOCUMENTS_DATA_KEY, JSON.stringify(store));
}
