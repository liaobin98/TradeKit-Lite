import { fresh, row, types, type Doc, type Kind } from '@/features/documents/model';
import { KEY } from '@/features/workspace/workspace-storage';
import { validIssue } from '@/features/documents/document-status';
import { CATALOG_DATA_KEY, catalogRaw, captureCatalogDocuments, parseCatalogStore } from '@/features/catalogs/catalog-storage';
import { mapStorage, workspaceStorage } from '@/features/workspace/workspace-storage';
export const BACKUP_FORMAT = 'tradekit-lite-backup';
export class DraftConflictError extends Error {
  constructor() { super('另一标签页已更新此草稿。请先备份当前内容，再重新读取，避免覆盖。'); }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const safeImage = (v: unknown) => typeof v === 'string' && (v === '' || /^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=\r\n]+$/i.test(v));
export function decodeDoc(value: unknown, expectedKind?: Kind): Doc {
  if (!object(value) || value.version !== 1 || typeof value.kind !== 'string' || !Object.hasOwn(types, value.kind) || (expectedKind && value.kind !== expectedKind) || !object(value.fields) || !Array.isArray(value.rows)) throw Error('草稿格式不兼容或损坏，原始数据未被覆盖');
  const base = fresh(value.kind as Kind);
  if (value.id !== undefined && (typeof value.id !== 'string' || !/^[a-z\d-]{1,100}$/i.test(value.id))) throw Error('单据标识不正确');
  if (value.status !== undefined && !['draft', 'saved'].includes(String(value.status))) throw Error('单据状态不正确');
  if (!Object.values(value.fields).every(v => typeof v === 'string')) throw Error('草稿字段必须是文本');
  const ids = new Set<string>();
  const rows = value.rows.map((r: unknown) => {
    if (!object(r) || typeof r.name !== 'string' || typeof r.qty !== 'string' || !Object.values(r).every(v => typeof v === 'string')) throw Error('产品明细格式不正确');
    const normalized = { ...row(), ...r } as ReturnType<typeof row>;
    if (!safeImage(normalized.image)) throw Error('产品图片须为本地 PNG/JPEG/WebP/GIF 数据');
    if (!normalized.id || ids.has(normalized.id)) normalized.id = crypto.randomUUID();
    ids.add(normalized.id);
    return normalized;
  });
  if (value.language !== undefined && !['zh', 'en', 'both'].includes(String(value.language))) throw Error('单据语言不正确');
  if (value.theme !== undefined && (typeof value.theme !== 'string' || !/^#[a-f\d]{6}$/i.test(value.theme))) throw Error('主题色格式不正确');
  if (value.layout !== undefined && (typeof value.layout !== 'string' || !/^[a-z]+$/.test(value.layout))) throw Error('模板格式不正确');
  for (const key of ['notes', 'seal', 'logo'] as const) if (value[key] !== undefined && typeof value[key] !== 'string') throw Error('单据内容格式不正确');
  if (!safeImage(value.logo ?? '') || !safeImage(value.seal ?? '')) throw Error('Logo 或签章图片格式不正确');
  const { issued, ...content } = value;
  const result = { ...base, ...content, fields: { ...base.fields, ...value.fields }, rows, kind: value.kind as Kind } as Doc;
  // Missing/invalid status metadata must not prevent an older draft from opening.
  if (validIssue(issued)) result.issued = { via: issued.via, at: issued.at };
  return result;
}
export function draftRaw(kind: Kind, storage: Storage = workspaceStorage()) { return storage.getItem(KEY + 'draft:' + kind); }
export function saveDraft(doc: Doc, expectedRaw: string | null, storage: Storage = workspaceStorage(), options: { syncProducts?: boolean } = {}) {
  const previous = draftRaw(doc.kind, storage);
  if (previous !== expectedRaw) throw new DraftConflictError();
  const next = JSON.stringify(doc);
  if (previous === next && options.syncProducts === false) return next;
  const expectedCatalog = catalogRaw(storage);
  const prior: Doc[] = [];
  if (previous !== null) { try { prior.push(decodeDoc(JSON.parse(previous), doc.kind)); } catch { /* Corrupt originals are archived below. */ } }
  const parsed = parseCatalogStore(expectedCatalog, prior);
  parsed.version = 3;
  const catalog = captureCatalogDocuments(captureCatalogDocuments(parsed, prior, 'current', 'collect'), [doc], 'current', 'latest', options.syncProducts !== false);
  const nextCatalog = JSON.stringify(catalog);
  const updateCatalog = nextCatalog !== expectedCatalog;
  if (previous !== null && previous !== next) {
    let valid = false;
    try { decodeDoc(JSON.parse(previous), doc.kind); valid = true; } catch { /* Retain damaged originals separately. */ }
    storage.setItem(KEY + (valid ? 'draft-previous:' : 'draft-corrupt:') + doc.kind, previous);
  }
  if (catalogRaw(storage) !== expectedCatalog || draftRaw(doc.kind, storage) !== previous) throw new DraftConflictError();
  if (updateCatalog) storage.setItem(KEY + CATALOG_DATA_KEY, nextCatalog);
  try {
    if (draftRaw(doc.kind, storage) !== previous) throw new DraftConflictError();
    if (previous !== next) storage.setItem(KEY + 'draft:' + doc.kind, next);
  } catch (error) {
    if (updateCatalog) {
      try {
        if (catalogRaw(storage) === nextCatalog) {
          if (expectedCatalog === null) storage.removeItem(KEY + CATALOG_DATA_KEY);
          else storage.setItem(KEY + CATALOG_DATA_KEY, expectedCatalog);
        }
      } catch { throw Error(`${error instanceof Error ? error.message : '保存失败'}；资料副本写入无法撤回，请检查资料并下载 JSON 备份。`); }
    }
    throw error;
  }
  return next;
}
export function previousDraft(kind: Kind, storage: Storage = workspaceStorage()) {
  const raw = storage.getItem(KEY + 'draft-previous:' + kind);
  return raw === null ? null : decodeDoc(JSON.parse(raw), kind);
}
export function deleteDraft(kind: Kind, expectedRaw: string, storage: Storage = workspaceStorage()) {
  if (!Object.hasOwn(types, kind)) throw Error('单据类型不正确');
  if (draftRaw(kind, storage) !== expectedRaw) throw new DraftConflictError();
  const document = decodeDoc(JSON.parse(expectedRaw), kind);
  // Legacy records also leave independent copies before their source is removed.
  const expectedCatalog = catalogRaw(storage);
  const parsed = parseCatalogStore(expectedCatalog, [document]);
  if (expectedCatalog === null) parsed.version = 2;
  let copies = captureCatalogDocuments(parsed, [document], 'current', 'collect');
  try {
    const previous = previousDraft(kind, storage);
    if (previous) copies = captureCatalogDocuments(copies, [previous], 'previous');
  } catch { /* Unreadable recovery content cannot supply valid directory records. */ }
  copies.version = 3;
  const nextCatalog = JSON.stringify(copies);
  if (catalogRaw(storage) !== expectedCatalog) throw new DraftConflictError();
  if (nextCatalog !== expectedCatalog && (expectedCatalog !== null || Object.values(copies.records).some(records => records.length)))
    storage.setItem(KEY + CATALOG_DATA_KEY, nextCatalog);
  // Keep the visible record until its local recovery copies have been removed.
  const keys = ['draft-previous:', 'draft-corrupt:', 'draft:'].map(prefix => KEY + prefix + kind);
  const originals = keys.map(key => storage.getItem(key));
  const applied: number[] = [];
  try {
    for (let index = 0; index < keys.length; index++) {
      if (draftRaw(kind, storage) !== expectedRaw || storage.getItem(keys[index]) !== originals[index])
        throw new DraftConflictError();
      if (originals[index] === null) continue;
      storage.removeItem(keys[index]);
      applied.push(index);
    }
  } catch (error) {
    let restored = true;
    for (const index of applied.reverse()) {
      try {
        // Never overwrite a newer copy created in another tab during deletion.
        if (storage.getItem(keys[index]) !== null) { restored = false; continue; }
        storage.setItem(keys[index], originals[index]!);
      } catch { restored = false; }
    }
    throw Error(`${error instanceof Error ? error.message : '浏览器存储不可用'}。${restored ? '已撤回本次删除。' : '部分本地恢复版本无法恢复，请检查单据并使用 JSON 备份。'}`);
  }
}
export function hasPreviousDraft(kind: Kind, storage?: Storage) {
  try { return previousDraft(kind, storage ?? workspaceStorage()) !== null; }
  catch { return false; }
}
export type DraftDeletion = { kind: Kind; expectedRaw: string };
// Run through updateWorkspace so all selections commit in one IndexedDB
// transaction. Staging validates every selection before touching storage.
export function deleteDrafts(records: DraftDeletion[], storage: Storage = workspaceStorage()) {
  if (records.length === 0) return;
  const kinds = new Set<Kind>();
  for (const { kind, expectedRaw } of records) {
    if (!Object.hasOwn(types, kind) || kinds.has(kind)) throw Error('删除列表含有重复或不支持的单据类型');
    kinds.add(kind);
    if (draftRaw(kind, storage) !== expectedRaw) throw new DraftConflictError();
    decodeDoc(JSON.parse(expectedRaw), kind);
  }
  const keys = [KEY + CATALOG_DATA_KEY, ...records.flatMap(({ kind }) =>
    ['draft-previous:', 'draft-corrupt:', 'draft:'].map(prefix => KEY + prefix + kind))];
  const originals = new Map(keys.map(key => [key, storage.getItem(key)]));
  const staged = new Map<string, string>();
  for (const [key, value] of originals) if (value !== null) staged.set(key, value);
  const legacyRaw = staged.get(KEY + CATALOG_DATA_KEY) ?? null;
  const legacy = parseCatalogStore(legacyRaw);
  if (legacyRaw === null || legacy.version < 3) {
    legacy.version = 2;
    const documents = records.map(({ kind, expectedRaw }) => decodeDoc(JSON.parse(expectedRaw), kind));
    const previous: Doc[] = [];
    for (const { kind } of records) {
      try { const doc = previousDraft(kind, storage); if (doc) previous.push(doc); } catch { /* Preserve unreadable recovery content. */ }
    }
    const copies = captureCatalogDocuments(captureCatalogDocuments(legacy, documents, 'current', 'collect'), previous, 'previous');
    copies.version = 3;
    staged.set(KEY + CATALOG_DATA_KEY, JSON.stringify(copies));
  }
  for (const { kind, expectedRaw } of records) deleteDraft(kind, expectedRaw, mapStorage(staged, true));
  const target = (key: string) => staged.get(key) ?? null;
  const applied: string[] = [];
  try {
    for (const key of keys) {
      if (storage.getItem(key) !== originals.get(key)) throw new DraftConflictError();
      const value = target(key);
      if (value === originals.get(key)) continue;
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
      applied.push(key);
    }
    if (keys.some(key => storage.getItem(key) !== target(key))) throw new DraftConflictError();
  } catch (error) {
    let restored = true;
    for (const key of applied.reverse()) {
      try {
        // The legacy-storage fallback must never overwrite a newer external edit.
        if (storage.getItem(key) !== target(key)) { restored = false; continue; }
        const original = originals.get(key)!;
        if (original === null) storage.removeItem(key); else storage.setItem(key, original);
      } catch { restored = false; }
    }
    throw Error(`${error instanceof Error ? error.message : '浏览器存储不可用'}。${restored ? '已撤回本次批量删除。' : '部分资料无法恢复，请检查单据并使用 JSON 备份。'}`);
  }
}
export function serializeBackup(doc: Doc) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, savedAt: new Date().toISOString(), document: doc }, null, 2);
}
export function parseBackup(text: string) {
  if (new TextEncoder().encode(text).length > 20_000_000) throw Error('备份不能超过 20 MB');
  const data: unknown = JSON.parse(text);
  if (object(data) && data.format === BACKUP_FORMAT) {
    if (data.version !== 1) throw Error('备份版本不兼容');
    return decodeDoc(data.document);
  }
  return decodeDoc(data);
}

export function loadDoc(
  kind: Kind,
  storage: Storage = workspaceStorage(),
): Doc | null {
  const raw = storage.getItem(KEY + "draft:" + kind);
  if (!raw) return null;
  return decodeDoc(JSON.parse(raw), kind);
}
