import { fresh, type Doc, type Kind } from '@/features/documents/model';

// Generated metadata and remembered trade defaults are not user-entered
// content. Compare them with this editing session's blank, not today's fresh().
const defaultFields = new Set(['number', 'date', 'currency', 'incoterm', 'payment', 'delivery', 'discount']);
export function hasDocumentContent(document: Doc, blank: Doc): boolean {
  if ([document.notes, document.logo, document.seal].some(value => value.trim())) return true;
  if (Object.entries(document.fields).some(([key, value]) => value.trim() &&
    (!defaultFields.has(key) || value.trim() !== (blank.fields[key] ?? '').trim()))) return true;
  return document.rows.some(product => Object.entries(product).some(([key, value]) => {
    if (key === 'id' || !value.trim()) return false;
    if (key === 'unit') return value.trim() !== (blank.rows[0]?.unit ?? '件 / PCS').trim();
    if (key === 'cartons') return value.trim() !== '0';
    return true;
  }));
}

export function createBlankDocument(kind: Kind, defaults: Pick<Doc, 'language' | 'theme' | 'layout' | 'fields'>): Doc {
  const document = fresh(kind);
  return {
    ...document,
    language: defaults.language,
    theme: defaults.theme,
    layout: defaults.layout,
    fields: {
      ...document.fields,
      ...Object.fromEntries(['currency', 'incoterm', 'payment', 'delivery'].map(key => [key, defaults.fields[key] ?? document.fields[key]])),
    },
  };
}
