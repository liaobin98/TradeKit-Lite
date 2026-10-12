import { fresh, type Kind, type Doc } from '@/features/documents/model';
import { KEY, workspaceStorage } from '@/features/workspace/workspace-storage';

export function remembered(kind: Kind) {
  const d = fresh(kind);
  try {
    const seller = JSON.parse(workspaceStorage().getItem(KEY + "seller") || "{}");
    const settings = JSON.parse(workspaceStorage().getItem(KEY + "settings") || "{}");
    return {
      ...d,
      ...settings,
      kind,
      fields: { ...d.fields,...settings.defaults, ...seller },
    } as Doc;
  } catch {
    return d;
  }
}
