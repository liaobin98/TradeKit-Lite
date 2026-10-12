import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Building2, Users, Package, ArrowRight, FilePlus2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirmation } from '@/components/controls';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { KEY } from '@/features/workspace/workspace-storage';
import { types, type Kind } from '@/features/documents/model';
import type { CatalogRoute } from '@/app/navigation';
import { readSavedCatalogs } from '@/features/catalogs/catalog-sync';
import { CATALOG_DATA_KEY, deleteCatalogRecords, emptyCatalogStore } from '@/features/catalogs/catalog-storage';
import { updateWorkspace, refreshWorkspaceStorage } from '@/features/workspace/workspace-storage';
import { catalogLabels, catalogSourceCount, catalogSourceAvailable, catalogSourceDocumentId, catalogValue, searchFormCatalog, type CatalogRecord } from '@/features/catalogs/form-catalog';
import '@/components/library.css';
import '@/features/catalogs/form-catalog.css';

const icons = { sellers: Building2, buyers: Users, products: Package };
const eyebrows = { sellers: 'SELLER DIRECTORY', buyers: 'BUYER DIRECTORY', products: 'PRODUCT DIRECTORY' };
function readCatalogDocuments() {
  try { return { ...readSavedCatalogs(), error: '' }; }
  catch (error) { return { store: emptyCatalogStore(), raw: null, documents: [], unreadable: [], error: `无法读取或保存独立资料副本：${error instanceof Error ? error.message : '请检查浏览器设置'}。原始内容不会被覆盖。` }; }
}

