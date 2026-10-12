import { KEY } from '@/features/workspace/workspace-storage';
import { types, fresh, type Doc, type Kind } from '@/features/documents/model';
import { BACKUP_FORMAT, decodeDoc, parseBackup } from '@/features/documents/drafts';
import { buildFormCatalog } from '@/features/catalogs/form-catalog';
import { CATALOG_DATA_KEY, captureCatalogDocuments, parseCatalogStore } from '@/features/catalogs/catalog-storage';
import { workspaceStorage, mapStorage } from '@/features/workspace/workspace-storage';
import { DOCUMENTS_DATA_KEY, readDocumentsEnvelope, documentRecords, damagedDocuments, newDocument, saveDocument } from '@/features/documents/documents-store';

export const WORKSPACE_BACKUP_FORMAT = 'tradekit-lite-workspace-backup';
export const MAX_WORKSPACE_BACKUP_BYTES = 50_000_000;
const families = ['draft:', 'draft-previous:', 'draft-corrupt:'] as const;
export const workspaceDataKeys = [
  ...families.flatMap(prefix => (Object.keys(types) as Kind[]).map(kind => prefix + kind)),
  'seller', 'settings', CATALOG_DATA_KEY, DOCUMENTS_DATA_KEY,
];
export type BackupEntry = { key: string; raw: string; unreadable?: true };
export type WorkspaceBackup = {
  format: typeof WORKSPACE_BACKUP_FORMAT;
  version: 1 | 2;
  savedAt: string;
  entries: BackupEntry[];
  editing?: Doc;
};
export type RestorePlan = { scope: 'workspace' | 'document'; backup: WorkspaceBackup };
export type WorkspaceSnapshot = Record<string, string | null>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function kindOf(key: string) { return key.split(':')[1] as Kind; }

export function workspaceSnapshot(storage: Storage = workspaceStorage()): WorkspaceSnapshot {
  return Object.fromEntries(workspaceDataKeys.map(key => [key, storage.getItem(KEY + key)]));
}

function validateEntry(entry: BackupEntry) {
  if (entry.key === DOCUMENTS_DATA_KEY) { readDocumentsEnvelope(entry.raw); return; }
  if (entry.key === CATALOG_DATA_KEY) { parseCatalogStore(entry.raw); return; }
  if (entry.key.startsWith('draft-corrupt:')) return;
  if (entry.key.startsWith('draft:') || entry.key.startsWith('draft-previous:')) {
    try { decodeDoc(JSON.parse(entry.raw), kindOf(entry.key)); }
    catch {
      if (!entry.unreadable) throw Error(`${entry.key} 单据内容损坏或不兼容，未恢复任何数据。`);
    }
    return;
  }
  const value: unknown = JSON.parse(entry.raw);
  if (!object(value)) throw Error('常用卖方或单据设置格式不正确。');
  if (entry.key === 'seller') {
    if (!Object.values(value).every(item => typeof item === 'string')) throw Error('常用卖方资料必须为文本。');
  } else {
    const { language, theme, layout, logo, defaults } = value;
    // Settings are spread into newly-created documents: disallow unrelated fields.
    if (Object.keys(value).some(key => !['language', 'theme', 'layout', 'logo', 'defaults'].includes(key))) throw Error('单据设置含有不支持的字段。');
    if (defaults !== undefined && (!object(defaults) || !Object.values(defaults).every(item => typeof item === 'string')))
      throw Error('常用条款设置必须为文本。');
    const doc = fresh('QT');
    decodeDoc({ ...doc, ...(language !== undefined ? { language } : {}), ...(theme !== undefined ? { theme } : {}),
      ...(layout !== undefined ? { layout } : {}), ...(logo !== undefined ? { logo } : {}) });
  }
}

export function createWorkspaceBackup(storage: Storage = workspaceStorage(), editing?: Doc): WorkspaceBackup {
  const snapshot = workspaceSnapshot(storage);
  const entries: BackupEntry[] = [];
  for (const key of workspaceDataKeys) {
    const raw = snapshot[key];
    if (raw === null) continue;
    const entry: BackupEntry = { key, raw };
    if (key.startsWith('draft:') || key.startsWith('draft-previous:')) {
      try { decodeDoc(JSON.parse(raw), kindOf(key)); } catch { entry.unreadable = true; }
    } else if (key === 'seller' || key === 'settings' || key === CATALOG_DATA_KEY || key === DOCUMENTS_DATA_KEY) {
      try { validateEntry(entry); } catch { entry.unreadable = true; }
    }
    entries.push(entry);
  }
  // 带未保存副本时使用 v2，旧版程序会明确拒绝，避免静默丢失副本。
  return { format: WORKSPACE_BACKUP_FORMAT, version: editing ? 2 : 1, savedAt: new Date().toISOString(), entries,
    ...(editing ? { editing: decodeDoc(editing) } : {}) };
}

