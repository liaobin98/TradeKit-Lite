import { KEY, workspaceStorage } from '@/features/workspace/workspace-storage';

export function save(
  key: string,
  data: unknown,
  storage: Storage = workspaceStorage(),
) {
  storage.setItem(KEY + key, JSON.stringify(data));
}
