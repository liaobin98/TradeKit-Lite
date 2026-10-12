import { buyerFields, sellerFields } from '@/features/documents/reference-model';
import { types, type Doc, type Kind, type Row } from '@/features/documents/model';
import type { CatalogRoute } from '@/app/navigation';
import { catalogIdentity } from '@/features/catalogs/catalog-identity';

export type CatalogField = { key: string; label: string; value: string };
export type CatalogSource = {
  documentId?: string;
  kind: Kind;
  number: string;
  date: string;
  rowNumber?: number;
  details: CatalogField[];
  version: 'current' | 'previous';
  logo: string;
  row?: Row;
  currency?: string;
};
export type CatalogRecord = {
  id: string;
  category: CatalogRoute;
  title: string;
  fields: CatalogField[];
  images: string[];
  sources: CatalogSource[];
};

export const catalogLabels: Record<CatalogRoute, string> = { sellers: '卖方', buyers: '买方', products: '产品' };
export const productFields = [
  ['name', '中文名称'], ['nameEn', '英文名称'], ['code', '产品编码 / SKU'], ['spec', '规格'],
  ['unit', '单位'], ['hs', 'HS 编码'], ['origin', '原产国'], ['elements', '申报要素'],
] as const;
const productSourceFields = [
  ['qty', '数量'], ['price', '单价'], ['packing', '包装'], ['cartons', '箱数'],
  ['net', '净重'], ['gross', '毛重'], ['volume', '体积'],
] as const;
const text = (value: string | undefined) => (value ?? '').trim().replace(/\r\n/g, '\n');
export function catalogPartyId(category: 'sellers' | 'buyers', fields: CatalogField[]) {
  const company = text(fields.find(field => field.key === (category === 'sellers' ? 'seller' : 'buyer'))?.value);
  // Unnamed partial records are not the same company merely because names are blank.
  return catalogIdentity(JSON.stringify(company ? [category, 'company', company] : [category, ...fields.map(field => text(field.value))]));
}
export function catalogProductId(fields: CatalogField[]) {
  return catalogIdentity(JSON.stringify(['products', 'sku', text(fields.find(field => field.key === 'code')?.value)]));
}
export function samePartyInformation(left: CatalogRecord, right: CatalogRecord) {
  return left.fields.every((field, index) => field.value === right.fields[index]?.value) &&
    JSON.stringify(left.images) === JSON.stringify(right.images);
}
function source(doc: Doc, version: CatalogSource['version']): CatalogSource {
  return { ...(doc.id ? { documentId: doc.id } : {}), kind: doc.kind, number: text(doc.fields.number), date: text(doc.fields.date), details: [], version, logo: doc.logo };
}
function addRecord(records: Map<string, CatalogRecord>, record: CatalogRecord) {
  const existing = records.get(record.id);
  if (!existing) { records.set(record.id, record); return; }
  if (!samePartyInformation(existing, record)) {
    if (record.category === 'products') record.sources.push(...existing.sources);
    records.set(record.id, record); return;
  }
  existing.sources.push(...record.sources);
  for (const image of record.images) if (!existing.images.includes(image)) existing.images.push(image);
}
function hasProduct(row: Row) {
  // Keep unfinished rows in the draft, not in the reusable product directory.
  return Boolean((text(row.name) || text(row.nameEn)) && text(row.code));
}

// Extract detached snapshots for the independently persisted directories and suggestions.
export function buildFormCatalog(documents: Doc[], category: CatalogRoute, version: CatalogSource['version'] = 'current'): CatalogRecord[] {
  const records = new Map<string, CatalogRecord>();
  for (const doc of documents) {
    if (category !== 'products') {
      const definitions = category === 'sellers' ? sellerFields : buyerFields;
      const fields = definitions.map(([key, label]) => ({ key, label, value: text(doc.fields[key]) }));
      if (!fields.some(field => field.value)) continue;
      const id = catalogPartyId(category, fields);
      addRecord(records, {
        id, category, title: fields[0].value || '未填写公司名称', fields,
        images: category === 'sellers' && doc.logo ? [doc.logo] : [], sources: [source(doc, version)],
      });
    } else {
      doc.rows.forEach((row, index) => {
        if (!hasProduct(row)) return;
        const fields = productFields.map(([key, label]) => ({ key, label, value: text(row[key]) }));
        const id = catalogProductId(fields);
        const reference = source(doc, version);
        reference.rowNumber = index + 1;
        reference.row = { ...row };
        reference.currency = text(doc.fields.currency);
        reference.details = [
          ...productSourceFields.map(([key, label]) => ({ key, label, value: text(row[key]) })),
          { key: 'currency', label: '币种', value: text(doc.fields.currency) },
        ];
        addRecord(records, {
          id, category, title: text(row.name) || text(row.nameEn) || text(row.code) || '未填写产品名称', fields,
          images: row.image ? [row.image] : [], sources: [reference],
        });
      });
    }
  }
  return [...records.values()];
}

export function catalogValue(record: CatalogRecord, key: string) {
  return record.fields.find(field => field.key === key)?.value ?? '';
}
export function catalogSourceCount(record: CatalogRecord) {
  return new Set(record.sources.map(source => source.documentId ?? JSON.stringify([source.kind, source.number, source.date]))).size;
}
// A matching type/number alone could now refer to a replacement document.
// Offer opening only while the actual copied party/product snapshot still matches.
export function catalogSourceAvailable(record: CatalogRecord, source: CatalogSource, documents: Doc[]) {
  const sameRow = (left: Row | undefined, right: Row | undefined) => {
    if (!left || !right) return left === right;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].filter(key => key !== 'id').every(key => left[key as keyof Row] === right[key as keyof Row]);
  };
  return buildFormCatalog(documents.filter(doc => doc.kind === source.kind && (!source.documentId || doc.id === source.documentId)), record.category)
    .some(current => (record.category === 'products' ? catalogProductId(current.fields) === catalogProductId(record.fields) : current.id === record.id && samePartyInformation(current, record)) && current.sources.some(candidate =>
      candidate.number === source.number && candidate.date === source.date && candidate.logo === source.logo &&
      candidate.currency === source.currency && candidate.rowNumber === source.rowNumber && sameRow(candidate.row, source.row)));
}
export function catalogSourceDocumentId(record: CatalogRecord, source: CatalogSource, documents: Doc[]) {
  return documents.find(doc => catalogSourceAvailable(record, source, [doc]))?.id;
}
export function searchFormCatalog(records: CatalogRecord[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return records;
  return records.filter(record => [record.title, ...record.fields.map(field => field.value),
    ...record.sources.flatMap(source => [source.number, types[source.kind][0], ...source.details.map(field => field.value)]),
  ].some(value => value.toLocaleLowerCase().includes(needle)));
}