export function CatalogLibrary({ category, onOpen, onCreate }: {
  category: CatalogRoute;
  onOpen: (kind: Kind, id?: string) => void;
  onCreate: () => void;
}) {
  const [saved, setSaved] = useState(readCatalogDocuments);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const deletionPending = useRef(false), section = useRef<HTMLElement>(null);
  const [feedback, setFeedback] = useState<{ text: string; failed: boolean } | null>(null);
  const searchId = useId();
  const detailTrigger = useRef<HTMLButtonElement | null>(null), searchInput = useRef<HTMLInputElement | null>(null);
  const { confirm, confirmation } = useConfirmation(() => {
    (searchInput.current || section.current?.querySelector<HTMLButtonElement>('.documents-empty button'))?.focus();
  });
  const refresh = async () => {
    try { await refreshWorkspaceStorage(); setSaved(readCatalogDocuments()); }
    catch { setSaved(current => ({ ...current, error: '无法重新读取本地资料，原内容仍保留，请重试。' })); }
  };
  async function removeRecords(records: CatalogRecord[]) {
    if (!records.length || deletionPending.current) return;
    deletionPending.current = true; setDeleting(true); setFeedback(null);
    try {
      const expectedRaw = saved.raw;
      if (expectedRaw === null) throw Error('资料尚未保存，请刷新列表后重试。');
      const label = catalogLabels[category];
      const description = records.length === 1 ? `“${records[0].title}”` : `${records.length} 条所选${label}资料`;
      if (!await confirm(`确认删除${description}的独立副本？此操作无法撤销，不会删除或修改来源单据，也不会影响其他栏目。${category === 'products' ? '删除的相同产品资料' : '删除的同名公司资料'}不会因刷新或再次保存来源单据自动出现。`, { title: records.length > 1 ? '批量删除资料？' : '删除资料？', confirmLabel: '删除资料' })) return;
      await updateWorkspace(storage => deleteCatalogRecords(category, records.map(record => record.id), expectedRaw, storage));
      setCheckedIds([]); setSelectedId(null); await refresh();
      setFeedback({ text: `已删除 ${records.length} 条${label}资料副本。`, failed: false });
    } catch (error) {
      setFeedback({ text: `删除失败：${error instanceof Error ? error.message : '浏览器存储不可用'}`, failed: true }); await refresh();
    } finally { deletionPending.current = false; setDeleting(false); }
  }
  useEffect(() => {
    let active = true;
    const collect = () => {
      void updateWorkspace(storage => readSavedCatalogs(storage)).then(() => { if (active) refresh(); }).catch(error => {
        if (active) setFeedback({ text: `独立资料副本保存失败：${error instanceof Error ? error.message : '浏览器存储不可用'}`, failed: true });
      });
    };
    collect();
    const changed = (event: StorageEvent) => { if (event.key === null || event.key === KEY + CATALOG_DATA_KEY || event.key.startsWith(KEY + 'draft:')) refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('storage', changed); window.addEventListener('workspace-storage', collect); document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.removeEventListener('storage', changed); window.removeEventListener('workspace-storage', collect); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const records = saved.store.records[category];
  const filtered = useMemo(() => searchFormCatalog(records, query), [records, query]);
  const selected = records.find(record => record.id === selectedId);
  const label = catalogLabels[category];
  const Icon = icons[category];
  const product = category === 'products';
  const prefix = category === 'sellers' ? 'seller' : 'buyer';
  const checked = new Set(checkedIds), selectedRecords = records.filter(record => checked.has(record.id));
  const checkedCount = filtered.filter(record => checked.has(record.id)).length;
  function toggle(id: string, value: boolean) {
    setCheckedIds(current => value ? [...new Set([...current, id])] : current.filter(key => key !== id));
  }
  function toggleAll(value: boolean) {
    const ids = new Set(filtered.map(record => record.id));
    setCheckedIds(current => value ? [...new Set([...current, ...ids])] : current.filter(id => !ids.has(id)));
  }
  function viewRecord(record: CatalogRecord, trigger: HTMLButtonElement | null) {
    detailTrigger.current = trigger;
    setSelectedId(record.id);
  }

  return (
    <section ref={section} className="document-library catalog-library" aria-labelledby="catalog-title">
      {confirmation}
      <div className="documents-heading">
        <div className="brand">
          <span className="logo page-heading-icon" aria-hidden="true"><Icon /></span>
          <div>
            <span className="brand-eyebrow">{eyebrows[category]}</span>
            <h1 id="catalog-title" className="text-balance">{label}资料</h1>
            <p className="text-pretty">{product ? '保存草稿或成功导出、调用打印后保留产品副本，来源单据修改或删除后仍可查看和选用。' : '制单保存后独立保留资料副本，来源单据修改或删除后仍可查看和选用。'}</p>
          </div>
        </div>
        {records.length > 0 && <Button onClick={onCreate}><FilePlus2 size={16} aria-hidden="true" />填写单据</Button>}
      </div>
      {feedback && <p className="documents-delete-feedback" role={feedback.failed ? 'alert' : 'status'}>{feedback.text}</p>}
      {saved.error ? <p className="documents-error" role="alert">{saved.error}</p> : records.length === 0 ? (
        <div className="documents-empty">
          <Icon size={32} aria-hidden="true" />
          <h2 className="text-balance">还没有{label}资料</h2>
          <p className="text-pretty">{product ? '在单据中填写产品名称（中文或英文）和产品编码 / SKU，点击“保存草稿”或成功导出、调用打印后会显示在这里；自动保存不收录中间版本。' : `在单据中填写${label}信息并保存后，会自动显示在这里。`}</p>
          <Button onClick={onCreate}><FilePlus2 size={16} aria-hidden="true" />去填写单据</Button>
        </div>
      ) : (
        <>
          <div className="catalog-search">
            <label htmlFor={searchId}>搜索{label}资料</label>
            <Input ref={searchInput} id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={product ? '名称、编码、规格或来源单据编号' : '公司、联系人、电话或来源单据编号'} />
          </div>
          <div className="documents-list">
            <p className="documents-count" role="status">共 <strong className="tabular-nums">{records.length}</strong> 条{label}资料{query.trim() && <>，找到 <strong className="tabular-nums">{filtered.length}</strong> 条</>}</p>
            <div className="catalog-bulk-actions">
              <span role="status">已选择 {selectedRecords.length} 条{query.trim() ? ' · 全选仅选择当前搜索结果' : ''}</span>
              <Button disabled={!selectedRecords.length || deleting} onClick={() => setCheckedIds([])}>取消选择</Button>
              <Button className="catalog-bulk-delete" disabled={!selectedRecords.length || deleting} onClick={() => { void removeRecords(selectedRecords); }}><Trash2 size={16} aria-hidden="true" />删除所选{selectedRecords.length > 0 ? ` (${selectedRecords.length})` : ''}</Button>
            </div>
            {filtered.length === 0 ? <div className="catalog-no-results"><p>没有匹配的资料</p><Button onClick={() => setQuery('')}>清除搜索</Button></div> : (
              <div className="documents-table-scroll" role="region" aria-label={`${label}资料列表`} tabIndex={0}>
                <table>
                  <caption className="sr-only">独立保存的{label}资料副本</caption>
                  <thead><tr><th scope="col" className="catalog-select-cell"><Checkbox checked={filtered.length > 0 && checkedCount === filtered.length ? true : checkedCount > 0 ? 'indeterminate' : false} disabled={deleting} onCheckedChange={value => toggleAll(value === true)} aria-label="全选当前筛选结果" /></th><th scope="col">{product ? '产品名称' : '公司名称'}</th><th scope="col">{product ? '产品编码 / SKU' : '联系人'}</th><th scope="col">{product ? '规格' : '电话'}</th><th scope="col">{product ? '单位' : '邮箱'}</th><th scope="col">来源单据</th><th scope="col">操作</th></tr></thead>
                  <tbody>{filtered.map(record => <tr key={record.id} className="documents-row" onClick={event => {
                    if ((event.target as HTMLElement).closest('button, a, input, [role="checkbox"]')) return;
                    viewRecord(record, event.currentTarget.querySelector<HTMLButtonElement>('.catalog-open'));
                  }}>
                    <td className="catalog-select-cell" onClick={event => event.stopPropagation()}><Checkbox checked={checked.has(record.id)} disabled={deleting} onCheckedChange={value => toggle(record.id, value === true)} aria-label={`选择${record.title}`} /></td>
                    <th scope="row"><Button variant="ghost" className="document-open catalog-open" onClick={event => viewRecord(record, event.currentTarget)} aria-label={`查看${record.title}的${label}资料`} aria-haspopup="dialog"><span className="catalog-record-name">{record.images[0] && <img src={record.images[0]} alt="" loading="lazy" decoding="async" />}<span>{record.title}{product && catalogValue(record, 'nameEn') && catalogValue(record, 'nameEn') !== record.title && <small>{catalogValue(record, 'nameEn')}</small>}</span></span></Button></th>
                    <td>{catalogValue(record, product ? 'code' : prefix + 'Contact') || '—'}</td>
                    <td>{catalogValue(record, product ? 'spec' : prefix + 'Phone') || '—'}</td>
                    <td>{catalogValue(record, product ? 'unit' : prefix + 'Email') || '—'}</td>
                    <td className="tabular-nums">{catalogSourceCount(record)} 份</td>
                    <td className="documents-actions" onClick={event => event.stopPropagation()}><Button className="documents-delete catalog-delete" variant="ghost" size="icon" disabled={deleting} onClick={() => { void removeRecords([record]); }} aria-label={`删除${record.title}的${label}资料`} title="删除资料"><Trash2 size={16} aria-hidden="true" /></Button></td>
                  </tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      {saved.unreadable.length > 0 && <div className="documents-unreadable" role="alert">
        <h2 className="text-balance">部分来源单据无法读取</h2>
        <p className="text-pretty">无法从这些单据提取新资料，已保存的独立副本和原始内容仍保留。</p>
        <ul>{saved.unreadable.map(({ kind, message }) => <li key={kind}><span>{types[kind][0]}：{message}</span><Button onClick={() => onOpen(kind)}>尝试打开</Button></li>)}</ul>
      </div>}
      <p className="documents-note text-pretty">资料副本独立保存在当前浏览器。{product ? '名称（中文或英文）和产品编码 / SKU 均已填写后，点击“保存草稿”或成功导出、调用打印才收录产品。相同 SKU 更新最新资料，不同 SKU 分别保留；自动保存不收录中间版本，目录更新不修改已有单据。既有重复项暂不自动清理。' : '按公司名称去重，同名公司只保留最近保存的一份完整信息，不叠加旧联系人、电话或地址。'}支持单条或批量删除，删除副本不影响来源单据；已删除的{product ? '相同 SKU' : '同名公司资料'}不会自动重新收集。全部资料备份包含这些副本。</p>
      <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        {selected && <DialogContent className="catalog-dialog" onCloseAutoFocus={event => { event.preventDefault(); (detailTrigger.current?.isConnected ? detailTrigger.current : searchInput.current)?.focus(); }}>
          <DialogTitle className="text-balance">{selected.title}</DialogTitle>
          <DialogDescription className="text-pretty">这是独立保存的{label}资料副本，内容保留为保存时的版本，不随来源单据修改或删除而改变。</DialogDescription>
          {selected.images.length > 0 && <div className="catalog-images">{selected.images.map((image, index) => <img key={image} src={image} alt={`${selected.title} 图片 ${index + 1}`} loading="lazy" />)}</div>}
          <dl className="catalog-details">{selected.fields.filter(field => field.value).map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
          <section className="catalog-sources" aria-labelledby="catalog-sources-title">
            <h3 id="catalog-sources-title">来源单据</h3>
            <ul>{selected.sources.map((source, index) => <li key={`${source.kind}-${source.rowNumber ?? 0}-${index}`}>
              <div className="catalog-source-heading"><div><strong>{types[source.kind][0]} · {source.number || '未填写编号'}</strong><small>{source.date || '未填写日期'}{source.rowNumber && ` · 第 ${source.rowNumber} 项产品`}</small></div>{catalogSourceAvailable(selected, source, saved.documents) ? <Button onClick={() => { setSelectedId(null); onOpen(source.kind, catalogSourceDocumentId(selected, source, saved.documents)); }} aria-label={`打开来源${types[source.kind][0]} ${source.number}`}>打开单据<ArrowRight size={16} aria-hidden="true" /></Button> : <small>来源单据已修改、删除或替换，副本仍可使用</small>}</div>
              {source.details.some(field => field.value) && <dl className="catalog-details catalog-source-details">{source.details.filter(field => field.value).map(field => <div key={field.key}><dt>{field.label}</dt><dd className="tabular-nums">{field.value}</dd></div>)}</dl>}
            </li>)}</ul>
          </section>
        </DialogContent>}
      </Dialog>
    </section>
  );
}
