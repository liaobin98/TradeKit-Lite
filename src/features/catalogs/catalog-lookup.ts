import { type CatalogRecord, type CatalogSource } from '@/features/catalogs/form-catalog';
import { type Doc } from '@/features/documents/model';
import type { CatalogRoute } from '@/app/navigation';
import { readSavedCatalogs } from '@/features/catalogs/catalog-sync';
import { workspaceStorage } from '@/features/workspace/workspace-storage';

export type CatalogSelection = { record: CatalogRecord; source: CatalogSource };

export function mergeLookupCatalog(...collections: CatalogRecord[][]): CatalogRecord[] {
  const records = new Map<string, CatalogRecord>();
  const key = (source: CatalogSource) => JSON.stringify([source.documentId, source.kind, source.number, source.date, source.version, source.rowNumber, source.logo, source.row?.image, ...source.details.map(field => field.value)]);
  for (const collection of collections) for (const record of collection) {
    const existing = records.get(record.id);
    if (!existing) { records.set(record.id, { ...record, sources: [...record.sources], images: [...record.images] }); continue; }
    const keys = new Set(existing.sources.map(key));
    for (const source of record.sources) if (!keys.has(key(source))) { existing.sources.push(source); keys.add(key(source)); }
    for (const image of record.images) if (!existing.images.includes(image)) existing.images.push(image);
  }
  return [...records.values()];
}

export function readLookupCatalog(category: CatalogRoute, storage: Storage = workspaceStorage()) {
  return readSavedCatalogs(storage).store.records[category];
}

export function catalogSelections(records: CatalogRecord[]): CatalogSelection[] {
  const choices: CatalogSelection[] = [];
  for (const record of records) {
    if (record.category !== 'products') { if (record.sources[0]) choices.push({ record, source: record.sources[0] }); continue; }
    const variants: CatalogSource[] = [];
    for (const source of record.sources) {
      if (!source.row || variants.some(other => other.row?.price === source.row?.price && other.currency === source.currency && other.row?.image === source.row?.image)) continue;
      variants.push(source); choices.push({ record, source });
    }
  }
  return choices;
}

export function applyCatalogSelection(doc: Doc, selection: CatalogSelection, rowId?: string): { document: Doc; warning: string } {
  const { record, source } = selection;
  if (record.category !== 'products') {
    const fields = Object.fromEntries(record.fields.map(field => [field.key, field.value]));
    return {
      document: { ...doc, fields: { ...doc.fields, ...fields }, ...(record.category === 'sellers' ? { logo: source.logo } : {}) },
      warning: '',
    };
  }
  if (!rowId || !source.row || !doc.rows.some(row => row.id === rowId)) return { document: doc, warning: '该产品行已不存在，请重新选择。' };
  const product = source.row;
  const fields = Object.fromEntries(record.fields.map(field => [field.key, field.value]));
  const matchingCurrency = (source.currency ?? '').toUpperCase() === (doc.fields.currency || 'USD').toUpperCase();
  return {
    document: { ...doc, rows: doc.rows.map(row => row.id === rowId ? {
      ...row, ...fields, image: product.image, price: matchingCurrency ? product.price : '',
    } : row) },
    warning: !matchingCurrency && product.price.trim() ? `来源单价使用 ${source.currency || '未知币种'}，当前单据使用 ${doc.fields.currency || 'USD'}。商品资料已带入，单价请按当前币种填写。` : '',
  };
}
