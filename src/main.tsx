import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { StartupLoading } from '@/app/StartupLoading';
import { StorageRecovery } from '@/features/workspace/StorageRecovery';
import { initializeWorkspaceStorage, updateWorkspace } from '@/features/workspace/workspace-storage';
import { initializeDocuments } from '@/features/documents/documents-store';
import { readSavedCatalogs } from '@/features/catalogs/catalog-sync';
import "@/styles/theme.css";
import "@/styles/style.css";
import "@/styles/reference.css";
import "@/components/components.css";
import "@/features/documents/reference-detail.css";
import "@/components/form-controls.css";
import '@/features/documents/safety.css';
import '@/components/status-notice.css';
import '@/styles/print.css';

const root = createRoot(document.getElementById("root")!);
async function startApp() {
  // 与 HTML 首屏使用同一加载界面，连续覆盖脚本加载和资料初始化。
  root.render(<StartupLoading />);
  try {
    await initializeWorkspaceStorage();
    await updateWorkspace(storage => initializeDocuments(storage));
    // Capture legacy directory copies once, atomically. Damaged originals are
    // retained and reported by the directory/editor, not reset during startup.
    try { await updateWorkspace(storage => readSavedCatalogs(storage)); } catch { /* Preserve damaged catalog data. */ }
    root.render(<App />);
  } catch (error) {
    root.render(<StorageRecovery error={error} retry={() => void startApp()} />);
  }
}
void startApp();
