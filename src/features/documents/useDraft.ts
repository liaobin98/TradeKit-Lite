import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { KEY } from '@/features/workspace/workspace-storage';
import { type Doc } from '@/features/documents/model';
import { DraftConflictError } from '@/features/documents/drafts';
import { DOCUMENTS_DATA_KEY, documentRaw, saveDocument, previousDocument } from '@/features/documents/documents-store';
import { updateWorkspace } from '@/features/workspace/workspace-storage';
import { catalogRaw, captureCatalogDocuments, parseCatalogStore, writeCatalogStore } from '@/features/catalogs/catalog-storage';
import { hasDocumentContent } from '@/features/documents/blank-document';
export function useDraft(doc: Doc, active: boolean) {
  const current = useRef(doc), enabled = useRef(active);
  const expected = useRef<string | null>(null), saved = useRef(JSON.stringify(doc)), blocked = useRef(false);
  const unsaved = useRef(false);
  const blank = useRef(doc);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const [state, setState] = useState<'empty' | 'saved' | 'pending' | 'error' | 'conflict'>('empty');
  const [hasPrevious, setHasPrevious] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => { current.current = doc; enabled.current = active; }, [doc, active]);
  function reset(next: Doc, raw: string | null, options: { unsaved?: boolean } = {}) {
    generation.current++;
    current.current = next; expected.current = raw; saved.current = JSON.stringify(next); blocked.current = false;
    blank.current = next;
    unsaved.current = options.unsaved === true;
    setState(raw === null || unsaved.current ? 'empty' : 'saved'); setError('');
    setHasPrevious(!!next.id && !!previousDocument(next.id));
  }
  function isUnsavedBlank(next = current.current) {
    // Clearing an existing document is a real edit and must still persist.
    return expected.current === null && !hasDocumentContent(next, blank.current);
  }
  async function store(next: Doc, force: boolean, retry: boolean, revision: number, syncProducts = false) {
    if (revision !== generation.current) return false;
    if (!force && !syncProducts && isUnsavedBlank(next)) { setState('empty'); return true; }
    if (retry) blocked.current = false;
    if (blocked.current) return false;
    const snapshot = JSON.stringify(next);
    try {
      const shouldWrite = saved.current !== snapshot || expected.current === null || (force && unsaved.current);
      const raw = await updateWorkspace(storage => {
        if (revision !== generation.current) throw Error('编辑入口已改变，本次保存已取消。');
        if (!next.id || documentRaw(next.id, storage) !== expected.current) throw new DraftConflictError();
        return shouldWrite || syncProducts ? saveDocument(next, expected.current, storage, { syncProducts }) : expected.current;
      });
      if (revision !== generation.current) return false;
      expected.current = raw;
      if (shouldWrite) unsaved.current = false;
      saved.current = snapshot;
      setState(snapshot !== JSON.stringify(current.current) ? 'pending' : expected.current === null || unsaved.current ? 'empty' : 'saved'); setError('');
      setHasPrevious(!!next.id && !!previousDocument(next.id)); return true;
    } catch (e) {
      if (revision !== generation.current) return false;
      blocked.current = true; setState(e instanceof DraftConflictError ? 'conflict' : 'error');
      setError(e instanceof Error ? e.message : '浏览器存储不可用'); return false;
    }
  }
  function enqueue(operation: () => Promise<boolean>) {
    const task = saving.current.then(operation);
    saving.current = task.catch(() => {});
    return task;
  }
  function flush(force = false, retry = false, syncProducts = false) {
    const revision = generation.current;
    return enqueue(() => store(current.current, force, retry, revision, syncProducts));
  }
  function retry() { return flush(true, true, true); }
  function syncProducts(document: Doc) {
    const revision = generation.current;
    return enqueue(async () => {
      if (revision !== generation.current || !enabled.current || document.kind !== current.current.kind) throw Error('编辑入口已改变，产品资料未同步。');
      await updateWorkspace(storage => {
        if (revision !== generation.current || !document.id || document.id !== current.current.id || documentRaw(document.id, storage) !== expected.current) throw new DraftConflictError();
        const raw = catalogRaw(storage), parsed = parseCatalogStore(raw);
        parsed.version = 3;
        writeCatalogStore(captureCatalogDocuments(parsed, [document], 'current', 'latest', true, ['products']), raw, storage);
      });
      return true;
    });
  }
  function commit(next: Doc, retry = false, syncProducts = false) {
    const revision = generation.current;
    return enqueue(async () => {
      if (!enabled.current || next.id !== current.current.id || next.kind !== current.current.kind || revision !== generation.current) return false;
      const previous = current.current;
      const success = await store(next, true, retry, revision, syncProducts);
      if (success && current.current === previous) current.current = next;
      return success;
    });
  }
  useEffect(() => {
    if (!active || blocked.current) return;
    if (isUnsavedBlank(doc)) { setState('empty'); return; }
    if (saved.current === JSON.stringify(doc) && expected.current !== null && !unsaved.current) { setState('saved'); return; }
    setState('pending'); const timer = setTimeout(() => { void flush(); }, 700); return () => clearTimeout(timer);
  }, [doc, active]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      // IndexedDB is asynchronous: never assume a close-time write has already
      // completed. Warn while changes remain uncommitted, then attempt a flush.
      if (enabled.current && !isUnsavedBlank() && (expected.current === null || unsaved.current || JSON.stringify(current.current) !== saved.current)) {
        void flush(); event.preventDefault(); event.returnValue = '';
      }
    };
    const hide = () => { if (enabled.current && !isUnsavedBlank() && document.visibilityState === 'hidden') void flush(); };
    const pagehide = () => { if (enabled.current && !isUnsavedBlank()) void flush(); };
    const changed = (event: Event) => {
      if (!enabled.current || (event instanceof StorageEvent && event.key !== null && event.key !== KEY + DOCUMENTS_DATA_KEY)) return;
      try {
        if (!current.current.id || documentRaw(current.current.id) !== expected.current) {
          blocked.current = true; setState('conflict'); setError(new DraftConflictError().message);
        }
      } catch {
        blocked.current = true; setState('error'); setError('浏览器存储不可用，请下载 JSON 备份。');
      }
    };
    const unavailable = () => {
      if (enabled.current) { blocked.current = true; setState('error'); setError('无法重新读取本地资料，当前编辑仍保留。请检查浏览器存储后重试。'); }
    };
    window.addEventListener('beforeunload', leave); window.addEventListener('pagehide', pagehide); window.addEventListener('storage', changed); document.addEventListener('visibilitychange', hide);
    window.addEventListener('workspace-storage', changed); window.addEventListener('workspace-storage-error', unavailable);
    return () => { window.removeEventListener('beforeunload', leave); window.removeEventListener('pagehide', pagehide); window.removeEventListener('storage', changed); document.removeEventListener('visibilitychange', hide); window.removeEventListener('workspace-storage', changed); window.removeEventListener('workspace-storage-error', unavailable); };
  }, []);
  return { state, error, hasPrevious, reset, flush, retry, commit, syncProducts, document: () => current.current, expectedRaw: () => expected.current };
}
