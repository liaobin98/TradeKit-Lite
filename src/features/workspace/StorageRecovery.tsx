import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { WorkspaceBackup } from '@/features/workspace/WorkspaceBackup';
import { refreshWorkspaceStorage } from '@/features/workspace/workspace-storage';

export function StorageRecovery({ error, retry }: { error: unknown; retry: () => void }) {
  const [busy, setBusy] = useState(false);
  return <main className="storage-recovery">
    <h1>无法打开本地资料存储</h1>
    <p role="alert">{error instanceof Error ? error.message : '请检查浏览器是否允许 IndexedDB。'} 原有资料未清空，请勿清理浏览器数据。</p>
    <p>可先导出原始资料备份，再选择已保存的正常备份恢复。</p>
    <Button disabled={busy} onClick={retry}>重试读取</Button>
    <WorkspaceBackup busy={busy} onBusyChange={setBusy} prepare={refreshWorkspaceStorage} onRestored={retry} />
  </main>;
}
