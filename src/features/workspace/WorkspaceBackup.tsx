import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Archive, Download, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilePicker } from '@/components/controls';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { download } from '@/features/documents/export';
import { createWorkspaceBackup, serializeWorkspaceBackup, parseWorkspaceBackup, workspaceBackupSummary,
  workspaceSnapshot, restoreWorkspaceBackup, MAX_WORKSPACE_BACKUP_BYTES, type RestorePlan, type WorkspaceSnapshot } from '@/features/workspace/workspace-backup';
import '@/features/workspace/workspace-backup.css';
import { updateWorkspace, refreshWorkspaceStorage } from '@/features/workspace/workspace-storage';
import type { Doc } from '@/features/documents/model';
import { serializeBackup } from '@/features/documents/drafts';

export function WorkspaceBackup({ busy, onBusyChange, prepare, onRestored, renderMobileMenu, currentDocument, reloadCurrent }: {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  prepare: () => Promise<void>;
  onRestored: () => void;
  currentDocument?: () => Doc;
  reloadCurrent?: () => Promise<void>;
  renderMobileMenu?: (openBackup: () => void, triggerRef: RefObject<HTMLButtonElement | null>) => ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null), running = useRef(false);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [candidate, setCandidate] = useState<{ plan: RestorePlan; expected: WorkspaceSnapshot; name: string } | null>(null);
  const summary = candidate ? workspaceBackupSummary(candidate.plan.backup) : null;
  function start() {
    if (running.current || busy) return false;
    running.current = true; onBusyChange(true); setError(''); setMessage(''); return true;
  }
  function finish() { running.current = false; onBusyChange(false); }
  function fileName(prefix: string) { return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; }
  async function snapshotBackup() {
    let editing: Doc | undefined;
    try { await prepare(); }
    catch {
      editing = currentDocument?.();
      // 刷新失败时仍允许救援最近读取的快照和当前内存副本。
      try { await refreshWorkspaceStorage(); } catch { /* 原快照保留。 */ }
      setError(editing ? '当前修改尚未保存，已作为独立编辑副本包含在备份中；恢复时将导入为新单据。' : '无法重新读取资料，备份使用最近读取的快照，请保留已有备份。');
    }
    return createWorkspaceBackup(undefined, editing);
  }
  async function exportEditing() {
    if (!currentDocument || !start()) return;
    try {
      const text = serializeBackup(currentDocument());
      if (new TextEncoder().encode(text).length > 20_000_000) throw Error('单份编辑副本超过 20 MB，请使用全部资料备份。');
      download(new Blob([text], { type: 'application/json' }), fileName('tradekit-editing-copy'));
      setMessage('已导出当前编辑副本，可通过“选择备份恢复”导入为新单据。');
    } catch (e) { setError(String(e)); }
    finally { finish(); }
  }
  async function reload() {
    if (!reloadCurrent || !start()) return;
    try { await reloadCurrent(); }
    catch (e) { setError(String(e)); }
    finally { finish(); }
  }
  async function backup() {
    if (!start()) return;
    try {
      const data = await snapshotBackup();
      download(new Blob([serializeWorkspaceBackup(data)], { type: 'application/json' }), fileName('tradekit-all-data'));
      const counts = workspaceBackupSummary(data);
      setMessage(`已生成全部资料备份：${counts.documents} 份单据、${counts.sellers} 条卖方、${counts.buyers} 条买方、${counts.products} 条产品资料。请妥善保存下载的 JSON 文件。${counts.unreadable ? '无法读取的原文也已保留在备份中。' : ''}`);
    } catch (e) { setError(e instanceof Error ? e.message : '备份失败，原有数据未改变。'); }
    finally { finish(); }
  }
  async function selectFile(file: File) {
    if (!start()) return;
    setCandidate(null);
    try {
      if (file.size > MAX_WORKSPACE_BACKUP_BYTES) throw Error('备份文件不能超过 50 MB。');
      const plan = parseWorkspaceBackup(await file.text());
      await refreshWorkspaceStorage();
      setCandidate({ plan, expected: workspaceSnapshot(), name: file.name });
    } catch (e) { setError(e instanceof Error ? e.message : '备份读取失败，原有数据未改变。'); }
    finally { finish(); }
  }
  async function restore() {
    if (!candidate || !start()) return;
    try {
      await refreshWorkspaceStorage();
      const current = workspaceSnapshot();
      if (Object.keys(current).some(key => current[key] !== candidate.expected[key]))
        throw Error('选择备份后，本地资料已发生变化。请重新选择备份并确认，避免覆盖其他标签页的更新。');
      // A downloadable safety copy exists even if browser storage becomes unavailable.
      download(new Blob([serializeWorkspaceBackup(createWorkspaceBackup(undefined, currentDocument?.()))], { type: 'application/json' }), fileName('tradekit-before-restore'));
      await updateWorkspace(storage => restoreWorkspaceBackup(candidate.plan, candidate.expected, storage));
      onRestored();
      setCandidate(null);
      setMessage('资料已恢复。恢复前的资料已自动生成安全备份，请保留下载的 JSON 文件。');
    } catch (e) { setError(e instanceof Error ? e.message : '恢复失败，请保留恢复前的安全备份。'); }
    finally { finish(); }
  }
  function openBackup() { setOpen(true); setMessage(''); setError(''); setCandidate(null); }
  return <>
    <Button ref={trigger} className="workspace-backup-trigger" disabled={busy} aria-label="备份 / 恢复全部资料" onClick={openBackup}>
      <Archive size={16} aria-hidden="true" /><span className="backup-trigger-text">备份 / 恢复</span>
    </Button>
    {renderMobileMenu?.(openBackup, mobileTrigger)}
    <Dialog open={open} onOpenChange={next => { if (!running.current) setOpen(next); }}>
      <DialogContent className="workspace-backup-dialog" aria-busy={busy} onCloseAutoFocus={event => {
        event.preventDefault();
        const target = trigger.current?.getClientRects().length ? trigger.current : mobileTrigger.current;
        target?.focus();
      }}>
        <DialogTitle className="text-balance">备份与恢复全部资料</DialogTitle>
        <DialogDescription className="text-pretty">备份包含全部单据、草稿、图片和独立资料，数据不上传云端。请妥善保管备份文件。</DialogDescription>
        <div className="workspace-backup-actions ui-dialog-actions">
          <Button disabled={busy} onClick={backup}><Download size={16} aria-hidden="true" />备份全部资料</Button>
          <FilePicker disabled={busy} label="选择资料备份文件" text="选择备份恢复" accept="application/json,.json" onFile={file => void selectFile(file)} />
          {currentDocument && <Button disabled={busy} onClick={exportEditing}>导出当前编辑副本</Button>}
          {reloadCurrent && <Button disabled={busy} onClick={reload}>重新读取已保存版本</Button>}
        </div>
        <p className="workspace-backup-help">全部资料备份上限 50 MB，兼容恢复旧版单份单据备份（上限 20 MB）。备份含联系人、银行资料等，请勿随意分享。</p>
        {candidate && summary && <section className="workspace-restore-review" aria-labelledby="workspace-restore-title">
          <h3 id="workspace-restore-title">恢复前确认</h3>
          <p className="workspace-backup-filename">{candidate.name}</p>
          <dl className="workspace-backup-counts">
            <div><dt>单据</dt><dd>{summary.documents} 份</dd></div><div><dt>卖方资料</dt><dd>{summary.sellers} 条</dd></div>
            <div><dt>买方资料</dt><dd>{summary.buyers} 条</dd></div><div><dt>产品资料</dt><dd>{summary.products} 条</dd></div>
          </dl>
          <p>{candidate.plan.scope === 'workspace' ? '将用备份替换当前浏览器的全部单据与资料，备份中未包含的内容也会移除。' : '单份单据将导入为新记录，不覆盖已有单据。'}恢复前会自动下载当前资料的安全备份。</p>
          {candidate.plan.backup.editing && <p>备份包含未保存的编辑副本，将导入为新单据，保留原保存版本。</p>}
          {summary.unreadable > 0 && <p>包含 {summary.unreadable} 项无法读取的原文，恢复后仍保留原文，不会推测或修复其内容。</p>}
          <div className="workspace-backup-actions ui-dialog-actions"><Button disabled={busy} onClick={() => { setCandidate(null); setError(''); }}>取消恢复</Button><Button variant="default" disabled={busy} onClick={restore}><RotateCcw size={16} aria-hidden="true" />确认恢复</Button></div>
        </section>}
        {error && <p className="workspace-backup-error" role="alert">{error}</p>}
        {message && <p className="workspace-backup-success" role="status">{message}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