export function serializeWorkspaceBackup(backup: WorkspaceBackup) {
  const text = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(text).length > MAX_WORKSPACE_BACKUP_BYTES) throw Error('全部数据备份超过 50 MB，请减少大图片后重试。');
  return text;
}

export function parseWorkspaceBackup(text: string): RestorePlan {
  if (new TextEncoder().encode(text).length > MAX_WORKSPACE_BACKUP_BYTES) throw Error('备份文件不能超过 50 MB。');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw Error('文件不是有效的 JSON 备份。'); }
  if (object(data) && (data.format === BACKUP_FORMAT || data.version === 1 && typeof data.kind === 'string')) {
    const doc = parseBackup(text);
    return { scope: 'document', backup: { format: WORKSPACE_BACKUP_FORMAT, version: 1,
      savedAt: typeof data.savedAt === 'string' ? data.savedAt : '', entries: [{ key: 'draft:' + doc.kind, raw: JSON.stringify(doc) }] } };
  }
  if (!object(data) || data.format !== WORKSPACE_BACKUP_FORMAT || ![1, 2].includes(data.version as number) ||
      typeof data.savedAt !== 'string' || !Number.isFinite(Date.parse(data.savedAt)) || !Array.isArray(data.entries))
    throw Error('不是兼容的 TradeKit 备份，未恢复任何数据。');
  const seen = new Set<string>();
  const entries = data.entries.map((value: unknown): BackupEntry => {
    if (!object(value) || typeof value.key !== 'string' || !workspaceDataKeys.includes(value.key) ||
        typeof value.raw !== 'string' || seen.has(value.key) || value.unreadable !== undefined && value.unreadable !== true)
      throw Error('备份含有重复、未知或不安全的数据项。');
    seen.add(value.key);
    const entry: BackupEntry = { key: value.key, raw: value.raw, ...(value.unreadable === true ? { unreadable: true as const } : {}) };
    if (entry.unreadable && (entry.key === 'seller' || entry.key === 'settings' || entry.key === CATALOG_DATA_KEY || entry.key === DOCUMENTS_DATA_KEY)) {
      // Damaged preferences are archived on export but never used to create docs.
      // Restore refuses them instead of silently losing or activating unsafe data.
      throw Error('备份含有损坏的常用资料或设置，请先修复备份后再恢复。原始内容仍保留在备份文件中。');
    }
    validateEntry(entry);
    return entry;
  });
  if (data.editing !== undefined && data.version !== 2) throw Error('编辑副本的备份版本不兼容。');
  if (data.version === 2 && data.editing === undefined) throw Error('备份缺少编辑副本。');
  const editing = data.editing === undefined ? undefined : decodeDoc(data.editing);
  return { scope: 'workspace', backup: { format: WORKSPACE_BACKUP_FORMAT, version: data.version as 1 | 2, savedAt: data.savedAt, entries,
    ...(editing ? { editing } : {}) } };
}

export function workspaceBackupSummary(backup: WorkspaceBackup) {
  const documents: Doc[] = [];
  let previous = 0, unreadable = 0;
  const documentEntry = backup.entries.find(entry => entry.key === DOCUMENTS_DATA_KEY);
  if (documentEntry && !documentEntry.unreadable) {
    const temporary = mapStorage(new Map([[KEY + DOCUMENTS_DATA_KEY, documentEntry.raw]]));
    for (const entry of documentRecords(temporary)) {
      documents.push(entry.document);
      if (entry.previousRaw) previous++;
    }
    unreadable += damagedDocuments(temporary).length + (readDocumentsEnvelope(documentEntry.raw).quarantine?.length ?? 0);
  }
  if (backup.editing) documents.push(backup.editing);
  for (const entry of backup.entries) {
    if (entry.unreadable || entry.key.startsWith('draft-corrupt:')) unreadable++;
    if (entry.key.startsWith('draft-previous:')) previous++;
    if (!documentEntry && entry.key.startsWith('draft:')) {
      try { documents.push(decodeDoc(JSON.parse(entry.raw), kindOf(entry.key))); } catch { /* Original retained in entries. */ }
    }
  }
  const catalogEntry = backup.entries.find(entry => entry.key === CATALOG_DATA_KEY);
  let copies = null;
  if (catalogEntry && !catalogEntry.unreadable) { try { copies = parseCatalogStore(catalogEntry.raw, documents); } catch { /* Damaged original is retained by backup. */ } }
  return { documents: documents.length, sellers: copies ? copies.records.sellers.length : buildFormCatalog(documents, 'sellers').length,
    buyers: copies ? copies.records.buyers.length : buildFormCatalog(documents, 'buyers').length,
    products: copies ? copies.records.products.length : buildFormCatalog(documents, 'products').length, previous, unreadable };
}

export class WorkspaceRestoreError extends Error {
  constructor(message: string, public rollbackSucceeded: boolean) { super(message); }
}

