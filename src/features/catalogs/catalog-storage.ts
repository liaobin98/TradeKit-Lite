import { KEY } from '@/features/workspace/workspace-storage';
import { types, type Doc } from '@/features/documents/model';
import type { CatalogRoute } from '@/app/navigation';
import { buildFormCatalog, catalogPartyId, catalogProductId, samePartyInformation, productFields, type CatalogRecord } from '@/features/catalogs/form-catalog';
import { sellerFields, buyerFields } from '@/features/documents/reference-model';
import { workspaceStorage, isWorkspaceSnapshot } from '@/features/workspace/workspace-storage';
import { catalogIdentity } from '@/features/catalogs/catalog-identity';

export const CATALOG_DATA_KEY = 'catalogs';
export const catalogCategories = ['sellers', 'buyers', 'products'] as const;
export type CatalogStore = {
  version: 2 | 3;
  records: Record<CatalogRoute, CatalogRecord[]>;
  deleted: Record<CatalogRoute, string[]>;
};
export function emptyCatalogStore(): CatalogStore {
  return { version: 3, records: { sellers: [], buyers: [], products: [] }, deleted: { sellers: [], buyers: [], products: [] } };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const image = (value: unknown) => typeof value === 'string' && (value === '' || /^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=\r\n]+$/i.test(value));
const fields = (value: unknown) => Array.isArray(value) && value.every(field => object(field) && ['key', 'label', 'value'].every(key => typeof field[key] === 'string'));
const sourceKey = ({ version: _version, ...source }: CatalogRecord['sources'][number]) => JSON.stringify({ ...source,
  ...(source.row ? { row: Object.fromEntries(Object.entries(source.row).filter(([key]) => key !== 'id')) } : {}) });

// Imported copies never execute data or load remote images. Invalid stores are retained, not reset.
export function parseCatalogStore(raw: string | null, currentDocuments: Doc[] = []): CatalogStore {
  if (raw === null) return emptyCatalogStore();
  const value: unknown = JSON.parse(raw);
  if (!object(value) || ![1, 2, 3].includes(Number(value.version)) || typeof value.version !== 'number' || !object(value.records) || !object(value.deleted)) throw Error('独立资料副本格式不正确，原始内容未覆盖。');
  for (const category of catalogCategories) {
    const records = value.records[category], deleted = value.deleted[category];
    if (!Array.isArray(records) || !Array.isArray(deleted) || !deleted.every(id => typeof id === 'string' && id.length > 0)) throw Error('资料列表格式不正确。');
    // Upgrade early local snapshots without keeping readable identities in tombstones.
    value.deleted[category] = deleted.map(catalogIdentity);
    const ids = new Set<string>();
    for (const record of records) {
      if (object(record) && typeof record.id === 'string' && record.id) record.id = catalogIdentity(record.id);
      if (!object(record) || record.category !== category || typeof record.id !== 'string' || !record.id || ids.has(record.id) || (value.deleted[category] as string[]).includes(record.id) ||
          typeof record.title !== 'string' || !fields(record.fields) || !Array.isArray(record.images) || !record.images.every(image) ||
          !Array.isArray(record.sources) || !record.sources.length) throw Error('独立资料内容损坏，原始内容未覆盖。');
      ids.add(record.id);
      const definitions = category === 'sellers' ? sellerFields : category === 'buyers' ? buyerFields : productFields;
      if ((record.fields as { key: string }[]).length !== definitions.length ||
          !(record.fields as { key: string }[]).every((field, index) => field.key === definitions[index][0])) throw Error('资料包含不支持的字段。');
      for (const source of record.sources) {
        if (!object(source) || typeof source.kind !== 'string' || !Object.hasOwn(types, source.kind) ||
            typeof source.number !== 'string' || typeof source.date !== 'string' || !fields(source.details) || !image(source.logo) ||
            source.documentId !== undefined && (typeof source.documentId !== 'string' || !/^[a-z\d-]{1,100}$/i.test(source.documentId)) ||
            !['current', 'previous'].includes(String(source.version)) || source.currency !== undefined && typeof source.currency !== 'string' ||
            source.rowNumber !== undefined && (!Number.isSafeInteger(source.rowNumber) || Number(source.rowNumber) < 1)) throw Error('资料来源格式不正确。');
        if (source.row !== undefined && (!object(source.row) || !Object.values(source.row).every(item => typeof item === 'string') ||
            !['id', 'name', 'qty', 'price', 'image'].every(key => typeof (source.row as Record<string, unknown>)[key] === 'string') || !image(source.row.image))) throw Error('产品副本格式不正确。');
        if (category === 'products' && !source.row) throw Error('产品副本缺少产品内容。');
      }
    }
  }
  const store = value as unknown as CatalogStore;
  if (value.version === 1) {
    // V1 appended identities, but did not record save times. Use the last
    // collected variant, preferring its source's current contents when available
    // (including a later edit that reverted to an earlier collected variant).
    for (const category of ['sellers', 'buyers'] as const) {
      const records = new Map<string, CatalogRecord>();
      for (const record of store.records[category]) {
        record.id = catalogPartyId(category, record.fields);
        record.sources = [record.sources[0]];
        record.images = category === 'sellers' && record.sources[0].logo ? [record.sources[0].logo] : [];
        if (!store.deleted[category].includes(record.id)) records.set(record.id, record);
      }
      for (const [id, record] of records) {
        const source = record.sources[0];
        const current = buildFormCatalog(currentDocuments.filter(doc => doc.kind === source.kind &&
          doc.fields.number.trim() === source.number && doc.fields.date.trim() === source.date), category).find(candidate => candidate.id === id);
        if (current) {
          const legacyId = catalogIdentity(JSON.stringify([category, ...current.fields.map(field => field.value)]));
          if (!store.deleted[category].includes(legacyId)) records.set(id, current);
        }
      }
      store.records[category] = [...records.values()];
    }
    store.version = 2;
  } else {
    for (const category of ['sellers', 'buyers'] as const) {
      if (store.records[category].some(record => record.id !== catalogPartyId(category, record.fields))) throw Error('公司资料标识不正确。');
    }
  }
  return store;
}

