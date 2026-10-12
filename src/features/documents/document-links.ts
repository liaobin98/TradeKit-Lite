import { documentHash, documentRoute, numberRoute, recordRoute, routeDocumentId, routeKind, type NavigationCodec } from '@/app/navigation';
import { types, type Doc, type Kind } from '@/features/documents/model';

// URLs carry the display number; storage and browser history retain stable IDs.
// Duplicate/missing numbers need an explicit record hint, never an arbitrary
// first-match lookup. No UUID-path compatibility is provided.
export function documentLinkCodec(read: () => Doc[], active: () => Doc | null = () => null): NavigationCodec {
  const documents = () => {
    const current = active();
    return current?.id ? [...read().filter(doc => doc.id !== current.id), current] : read();
  };
  const number = (doc: Doc) => doc.fields.number.trim();
  return {
    hash(route) {
      const id = routeDocumentId(route), kind = routeKind(route);
      if (!id || !kind) return documentHash(route);
      const all = documents(), doc = all.find(doc => doc.id === id && doc.kind === kind);
      if (!doc) return `#/documents/${kind.toLowerCase()}/_?record=${encodeURIComponent(id)}`;
      const value = number(doc), duplicate = all.filter(other => other.kind === kind && number(other) === value).length > 1;
      return `#/documents/${kind.toLowerCase()}/${encodeURIComponent(value || '_')}${!value || duplicate ? `?record=${encodeURIComponent(id)}` : ''}`;
    },
    parse(hash) {
      const match = /^#\/documents\/([a-z]+)\/([^/?]+)\/?(?:\?record=([a-z\d-]{1,100}))?$/i.exec(hash);
      if (!match) return /^#\/documents\/[a-z]+\/?$/i.test(hash) || !hash.startsWith('#/documents/') ? documentRoute(hash) : null;
      const kind = match[1].toUpperCase() as Kind;
      if (!Object.hasOwn(types, kind)) return null;
      let value: string;
      try { value = decodeURIComponent(match[2]).trim(); } catch { return null; }
      if (!value || value.length > 10000 || /[\x00-\x1f\x7f]/.test(value)) return null;
      const all = documents().filter(doc => doc.kind === kind);
      if (match[3]) {
        const doc = all.find(doc => doc.id === match[3] && (number(doc) || '_') === value);
        return doc?.id ? recordRoute(kind, doc.id) : numberRoute(kind, value);
      }
      const matches = all.filter(doc => number(doc) === value);
      return matches.length === 1 && matches[0].id ? recordRoute(kind, matches[0].id) : numberRoute(kind, value);
    },
  };
}
