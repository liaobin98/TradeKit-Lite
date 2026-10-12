import { useEffect, useLayoutEffect, useRef } from 'react';
import { createDocumentNavigation, recordRoute, type CatalogRoute, type DocumentRoute } from '@/app/navigation';
import { type Doc, type Kind } from '@/features/documents/model';
import { documentLinkCodec } from '@/features/documents/document-links';
import { documentRecords } from '@/features/documents/documents-store';

export function useDocumentNavigation(change: (kind: DocumentRoute) => Promise<boolean>, document: Doc | null = null) {
  const changeRef = useRef(change);
  const navigation = useRef<ReturnType<typeof createDocumentNavigation> | null>(null);
  const documentRef = useRef(document);
  useLayoutEffect(() => { changeRef.current = change; documentRef.current = document; });
  useEffect(() => {
    const codec = documentLinkCodec(() => documentRecords().map(entry => entry.document), () => documentRef.current);
    const controller = createDocumentNavigation(window, kind => changeRef.current(kind), codec);
    navigation.current = controller;
    void controller.start();
    return () => { controller.dispose(); navigation.current = null; };
  }, []);
  return {
    open: (kind: Kind, id?: string) => navigation.current?.navigate(id ? recordRoute(kind, id) : kind),
    replaceDocument: (kind: Kind, id: string) => navigation.current?.replace(recordRoute(kind, id)),
    documents: () => navigation.current?.navigate('documents'),
    catalog: (route: CatalogRoute) => navigation.current?.navigate(route),
    home: () => navigation.current?.home(),
    back: () => navigation.current?.back(),
  };
}
