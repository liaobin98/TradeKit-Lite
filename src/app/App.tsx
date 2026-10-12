import { DocumentToolbar } from '@/features/documents/DocumentToolbar';
import { HomeDashboard } from '@/app/HomeDashboard';
import { remembered } from '@/features/documents/document-defaults';
import { useWorldClock } from '@/features/world-clock/useWorldClock';
import { useRates } from '@/features/rates/useRates';
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet,
  Package,
  Home,
  Files,
  Building2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmation } from "@/components/controls";
import { LogoCrop } from "@/features/documents/LogoCrop";
import { ReferenceWorkspace } from "@/features/documents/ReferenceWorkspace";
import { sellerFields } from "@/features/documents/reference-model";
import { types, row, type Kind, type Doc } from '@/features/documents/model';
import { save } from '@/features/workspace/settings';
import { parseLocal } from '@/features/documents/parse-local';
import { excel, printDocument } from "@/features/documents/export";
import { decodeDoc } from '@/features/documents/drafts';
import { newDocument, documentRaw, readDocument, recentDraft, previousDocument, damagedDocuments, recoverPreviousDocument } from '@/features/documents/documents-store';
import { DamagedDocuments } from '@/features/documents/DamagedDocuments';
import { useDraft } from '@/features/documents/useDraft';
import { selectHomeDocument } from '@/features/documents/home-document';
import { createBlankDocument } from '@/features/documents/blank-document';
import { useDocumentNavigation } from '@/app/useDocumentNavigation';
import { isCatalogRoute, routeKind, routeDocumentId, routeDocumentNumber, recordRoute, type CatalogRoute, type DocumentRoute } from '@/app/navigation';
import { DocumentLibrary } from '@/features/documents/DocumentLibrary';
import { CatalogLibrary } from '@/features/catalogs/CatalogLibrary';
import { WorkspaceBackup } from '@/features/workspace/WorkspaceBackup';
import { ProjectLinks } from '@/app/ProjectLinks';
import { MobileNavigation } from '@/app/MobileNavigation';
import { validateDoc, assertExportable } from '@/features/documents/validation';
import { fetchJson } from "@/lib/api";
import { StatusNotice, type StatusMessage } from '@/components/StatusNotice';
import { updateWorkspace, refreshWorkspaceStorage } from '@/features/workspace/workspace-storage';
export function App() {
  const { confirm, confirmation } = useConfirmation();
  const activeKind = useRef<Kind | null>(null);
  const activeRoute = useRef<DocumentRoute>(null);
  const leavingDocument = useRef(false);
  const homeEntry = useRef<Kind | null>(null);
  const [showDocuments, setShowDocuments] = useState(false);
  const [catalog, setCatalog] = useState<CatalogRoute | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const [showRestoredLibrary, setShowRestoredLibrary] = useState(false);
  const skipRestoredDefaults = useRef(false);
  const [kind, setKind] = useState<Kind | null>(null),
    [doc, setDoc] = useState<Doc>(() => newDocument("QT", createBlankDocument('QT', remembered('QT')))),
    [status, setStatusMessage] = useState<StatusMessage | null>(null),
    [saveFeedback, setSaveFeedback] = useState<StatusMessage | null>(null),
    [busy, setBusy] = useState(false),
    [cropSource, setCropSource] = useState(""),
    [text, setText] = useState(""),
    [candidate, setCandidate] = useState<any>(null),
    [ai, setAi] = useState(false),
    [aiRequiresToken, setAiRequiresToken] = useState(false),
    [aiToken, setAiToken] = useState(""),
    [consent, setConsent] = useState(false);
  const draft = useDraft(doc, kind !== null);
  const navigation = useDocumentNavigation(changeRoute, kind ? doc : null);
  useEffect(() => {
    if (kind && doc.id && activeKind.current === kind) {
      activeRoute.current = recordRoute(kind, doc.id);
      navigation.replaceDocument(kind, doc.id);
    }
  }, [kind, doc.id, doc.fields.number, dataRevision]);
  useEffect(() => {
    if (!showRestoredLibrary || busy) return;
    setShowRestoredLibrary(false);
    void navigation.documents();
  }, [showRestoredLibrary, busy]);
  const issues = useMemo(() => validateDoc(doc), [doc]);
  const worldClock = useWorldClock();
  const exchangeRates = useRates(persist);
  function setStatus(text: string, tone: StatusMessage['tone'] = 'success') {
    setSaveFeedback(null);
    setStatusMessage(text ? { text, tone } : null);
  }
  useEffect(() => {
    if (saveFeedback?.tone !== 'success') return;
    const timer = setTimeout(() => setSaveFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [saveFeedback]);
  async function persist(key: string, value: unknown) {
    try {
      await updateWorkspace(storage => save(key, value, storage));
      return true;
    } catch {
      setStatus("保存失败：浏览器存储不可用或空间不足，请导出备份。", 'warning');
      return false;
    }
  }
  useEffect(() => {
    fetchJson("/api/config")
      .then((d) => {
        setAi(d.aiConfigured === true);
        setAiRequiresToken(d.aiRequiresToken === true);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (skipRestoredDefaults.current) { skipRestoredDefaults.current = false; return; }
    if (!kind) return;
    const t = setTimeout(() => {
      persist(
        "seller",
        Object.fromEntries(sellerFields.map(([k]) => [k, doc.fields[k] || ""])),
      );
      persist("settings", {
        language: doc.language,
        theme: doc.theme,
        layout: doc.layout,
        logo: doc.logo,
        defaults:Object.fromEntries(['currency','incoterm','payment','delivery'].map(k=>[k,doc.fields[k]||''])),
      });
    }, 500);
    return () => clearTimeout(t);
  }, [kind, doc.fields, doc.language, doc.theme, doc.layout, doc.logo]);
  async function prepareWorkspaceData() {
    if (!kind) { await refreshWorkspaceStorage(); return; }
    if (!await draft.flush(true)) throw Error('当前单据尚未保存，操作已中止。请先解决保存错误，再备份或恢复。');
    const current = draft.document();
    await updateWorkspace(storage => {
      save('seller', Object.fromEntries(sellerFields.map(([key]) => [key, current.fields[key] || ''])), storage);
      save('settings', { language: current.language, theme: current.theme, layout: current.layout, logo: current.logo,
        defaults: Object.fromEntries(['currency', 'incoterm', 'payment', 'delivery'].map(key => [key, current.fields[key] || ''])) }, storage);
    });
  }
  async function reloadCurrentDocument() {
    if (!await confirm('将重新读取已保存版本，当前未保存修改会被替换。请先导出当前编辑副本。', { title: '重新读取单据？', confirmLabel: '重新读取' })) return;
    await refreshWorkspaceStorage();
    const next = doc.id ? readDocument(doc.id) : null;
    if (!next) throw Error('此单据已被删除，请先保留编辑副本，再返回单据列表。');
    draft.reset(next, documentRaw(next.id!)); setDoc(next); setStatus('已重新读取保存版本。');
  }
  function workspaceRestored() {
    setDataRevision(value => value + 1);
    setCandidate(null); setCropSource(''); setSaveFeedback(null);
    if (!kind) return;
    skipRestoredDefaults.current = true;
    const raw = doc.id ? documentRaw(doc.id) : null;
    try {
      if (raw === null) throw Error('单据不在本次备份中');
      const next = decodeDoc(JSON.parse(raw), kind);
      draft.reset(next, raw); setDoc(next);
    } catch {
      // Reset the old editing snapshot before leaving, so it cannot overwrite
      // newly restored records or re-create a document omitted from the backup.
      const next = newDocument(kind, createBlankDocument(kind, remembered(kind)));
      draft.reset(next, null); setDoc(next);
      activeKind.current = null; setKind(null);
      setShowRestoredLibrary(true);
    }
  }
  async function openDocument(k: Kind, fromHome = false, id?: string) {
    try {
      await refreshWorkspaceStorage();
      const existing = id ? readDocument(id) : recentDraft(k);
      if (id && (!existing || existing.kind !== k)) throw Error('此单据已被删除或不属于当前类型。');
      const raw = existing?.id ? documentRaw(existing.id) : null;
      const selected = fromHome ? await selectHomeDocument(k, raw, previous => confirm(
        `发现${types[k][0]}草稿${previous.fields.number ? `（${previous.fields.number}）` : ''}。恢复这份草稿，还是新建单据？新建不会删除原草稿。`,
        { title: '恢复上次内容？', confirmLabel: '恢复编辑', cancelLabel: '新建空白', dismissible: true },
      )) : null;
      if (fromHome && selected === null) return false;
      const d = selected?.unsaved || !existing ? newDocument(k, createBlankDocument(k, remembered(k))) : selected?.document ?? existing;
      draft.reset(d, d.id ? documentRaw(d.id) : null, { unsaved: selected?.unsaved });
      activeKind.current = k;
      activeRoute.current = k; setShowDocuments(false); setCatalog(null);
      setDoc(d); setKind(k); setCandidate(null); setStatus('');
      if (selected?.warning) setSaveFeedback({ text: selected.warning, tone: 'warning' });
      window.scrollTo(0, 0);
      return true;
    } catch (e) {
      setStatus('读取草稿失败，原始数据未覆盖：' + String(e) + '。可恢复 JSON 备份。', 'warning');
      try {
        const prior = id ? previousDocument(id) : null;
        if (prior && await confirm('当前草稿读取失败。是否恢复上一次保存的版本？损坏原文会另行保留。')) {
          const damaged = damagedDocuments().find(record => record.id === id);
          if (!damaged) throw Error('此单据已发生变化，请重新打开。');
          await updateWorkspace(storage => recoverPreviousDocument(id!, damaged.expected, storage));
          const raw = documentRaw(id!);
          draft.reset(prior, raw); activeKind.current = k; activeRoute.current = k; setShowDocuments(false); setCatalog(null); setDoc(prior); setKind(k); setCandidate(null);
          setStatus('已恢复上一次保存版本；损坏原文仍保留在浏览器中。');
          return true;
        }
      } catch (error) { setStatus('恢复失败，原始数据未覆盖：' + String(error), 'warning'); }
    }
    return false;
  }
  async function changeRoute(next: DocumentRoute) {
    if (next === activeRoute.current) return true;
    if (routeDocumentNumber(next) !== null) {
      setStatus('此单据编号不存在或对应多份单据，请从“我的单据”列表重新打开。', 'warning');
      return false;
    }
    if (busy) { setStatus('正在处理当前单据，请完成后再返回或切换。', 'warning'); return false; }
    if (activeKind.current && !await draft.flush() && !await confirm('草稿未能保存。离开后重新进入可能丢失当前修改，请先下载 JSON 备份。仍然离开吗？')) return false;
    const nextKind = routeKind(next);
    if (nextKind) return openDocument(nextKind, homeEntry.current === nextKind, routeDocumentId(next) ?? undefined);
    try { await refreshWorkspaceStorage(); }
    catch { setSaveFeedback({ text: '本地资料无法读取，当前页面与编辑内容仍保留，请检查浏览器存储后重试。', tone: 'warning' }); return false; }
    activeKind.current = null; activeRoute.current = next; setShowDocuments(next === 'documents'); setCatalog(isCatalogRoute(next) ? next : null); setKind(null); setCandidate(null); setStatus('');
    window.scrollTo(0, 0);
    return true;
  }
  function back() {
    navigation.back();
  }
  async function startHomeDocument(k: Kind) {
    if (busy || homeEntry.current !== null) return;
    homeEntry.current = k;
    try { await navigation.open(k); }
    finally { homeEntry.current = null; }
  }
  async function blank() {
    if (busy || !kind) return;
    leavingDocument.current = true; setBusy(true);
    try {
      if (!await draft.flush()) { setStatus('当前草稿保存失败，未新建空白。请先下载 JSON 备份。', 'warning'); return; }
      const next = newDocument(kind, createBlankDocument(kind, remembered(kind)));
      draft.reset(next, null); setDoc(next); setCandidate(null);
      setText(''); setCropSource('');
      setStatus('已新建空白，原单据仍保留。');
    } catch (e) { setStatus('新建失败，当前单据保留：' + String(e), 'warning'); }
    finally { leavingDocument.current = false; setBusy(false); }
  }
  async function exporting(fn: typeof excel) {
    setBusy(true);
    try {
      assertExportable(doc);
      if (!await draft.flush(true)) throw Error('当前单据保存失败，请重试。');
      await fn(doc);
      try { await draft.syncProducts(doc); }
      catch (error) { setStatus('文件已导出，但产品资料同步失败：' + String(error) + '。请点击“保存草稿”重试。', 'warning'); return; }
      setStatus('文件已导出。');
    } catch (e) {
      setStatus("导出失败：" + String(e), 'warning');
    } finally {
      setBusy(false);
    }
  }
  async function printing() {
    setBusy(true);
    try {
      assertExportable(doc);
      if (!await draft.flush(true)) throw Error('当前单据保存失败，请重试。');
      await printDocument(doc);
      try { await draft.syncProducts(doc); }
      catch (error) { setStatus('已调用浏览器打印，但产品资料同步失败：' + String(error) + '。请点击“保存草稿”重试。', 'warning'); return; }
      setStatus('已调用浏览器打印。');
    } catch (e) {
      setStatus('打印失败：' + String(e), 'warning');
    } finally {
      setBusy(false);
    }
  }
  function updateDocument(action: React.SetStateAction<Doc>) {
    if (leavingDocument.current) return;
    setDoc(current => {
      const { issued: _issued, ...next } = typeof action === 'function' ? action(current) : action;
      return { ...next, id: current.id, status: current.status ?? 'draft' };
    });
  }
  async function saveCurrent(asDraft: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const next = { ...draft.document(), status: asDraft ? 'draft' as const : 'saved' as const };
      const success = await draft.commit(next, true, true);
      if (success) setDoc(next);
      setStatus('');
      setSaveFeedback({ text: success ? asDraft ? '草稿已保存。' : '单据已保存。' : '保存失败，当前编辑仍保留，请检查存储后重试。', tone: success ? 'success' : 'warning' });
    } finally { setBusy(false); }
  }
  async function parse(remote: boolean) {
    if (busy) return;
    setBusy(true);
    setCandidate(null);
    try {
      if (!remote) {
        setCandidate({ ...parseLocal(text), source: "本地规则解析（非 AI）" });
        return;
      }
      if (!ai || !consent) throw Error("模型未配置或未同意发送内容");
      if (aiRequiresToken && !aiToken.trim()) throw Error("请填写 AI 访问口令");
      const v = await fetchJson("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(aiRequiresToken ? { Authorization: `Bearer ${aiToken.trim()}` } : {}),
        },
        body: JSON.stringify({ text }),
      });
      const allowed = [
        ...sellerFields.map((f) => f[0]),
        "buyer",
        "buyerAddress",
        "buyerContact",
        "buyerPhone",
        "buyerEmail",
        "buyerCountry",
        "currency",
        "incoterm",
        "payment",
        "delivery",
      ];
      const f: Record<string, string> = {};
      for (const k of allowed)
        if (typeof v.fields?.[k] === "string") f[k] = v.fields[k];
      const rows = Array.isArray(v.rows)
        ? v.rows
            .filter((r: any) => typeof r.name === "string")
            .map((r: any) => ({
              ...row(),
              ...Object.fromEntries(
                ["name", "nameEn", "qty", "price", "unit", "spec", "code"]
                  .filter((k) => typeof r[k] === "string")
                  .map((k) => [k, r[k]]),
              ),
            }))
        : [];
      setCandidate({ fields: f, rows, source: "模型结果（请核对）" });
    } catch (e) {
      setStatus(String(e), 'warning');
    } finally {
      setBusy(false);
    }
  }
  async function applyCandidate() {
    if (busy) return;
    if (
      !candidate ||
      !(await confirm(
        "将覆盖已识别的对应字段；识别到产品时替换当前产品明细。请核对后确认。",
      ))
    )
      return;
    updateDocument((d) => ({
      ...d,
      fields: { ...d.fields, ...candidate.fields },
      rows: candidate.rows.length ? candidate.rows : d.rows,
    }));
    setCandidate(null);
  }
  function image(file: File | undefined, key: string) {
    if (busy) return;
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp","image/gif"].includes(file.type) ||
      file.size > 2000000
    ) {
      setStatus("请选择小于 2 MB 的 PNG/JPEG/WebP 图片", 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setStatus("图片读取失败", 'warning');
    reader.onload = () => {
      if (key === "logo") {
        setCropSource(String(reader.result));
        return;
      }
      updateDocument((d) => ({
        ...d,
        rows: d.rows.map((r) =>
          r.id === key ? { ...r, image: String(reader.result) } : r,
        ),
      }));
    };
    reader.readAsDataURL(file);
  }
  return (
    <>
      {confirmation}
      {cropSource && (
        <LogoCrop
          src={cropSource}
          onCancel={() => setCropSource("")}
          onSave={(logo) => {
            updateDocument((d) => ({ ...d, logo }));
            setCropSource("");
          }}
        />
      )}
      <div className="site-bar">
        <div>
          <Button variant="ghost" className="site-brand" onClick={() => navigation.home()} disabled={busy} aria-label="外贸工具箱，返回首页">
            <img className="site-mark" src="/favicon.svg" width="38" height="38" alt="" aria-hidden="true" />
            <strong>
              外贸工具箱<small>TradeKit Lite</small>
            </strong>
          </Button>
          <nav className="site-navigation" aria-label="主导航">
            <Button variant="ghost" className="site-current" onClick={() => navigation.home()} disabled={busy} aria-current={!kind && !showDocuments && !catalog ? "page" : undefined}><Home size={18} aria-hidden="true" />首页</Button>
            <Button variant="ghost" className="site-current" onClick={() => navigation.documents()} disabled={busy} aria-current={showDocuments ? "page" : undefined}><Files size={18} aria-hidden="true" />我的单据</Button>
            <Button variant="ghost" className="site-current" onClick={() => navigation.catalog('sellers')} disabled={busy} aria-current={catalog === 'sellers' ? "page" : undefined}><Building2 size={18} aria-hidden="true" />卖方</Button>
            <Button variant="ghost" className="site-current" onClick={() => navigation.catalog('buyers')} disabled={busy} aria-current={catalog === 'buyers' ? "page" : undefined}><Users size={18} aria-hidden="true" />买方</Button>
            <Button variant="ghost" className="site-current" onClick={() => navigation.catalog('products')} disabled={busy} aria-current={catalog === 'products' ? "page" : undefined}><Package size={18} aria-hidden="true" />产品</Button>
          </nav>
          <div className="site-tools"><ProjectLinks /><WorkspaceBackup busy={busy} onBusyChange={setBusy} prepare={prepareWorkspaceData} onRestored={workspaceRestored}
            currentDocument={kind ? () => draft.document() : undefined} reloadCurrent={kind ? reloadCurrentDocument : undefined}
            renderMobileMenu={(openBackup, triggerRef) => <MobileNavigation busy={busy} triggerRef={triggerRef}
              current={kind ? null : showDocuments ? 'documents' : catalog ?? 'home'} onBackup={openBackup}
              onNavigate={destination => {
                if (destination === 'home') navigation.home();
                else if (destination === 'documents') void navigation.documents();
                else void navigation.catalog(destination);
              }} />}
          /></div>
        </div>
      </div>
      {!kind && !showDocuments && !catalog && (
        <header className="home-header">
          <div className="brand">
            <span className="logo page-heading-icon" aria-hidden="true">
              <FileSpreadsheet />
            </span>
            <div>
              <span className="brand-eyebrow">TRADEKIT LITE</span>
              <h1>在线单据制作</h1>
              <p>
                选择单据类型，填写后即可预览、打印和导出。
                <br />
                普通填写、预览、草稿和导出均在本地浏览器处理，不上传云端，如有必要，请及时备份保存数据。
                <br />
                如有使用问题或功能定制需求，请点击右上角 GitHub，前往项目页面联系作者。
              </p>
            </div>
          </div>
        </header>
      )}
      <main className={kind ? "main-workspace" : ""}>
        <div className="page-feedback"><StatusNotice message={status} /></div>
        {!kind && <DamagedDocuments />}
        {catalog ? (
          <CatalogLibrary key={`${catalog}-${dataRevision}`} category={catalog} onOpen={(k, id) => { void navigation.open(k, id); }} onCreate={() => navigation.home()} />
        ) : showDocuments ? (
          <DocumentLibrary key={dataRevision} onOpen={(k, id) => { void navigation.open(k, id); }} onCreate={() => navigation.home()} />
        ) : !kind ? (
          <HomeDashboard busy={busy} startHomeDocument={startHomeDocument} persist={persist} worldClock={worldClock} exchangeRates={exchangeRates} />
        ) : (
          <>
            <DocumentToolbar kind={kind} doc={doc} busy={busy} issues={issues}
              feedback={draft.error ? { text: `草稿保存失败：${draft.error}。当前编辑仍保留，请检查存储后重试。`, tone: 'warning' } : saveFeedback}
              back={back} blank={blank} saveCurrent={saveCurrent} exporting={exporting} printing={printing} />
            <ReferenceWorkspace
              key={dataRevision}
              doc={doc}
              setDoc={updateDocument}
              image={image}
              text={text}
              setText={setText}
              busy={busy}
              ai={ai}
              aiRequiresToken={aiRequiresToken}
              aiToken={aiToken}
              setAiToken={setAiToken}
              consent={consent}
              setConsent={setConsent}
              parse={parse}
              candidate={candidate}
              applyCandidate={applyCandidate}
              issues={issues}
            />
          </>
        )}
      </main>
    </>
  );
}
