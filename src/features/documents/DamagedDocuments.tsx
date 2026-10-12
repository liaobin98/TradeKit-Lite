import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirmation } from '@/components/controls';
import { damagedDocuments, recoverPreviousDocument } from '@/features/documents/documents-store';
import { updateWorkspace } from '@/features/workspace/workspace-storage';

export function DamagedDocuments() {
  const read = () => { try { return damagedDocuments(); } catch { return []; } };
  const [records, setRecords] = useState(read), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const { confirm, confirmation } = useConfirmation();
  useEffect(() => {
    const refresh = () => setRecords(read());
    window.addEventListener('workspace-committed', refresh);
    window.addEventListener('workspace-storage', refresh);
    return () => { window.removeEventListener('workspace-committed', refresh); window.removeEventListener('workspace-storage', refresh); };
  }, []);
  async function recover(record: typeof records[number]) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!await confirm('将使用上一版本恢复此单据，损坏原文会保留在全部资料备份中。', { title: '恢复上一版本？', confirmLabel: '确认恢复' })) return;
      await updateWorkspace(storage => recoverPreviousDocument(record.id, record.expected, storage));
      setRecords(read());
    } catch (e) { setError(e instanceof Error ? e.message : '恢复失败，原文仍保留。'); }
    finally { setBusy(false); }
  }
  return <>{confirmation}{records.length > 0 && <section className="documents-unreadable" aria-label="单据恢复">
    <h2>有 {records.length} 份单据暂时无法读取</h2>
    <p>其他单据可继续使用。损坏原文仍保留，可通过“备份 / 恢复”导出全部资料或恢复备份。</p>
    <ul>{records.map(record => <li key={record.id}>
      <span>{record.previous?.fields.number || record.id}</span>
      {record.previous ? <Button disabled={busy} onClick={() => void recover(record)}>恢复上一版本</Button> : <span>没有可读取的上一版本</span>}
    </li>)}</ul>
  </section>}{error && <p role="alert">{error}</p>}</>;
}