export function captureCatalogDocuments(store: CatalogStore, documents: Doc[], version: 'current' | 'previous' = 'current', mode: 'latest' | 'collect' = version === 'current' ? 'latest' : 'collect', syncProducts = true, categories: readonly CatalogRoute[] = catalogCategories): CatalogStore {
  const next = structuredClone(store);
  for (const category of categories) {
    // V3 products are confirmed snapshots, never reconstructed from autosaves,
    // directory reads, recovery versions or deletion of a source document.
    if (category === 'products' && (!syncProducts || mode === 'collect' && store.version === 3)) continue;
    // Re-reading an identical current/recovery source is not a new transaction
    // variant. Preserve every genuinely different price, quantity and image.
    for (const record of next.records[category]) {
      const seen = new Set<string>();
      record.sources = record.sources.filter(source => {
        const key = sourceKey(source);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    }
    const records = new Map(next.records[category].map(record => [record.id, record]));
    const deleted = new Set(next.deleted[category]);
    for (const record of buildFormCatalog(documents, category, version)) {
      if (deleted.has(record.id)) continue;
      let existing = records.get(record.id);
      if (category === 'products') {
        const legacyId = catalogIdentity(JSON.stringify([category, ...record.fields.map(field => field.value)]));
        if (deleted.has(legacyId)) {
          if (!existing) { deleted.add(record.id); next.deleted.products.push(record.id); }
          continue;
        }
        // Keep pre-existing duplicate copies intact. An explicit save updates
        // one matching copy in place rather than adding yet another SKU entry.
        existing ??= [...records.values()].reverse().find(candidate => catalogProductId(candidate.fields) === record.id);
        if (existing && mode === 'collect') continue;
        if (existing && !samePartyInformation(existing, record)) {
          records.set(existing.id, { ...record, id: existing.id }); continue;
        }
      }
      if (category !== 'products') {
        // Retain V1 deletion markers; convert a recognized deleted company when
        // its legacy document is encountered, without resurrecting old variants.
        const legacyId = catalogIdentity(JSON.stringify([category, ...record.fields.map(field => field.value)]));
        if (deleted.has(legacyId)) {
          if (!existing) { deleted.add(record.id); next.deleted[category].push(record.id); }
          continue;
        }
        // Routine reads/deletions collect missing names only. They must never
        // replace the latest saved company with an older current/recovery draft.
        if (existing && mode === 'collect') continue;
        if (existing && !samePartyInformation(existing, record)) { records.set(record.id, record); continue; }
      }
      if (!existing) { records.set(record.id, record); continue; }
      const sourceKeys = new Set(existing.sources.map(sourceKey));
      for (const source of record.sources) if (!sourceKeys.has(sourceKey(source))) {
        if (version === 'current') existing.sources.unshift(source); else existing.sources.push(source);
        sourceKeys.add(sourceKey(source));
      }
      for (const picture of record.images) if (!existing.images.includes(picture)) existing.images.push(picture);
    }
    next.records[category] = [...records.values()];
  }
  return next;
}

export function catalogRaw(storage: Storage = workspaceStorage()) { return storage.getItem(KEY + CATALOG_DATA_KEY); }
export function writeCatalogStore(next: CatalogStore, expectedRaw: string | null, storage: Storage = workspaceStorage()) {
  // Render-time lookup projects the committed data; durable collection happens
  // during startup or the next explicit save transaction, never during render.
  if (isWorkspaceSnapshot(storage)) return;
  const raw = JSON.stringify(next);
  if (catalogRaw(storage) !== expectedRaw) throw Error('另一标签页已更新资料，请刷新列表后重试。');
  if (raw !== expectedRaw && (expectedRaw !== null || catalogCategories.some(category => next.records[category].length || next.deleted[category].length)))
    storage.setItem(KEY + CATALOG_DATA_KEY, raw);
}
export function deleteCatalogRecords(category: CatalogRoute, ids: readonly string[], expectedRaw: string, storage: Storage = workspaceStorage()) {
  if (!ids.length) return;
  if (isWorkspaceSnapshot(storage)) throw Error('请通过事务删除资料。');
  if (catalogRaw(storage) !== expectedRaw) throw Error('另一标签页已更新资料，请刷新列表后重试。');
  const store = parseCatalogStore(expectedRaw), selected = new Set(ids);
  if ([...selected].some(id => !store.records[category].some(record => record.id === id))) throw Error('所选资料已发生变化，请刷新列表后重试。');
  const productIds = category === 'products' ? store.records.products.filter(record => selected.has(record.id) && record.fields.some(field => field.key === 'code' && field.value.trim())).map(record => catalogProductId(record.fields)).filter(id => !store.records.products.some(record => !selected.has(record.id) && record.id === id)) : [];
  store.records[category] = store.records[category].filter(record => !selected.has(record.id));
  store.deleted[category] = [...new Set([...store.deleted[category], ...selected, ...productIds])];
  writeCatalogStore(store, expectedRaw, storage);
}
