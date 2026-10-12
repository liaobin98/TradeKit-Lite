import { useEffect, useRef, useState } from 'react';
import { Files, FilePlus2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirmation } from '@/components/controls';
import { DocumentStatus } from '@/features/documents/DocumentStatus';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { KEY } from '@/features/workspace/workspace-storage';
import { types, type Doc, type Kind } from '@/features/documents/model';
import { deleteDraft, deleteDrafts } from '@/features/documents/drafts';
import { listSavedDocuments, savedDocumentRaw, savedDocumentTabs, filterSavedDocuments, type SavedDocuments, type SavedDocumentFilter } from '@/features/documents/saved-documents';
import '@/components/library.css';
import { updateWorkspace, refreshWorkspaceStorage } from '@/features/workspace/workspace-storage';
import { DOCUMENTS_DATA_KEY, documentId, deleteDocuments } from '@/features/documents/documents-store';

function readDocuments(): SavedDocuments & { error: string } {
  try { return { ...listSavedDocuments(), error: '' }; }
  catch { return { documents: [], unreadable: [], rawByKind: {}, error: '无法读取浏览器存储，请检查浏览器设置后重新打开此栏目。已有内容不会被覆盖。' }; }
}

export function DocumentLibrary({ onOpen, onCreate }: {
  onOpen: (kind: Kind, id?: string) => void;
  onCreate: () => void;
}) {
  const [saved, setSaved] = useState(readDocuments);
  const [filter, setFilter] = useState<SavedDocumentFilter>('all');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const snapshot = (doc: Doc) => (doc.id ? saved.rawById?.[doc.id] : saved.rawByKind[doc.kind]) ?? savedDocumentRaw(doc, saved.rawByKind);
  const section = useRef<HTMLElement>(null);
  const deletionPending = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState<{ text: string; failed: boolean } | null>(null);
  const { confirm, confirmation } = useConfirmation(() => {
    const target = section.current?.querySelector<HTMLButtonElement>('.document-open')
      || section.current?.querySelector<HTMLButtonElement>('.documents-empty button')
      || section.current?.querySelector<HTMLButtonElement>('[role="tab"][data-state="active"]');
    target?.focus();
  });
  async function refresh() {
    try {
      await refreshWorkspaceStorage();
      const next = readDocuments();
      setSaved(next);
      setSelected(current => Object.fromEntries(Object.entries(current).filter(([id, raw]) =>
        next.documents.some(doc => documentId(doc) === id) && (next.rawById?.[id] ?? next.rawByKind[id as Kind]) === raw)));
      setFilter(current => current === 'all' || next.documents.some(doc => doc.kind === current) ? current : 'all');
    } catch { setSaved(current => ({ ...current, error: '无法重新读取本地资料，原内容仍保留，请重试。' })); }
  }
  async function removeSelectedDocuments() {
    const records = filteredDocuments.filter(doc => selected[documentId(doc)] !== undefined)
      .map(doc => ({ kind: doc.kind, id: doc.id, expectedRaw: selected[documentId(doc)]! }));
    if (deletionPending.current || records.length === 0) return;
    deletionPending.current = true;
    setDeleting(true);
    setDeleteFeedback(null);
    try {
      const labels = filteredDocuments.filter(doc => selected[documentId(doc)] !== undefined)
        .map(doc => `${types[doc.kind][0]}${doc.fields.number ? `（${doc.fields.number}）` : ''}`).join('、');
      if (!await confirm(`确认删除选中的 ${records.length} 份单据？${labels}。将删除这些单据及其本地恢复版本，无法撤销。未选中的单据、卖方/买方/产品资料和已下载的文件不受影响。建议先通过顶部“备份 / 恢复”备份资料。`, { title: '批量删除单据？', confirmLabel: `删除 ${records.length} 份单据` })) return;
      await updateWorkspace(storage => {
        if (records.every(record => record.id)) deleteDocuments(records.map(record => ({ id: record.id!, expectedRaw: record.expectedRaw })), storage);
        else deleteDrafts(records, storage);
      });
      setSelected({});
      setDeleteFeedback({ text: `已删除 ${records.length} 份单据。`, failed: false });
      await refresh();
    } catch (error) {
      setDeleteFeedback({ text: `批量删除失败：${error instanceof Error ? error.message : '浏览器存储不可用'}`, failed: true });
      await refresh();
    } finally {
      deletionPending.current = false;
      setDeleting(false);
    }
  }
  function selectDocuments(documents: Doc[], checked: boolean) {
    if (deletionPending.current) return;
    try {
      const snapshots = checked ? Object.fromEntries(documents.map(doc => [documentId(doc), snapshot(doc)])) : {};
      setSelected(current => {
        const next = { ...current };
        for (const doc of documents) delete next[documentId(doc)];
        return { ...next, ...snapshots };
      });
    } catch (error) {
      setDeleteFeedback({ text: `选择失败：${error instanceof Error ? error.message : '无法读取单据，请刷新重试'}`, failed: true });
    }
  }
  async function removeDocument(doc: Doc) {
    if (deletionPending.current) return;
    deletionPending.current = true;
    setDeleting(true);
    setDeleteFeedback(null);
    try {
      const expectedRaw = snapshot(doc);
      const label = `${types[doc.kind][0]}${doc.fields.number ? `（${doc.fields.number}）` : ''}`;
      if (!await confirm(`确认删除${label}？将删除当前浏览器中的这条单据及其本地恢复版本，无法撤销。已下载的 Excel、PDF 和 JSON 备份文件不受影响，其他类型单据不会被删除。`, { title: '删除单据？', confirmLabel: '删除单据' })) return;
      await updateWorkspace(storage => {
        if (doc.id) deleteDocuments([{ id: doc.id, expectedRaw }], storage);
        else deleteDraft(doc.kind, expectedRaw, storage);
      });
      setDeleteFeedback({ text: `已删除${label}。`, failed: false });
      await refresh();
    } catch (error) {
      setDeleteFeedback({ text: `删除失败：${error instanceof Error ? error.message : '浏览器存储不可用'}`, failed: true });
      await refresh();
    } finally {
      deletionPending.current = false;
      setDeleting(false);
    }
  }
  useEffect(() => {
    void refresh();
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === KEY + DOCUMENTS_DATA_KEY || event.key.startsWith(KEY + 'draft:')) refresh();
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('storage', changed);
    window.addEventListener('workspace-storage', refresh);
    window.addEventListener('workspace-committed', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('workspace-storage', refresh); window.removeEventListener('workspace-committed', refresh); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const { documents, unreadable, error } = saved;
  const tabs = savedDocumentTabs(documents);
  const filteredDocuments = filterSavedDocuments(documents, filter);
  const selectedCount = filteredDocuments.filter(doc => selected[documentId(doc)] !== undefined).length;
  const allSelected = filteredDocuments.length > 0 && selectedCount === filteredDocuments.length;
  return (
    <section ref={section} className="document-library" aria-labelledby="documents-title">
      {confirmation}
      <div className="documents-heading">
        <div className="brand">
          <span className="logo page-heading-icon" aria-hidden="true"><Files /></span>
          <div>
            <span className="brand-eyebrow">SAVED DOCUMENTS</span>
            <h1 id="documents-title" className="text-balance">我的单据</h1>
            <p className="text-pretty">集中查看已保存的各类单据，打开后可继续编辑、导出或打印。</p>
          </div>
        </div>
        {documents.length > 0 && <Button disabled={deleting} onClick={onCreate}><FilePlus2 size={16} aria-hidden="true" />制作单据</Button>}
      </div>
      {deleteFeedback && <p className="documents-delete-feedback" role={deleteFeedback.failed ? 'alert' : 'status'}>{deleteFeedback.text}</p>}
      {error ? <p className="documents-error" role="alert">{error}</p> : documents.length > 0 ? (
        <Tabs className="documents-tabs" value={filter} onValueChange={value => { if (deletionPending.current) return; setFilter(value as SavedDocumentFilter); setSelected({}); }}>
          <TabsList className="documents-tabs-list" aria-label="单据类型">
            {tabs.map(tab => <TabsTrigger key={tab.value} value={tab.value} disabled={deleting} className="tabular-nums">{tab.label}{tab.count > 0 ? ` (${tab.count})` : ''}</TabsTrigger>)}
          </TabsList>
          <TabsContent value={filter}>
            <div className="documents-list">
              <p className="documents-count" role="status">共 <strong className="tabular-nums">{filteredDocuments.length}</strong> 份已保存{filter === 'all' ? '单据' : types[filter][0]}</p>
              <div className="documents-bulk-actions">
                <span className="tabular-nums" role="status">已选择 {selectedCount} 份</span>
                <Button disabled={deleting || selectedCount === 0} onClick={() => setSelected({})}>取消选择</Button>
                <Button className="documents-bulk-delete" disabled={deleting || selectedCount === 0} onClick={() => { void removeSelectedDocuments(); }}><Trash2 size={16} aria-hidden="true" />删除所选{selectedCount > 0 ? ` (${selectedCount})` : ''}</Button>
              </div>
              <div className="documents-table-scroll" role="region" aria-label={filter === 'all' ? '已保存单据列表' : `已保存${types[filter][0]}列表`} tabIndex={0}>
                <table>
                  <caption className="sr-only">当前浏览器已保存的{filter === 'all' ? '各类单据' : types[filter][0]}</caption>
                  <thead><tr><th scope="col" className="documents-select-cell"><Checkbox checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false} disabled={deleting} aria-label="全选当前分类单据" onCheckedChange={checked => selectDocuments(filteredDocuments, checked === true)} /></th><th scope="col">单据类型</th><th scope="col">单据编号</th><th scope="col">客户</th><th scope="col">单据日期</th><th scope="col">商品数</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                  <tbody>{filteredDocuments.map(doc => (
                    <tr key={documentId(doc)} className="documents-row" data-selected={selected[documentId(doc)] !== undefined ? 'true' : undefined} onClick={event => {
                      if (deleting || (event.target as HTMLElement).closest('button, a, input, label, .documents-select-cell')) return;
                      onOpen(doc.kind, doc.id);
                    }}>
                      <td className="documents-select-cell" onClick={event => event.stopPropagation()}><Checkbox checked={selected[documentId(doc)] !== undefined} disabled={deleting} aria-label={`选择${types[doc.kind][0]} ${doc.fields.number || ''}`} onCheckedChange={checked => selectDocuments([doc], checked === true)} /></td>
                      <th scope="row"><Button disabled={deleting} variant="ghost" className="document-open" onClick={() => onOpen(doc.kind, doc.id)} aria-label={`打开${types[doc.kind][0]} ${doc.fields.number || ''}`}><span className="document-kind">{doc.kind}</span>{types[doc.kind][0]}</Button></th>
                      <td className="tabular-nums">{doc.fields.number || '未填写编号'}</td>
                      <td>{doc.fields.buyer || '未填写客户'}</td>
                      <td className="tabular-nums">{doc.fields.date || '—'}</td>
                      <td className="tabular-nums">{doc.rows.filter(row => row.name.trim() || row.nameEn?.trim()).length}</td>
                      <td><DocumentStatus doc={doc} /></td>
                      <td className="documents-actions" onClick={event => event.stopPropagation()}><Button variant="ghost" size="icon" className="documents-delete" disabled={deleting} onClick={() => { void removeDocument(doc); }} aria-label={`删除${types[doc.kind][0]} ${doc.fields.number || ''}`} title="删除单据"><Trash2 size={16} aria-hidden="true" /></Button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      ) : unreadable.length === 0 && (
        <div className="documents-empty">
          <Files size={32} aria-hidden="true" />
          <h2 className="text-balance">还没有保存的单据</h2>
          <p className="text-pretty">填写单据并保存草稿或导出后，就可以在这里找到。</p>
          <Button onClick={onCreate}><FilePlus2 size={16} aria-hidden="true" />开始制作单据</Button>
        </div>
      )}
      {unreadable.length > 0 && <div className="documents-unreadable" role="alert">
        <h2 className="text-balance">部分单据暂时无法读取</h2>
        <p className="text-pretty">原始内容仍保留在当前浏览器中，其他单据不受影响。</p>
        <ul>{unreadable.map(({ kind, message }) => <li key={kind}><span>{types[kind][0]}：{message}</span><Button onClick={() => onOpen(kind)} aria-label={`尝试打开${types[kind][0]}`}>尝试打开</Button></li>)}</ul>
      </div>}
      <p className="documents-note text-pretty">资料仅保存在当前浏览器，请定期备份。删除单据无法撤销，不影响已下载文件及独立资料副本。</p>
    </section>
  );
}