// Replace only the app's business keys. Never clear storage, rates or other apps.
// Per-key compare-and-swap checks refuse concurrent edits; failed writes roll back
// only values we wrote, so another tab's newer changes are not overwritten.
export function restoreWorkspaceBackup(plan: RestorePlan, expected: WorkspaceSnapshot, storage: Storage = workspaceStorage()) {
  const current = workspaceSnapshot(storage);
  if (workspaceDataKeys.some(key => current[key] !== expected[key])) throw Error('选择备份后，本地资料已发生变化。请重新选择备份并确认，避免覆盖其他标签页的更新。');
  const target: WorkspaceSnapshot = plan.scope === 'workspace'
    ? Object.fromEntries(workspaceDataKeys.map(key => [key, null])) : { ...current };
  for (const entry of plan.backup.entries) target[entry.key] = entry.raw;
  if (current[DOCUMENTS_DATA_KEY] !== null && (plan.scope === 'document' || !plan.backup.entries.some(entry => entry.key === DOCUMENTS_DATA_KEY))) {
    // Explicitly importing an older backup is different from the one-time reset.
    // Single-document imports append; whole-workspace imports replace the collection.
    if (plan.scope === 'workspace') target[DOCUMENTS_DATA_KEY] = JSON.stringify({ version: 1, records: {} });
    const data = new Map(Object.entries(target).filter((entry): entry is [string, string] => entry[1] !== null).map(([key, raw]) => [KEY + key, raw]));
    const temporary = mapStorage(data, true);
    const incoming = plan.backup.entries.filter(entry => entry.key.startsWith('draft:') && !entry.unreadable);
    for (const entry of incoming) {
      const original = decodeDoc(JSON.parse(entry.raw), kindOf(entry.key));
      const document = newDocument(original.kind, original);
      if (original.status === 'saved' || original.issued) document.status = 'saved';
      saveDocument(document, null, temporary, { syncProducts: true });
      target[entry.key] = null;
    }
    target[DOCUMENTS_DATA_KEY] = temporary.getItem(KEY + DOCUMENTS_DATA_KEY);
    target[CATALOG_DATA_KEY] = temporary.getItem(KEY + CATALOG_DATA_KEY);
  } else if (plan.scope === 'document') {
    const entry = plan.backup.entries[0];
    const prior = current[entry.key];
    let copies = parseCatalogStore(current[CATALOG_DATA_KEY]);
    if (current[CATALOG_DATA_KEY] === null) copies.version = 2;
    if (prior !== null) {
      let valid = true;
      try { copies = captureCatalogDocuments(copies, [decodeDoc(JSON.parse(prior), kindOf(entry.key))], 'previous'); } catch { valid = false; }
      target[(valid ? 'draft-previous:' : 'draft-corrupt:') + kindOf(entry.key)] = prior;
    }
    copies = captureCatalogDocuments(copies, [decodeDoc(JSON.parse(entry.raw), kindOf(entry.key))]);
    copies.version = 3;
    target[CATALOG_DATA_KEY] = JSON.stringify(copies);
  }
  if (plan.backup.editing) {
    // 未保存副本作为新单据导入，保留备份内已保存/其他标签页的版本。
    const data = new Map(Object.entries(target).filter((entry): entry is [string, string] => entry[1] !== null).map(([key, raw]) => [KEY + key, raw]));
    const temporary = mapStorage(data, true);
    const incoming = newDocument(plan.backup.editing.kind, plan.backup.editing);
    saveDocument(incoming, null, temporary);
    target[DOCUMENTS_DATA_KEY] = temporary.getItem(KEY + DOCUMENTS_DATA_KEY);
    target[CATALOG_DATA_KEY] = temporary.getItem(KEY + CATALOG_DATA_KEY);
  }
  const changes = workspaceDataKeys.filter(key => target[key] !== current[key])
    .sort((a, b) => Number(target[a] !== null) - Number(target[b] !== null));
  const applied: string[] = [];
  try {
    for (const key of changes) {
      if (storage.getItem(KEY + key) !== current[key]) throw Error('恢复期间另一标签页更新了资料，已停止恢复。');
      const value = target[key];
      if (value === null) storage.removeItem(KEY + key); else storage.setItem(KEY + key, value);
      applied.push(key);
    }
  } catch (error) {
    let complete = true;
    const rollback: string[] = [];
    for (const key of applied.reverse()) {
      try {
        if (storage.getItem(KEY + key) !== target[key]) { complete = false; continue; }
        storage.removeItem(KEY + key);
        rollback.push(key);
      } catch { complete = false; }
    }
    for (const key of rollback) {
      try {
        if (storage.getItem(KEY + key) !== null) { complete = false; continue; }
        if (current[key] !== null) storage.setItem(KEY + key, current[key]!);
      } catch { complete = false; }
    }
    throw new WorkspaceRestoreError(`${error instanceof Error ? error.message : '浏览器存储写入失败'}。${complete ? '已撤回本次写入，原有资料保留。' : '部分写入无法撤回，请使用恢复前自动下载的安全备份。'}`, complete);
  }
}
