import { decodeDoc, draftRaw, DraftConflictError } from '@/features/documents/drafts';
import { types, type Doc, type Kind } from '@/features/documents/model';
import { workspaceStorage } from '@/features/workspace/workspace-storage';
import { documentsRaw, documentRecords, documentRaw } from '@/features/documents/documents-store';

export type SavedDocuments = {
  documents: Doc[];
  unreadable: { kind: Kind; message: string }[];
  // Exact snapshots let destructive actions reject records changed since listing.
  rawByKind: Partial<Record<Kind, string>>;
  rawById?: Record<string, string>;
};
export type SavedDocumentFilter = 'all' | Kind;
export type SavedDocumentTab = { value: SavedDocumentFilter; label: string; count: number };

export function savedDocumentTabs(documents: Doc[]): SavedDocumentTab[] {
  const tabs: SavedDocumentTab[] = [{ value: 'all', label: '全部', count: documents.length }];
  for (const kind of Object.keys(types) as Kind[]) {
    const count = documents.filter(doc => doc.kind === kind).length;
    if (count > 0) tabs.push({ value: kind, label: types[kind][0], count });
  }
  return tabs;
}

export function filterSavedDocuments(documents: Doc[], filter: SavedDocumentFilter) {
  return filter === 'all' ? documents : documents.filter(doc => doc.kind === filter);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function savedDocumentRaw(doc: Doc, rawByKind: SavedDocuments['rawByKind'] | undefined, storage: Storage = workspaceStorage()): string {
  if (doc.id) {
    const raw = documentRaw(doc.id, storage);
    if (raw === null) throw Error('此单据已被删除，请刷新列表后重试。');
    if (JSON.stringify(canonical(doc)) !== JSON.stringify(canonical(decodeDoc(JSON.parse(raw))))) throw new DraftConflictError();
    return raw;
  }
  const snapshot = rawByKind?.[doc.kind];
  if (typeof snapshot === 'string') return snapshot;
  // Hot-updated pages can retain list state created before snapshots were added.
  // Re-read only if the stored contents still match the record the user sees.
  const raw = draftRaw(doc.kind, storage);
  if (raw === null) throw Error('此单据已被删除，请刷新列表后重试。');
  const source = JSON.parse(raw);
  const current = decodeDoc(source, doc.kind);
  const ids = new Set<string>();
  const stableIds = source.rows.map((row: { id?: string }) => {
    if (!row.id || ids.has(row.id)) return false;
    ids.add(row.id); return true;
  });
  const comparable = (document: Doc) => {
    const fields = { ...document.fields };
    // These values/IDs are generated when migrating an old saved record.
    for (const key of ['number', 'date']) if (!Object.hasOwn(source.fields, key)) delete fields[key];
    return canonical({ ...document, fields, rows: document.rows.map((row, index) => {
      if (stableIds[index]) return row;
      const { id: _id, ...contents } = row; return contents;
    }) });
  };
  if (JSON.stringify(comparable(doc)) !== JSON.stringify(comparable(current))) throw new DraftConflictError();
  return raw;
}

// Read existing drafts only. Listing documents must never create or overwrite one.
export function listSavedDocuments(storage: Storage = workspaceStorage()): SavedDocuments {
  const raw = documentsRaw(storage);
  if (raw !== null) {
    const records = documentRecords(storage);
    const documents = records.map(entry => entry.document);
    return { documents, unreadable: [], rawByKind: {}, rawById: Object.fromEntries(documents.map((doc, index) => [doc.id!, records[index].raw])) };
  }
  const documents: Doc[] = [], unreadable: SavedDocuments['unreadable'] = [];
  const rawByKind: Partial<Record<Kind, string>> = {};
  for (const kind of Object.keys(types) as Kind[]) {
    const raw = draftRaw(kind, storage);
    if (raw === null) continue;
    rawByKind[kind] = raw;
    try { documents.push(decodeDoc(JSON.parse(raw), kind)); }
    catch (error) {
      unreadable.push({ kind, message: error instanceof Error ? error.message : '无法读取此单据' });
    }
  }
  return { documents, unreadable, rawByKind };
}
