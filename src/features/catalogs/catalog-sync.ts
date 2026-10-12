import { previousDraft } from '@/features/documents/drafts';
import { types, type Doc, type Kind } from '@/features/documents/model';
import { listSavedDocuments } from '@/features/documents/saved-documents';
import { catalogRaw, captureCatalogDocuments, parseCatalogStore, writeCatalogStore } from '@/features/catalogs/catalog-storage';
import { workspaceStorage } from '@/features/workspace/workspace-storage';
import { documentsRaw, readDocumentsEnvelope, previousDocument } from '@/features/documents/documents-store';

// Migrate legacy forms and recovery versions without changing their original data.
// Deleted identities stay excluded, so refreshing/re-saving unchanged forms cannot resurrect them.
export function readSavedCatalogs(storage: Storage = workspaceStorage()) {
  const saved = listSavedDocuments(storage), previous: Doc[] = [];
  for (const id of Object.keys(readDocumentsEnvelope(documentsRaw(storage)).records)) {
    const doc = previousDocument(id, storage);
    if (doc) previous.push(doc);
  }
  for (const kind of Object.keys(types) as Kind[]) {
    try { const doc = previousDraft(kind, storage); if (doc) previous.push(doc); } catch { /* Damaged originals remain in storage. */ }
  }
  const raw = catalogRaw(storage);
  const parsed = parseCatalogStore(raw, saved.documents);
  // Missing stores belong to legacy workspaces. Import once; new autosaves
  // always write a V3 boundary, even when the confirmed product list is empty.
  if (raw === null) parsed.version = 2;
  const store = captureCatalogDocuments(captureCatalogDocuments(parsed, saved.documents, 'current', 'collect'), previous, 'previous');
  store.version = 3;
  writeCatalogStore(store, raw, storage);
  return { store, raw: catalogRaw(storage), documents: saved.documents, unreadable: saved.unreadable };
}
