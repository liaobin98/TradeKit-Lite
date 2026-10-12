import { types, type Kind } from '@/features/documents/model';

export function documentKind(hash: string): Kind | null {
  const match = /^#\/documents\/([a-z]+)(?:\/[a-z\d-]{1,100})?\/?$/i.exec(hash);
  const kind = match?.[1].toUpperCase();
  return kind && Object.hasOwn(types, kind) ? kind as Kind : null;
}

export const catalogRoutes = ['sellers', 'buyers', 'products'] as const;
export type CatalogRoute = typeof catalogRoutes[number];
export type DocumentRecordRoute = `document:${Kind}:${string}`;
export type DocumentNumberRoute = `number:${Kind}:${string}`;
export type DocumentRoute = Kind | DocumentRecordRoute | DocumentNumberRoute | 'documents' | CatalogRoute | null;

export const recordRoute = (kind: Kind, id: string): DocumentRecordRoute => `document:${kind}:${id}`;
export const numberRoute = (kind: Kind, number: string): DocumentNumberRoute => `number:${kind}:${encodeURIComponent(number)}`;
export function routeKind(route: DocumentRoute): Kind | null {
  if (route && Object.hasOwn(types, route)) return route as Kind;
  const match = route && /^(?:document:([A-Z]+):[a-z\d-]{1,100}|number:([A-Z]+):[^\s]*)$/i.exec(route);
  const kind = match && (match[1] || match[2]);
  return kind && Object.hasOwn(types, kind) ? kind as Kind : null;
}
export function routeDocumentId(route: DocumentRoute): string | null {
  return routeKind(route) && route?.startsWith('document:') ? route.split(':')[2] : null;
}
export function routeDocumentNumber(route: DocumentRoute): string | null {
  if (!routeKind(route) || !route?.startsWith('number:')) return null;
  try { return decodeURIComponent(route.split(':')[2]); } catch { return null; }
}

export function isCatalogRoute(route: unknown): route is CatalogRoute {
  return catalogRoutes.some(value => value === route);
}

function isDirectoryRoute(route: unknown) {
  return route === 'documents' || isCatalogRoute(route);
}

export function documentRoute(hash: string): DocumentRoute {
  const match = /^#\/(sellers|buyers|products)\/?$/i.exec(hash);
  if (match) return match[1].toLowerCase() as CatalogRoute;
  const kind = documentKind(hash), id = /^#\/documents\/[a-z]+\/([a-z\d-]{1,100})\/?$/i.exec(hash)?.[1];
  return /^#\/documents\/?$/i.test(hash) ? 'documents' : kind && id ? recordRoute(kind, id) : kind;
}

export function documentHash(kind: DocumentRoute) {
  if (kind === null) return '#/';
  const number = routeDocumentNumber(kind);
  if (number !== null) return `#/documents/${routeKind(kind)!.toLowerCase()}/${encodeURIComponent(number)}`;
  const id = routeDocumentId(kind);
  if (id) return `#/documents/${routeKind(kind)!.toLowerCase()}/${id}`;
  return isDirectoryRoute(kind) ? `#/${kind}` : `#/documents/${kind.toLowerCase()}`;
}

type RouteEntry = { index: number; kind: DocumentRoute; from: DocumentRoute; hash?: string };
type ChangeRoute = (kind: DocumentRoute) => Promise<boolean>;
export type NavigationCodec = { parse: (hash: string) => DocumentRoute; hash: (route: DocumentRoute) => string };
const STATE_KEY = 'tradekitNavigation';

export interface NavigationBrowser {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'state' | 'pushState' | 'replaceState' | 'go'>;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

function readEntry(browser: NavigationBrowser, codec: NavigationCodec): RouteEntry | null {
  const entry = browser.history.state?.[STATE_KEY];
  if (!entry || !Number.isSafeInteger(entry.index) || entry.index < 0 ||
    (entry.hash !== browser.location.hash && entry.kind !== codec.parse(browser.location.hash)) ||
    (entry.kind !== null && !isDirectoryRoute(entry.kind) && !routeKind(entry.kind)) ||
    (entry.from !== null && !isDirectoryRoute(entry.from) && !routeKind(entry.from))) return null;
  return entry;
}

export function createDocumentNavigation(browser: NavigationBrowser, change: ChangeRoute, codec: NavigationCodec = { parse: documentRoute, hash: documentHash }) {
  let current: RouteEntry = { index: 0, kind: null, from: null };
  let changing = false;
  let disposed = false;
  let reverting: number | null = null;
  let ready = false;
  let replacement: DocumentRoute | undefined;
  const url = (kind: DocumentRoute) => browser.location.pathname + browser.location.search + codec.hash(kind);
  const state = (entry: RouteEntry) => ({ ...browser.history.state, [STATE_KEY]: { ...entry, hash: codec.hash(entry.kind) } });
  function replace(kind: DocumentRoute) {
    if (disposed) return;
    if (changing) { replacement = kind; return; }
    current = { ...current, kind };
    browser.history.replaceState(state(current), '', url(kind));
  }
  function finishReplacement(accepted: boolean) {
    const next = replacement; replacement = undefined;
    if (accepted && next !== undefined) replace(next);
  }

  async function traverse() {
    if (disposed || changing) return;
    let target = readEntry(browser, codec);
    if (target && browser.location.hash !== codec.hash(target.kind)) {
      browser.history.replaceState(state(target), '', url(target.kind));
    }
    if (reverting !== null) {
      if (target?.index === reverting) reverting = null;
      return;
    }
    if (!target) {
      target = { index: current.index + 1, kind: codec.parse(browser.location.hash), from: current.kind };
      browser.history.replaceState(state(target), '', url(target.kind));
    }
    if (ready && target.index === current.index && target.kind === current.kind) return;
    const initializing = !ready;
    changing = true;
    let accepted = false;
    try { accepted = await change(target.kind); }
    finally {
      changing = false;
      if (disposed) return;
      ready = true;
      if (accepted) current = target;
      else {
        if (initializing && current.kind !== null) current = { ...current, kind: null, from: null };
        const actual = readEntry(browser, codec);
        const delta = current.index - (actual?.index ?? target.index);
        if (delta) { reverting = current.index; browser.history.go(delta); }
        else browser.history.replaceState(state(current), '', url(current.kind));
      }
      finishReplacement(accepted);
      // A second browser traversal may have arrived while a confirmation was open.
      if (accepted && readEntry(browser, codec)?.index !== current.index) void traverse();
    }
  }

  function start() {
    const existing = readEntry(browser, codec);
    if (existing) current = existing;
    else {
      const initialKind = codec.parse(browser.location.hash);
      browser.history.replaceState(state(current), '', url(null));
      // A direct form link also gets an in-site home entry, without adding one on refresh.
      if (initialKind) {
        const entry = { index: 1, kind: initialKind, from: null };
        browser.history.pushState(state(entry), '', url(initialKind));
      }
    }
    browser.addEventListener('popstate', traverse);
    browser.addEventListener('hashchange', traverse);
    return traverse();
  }

  async function navigate(kind: DocumentRoute) {
    if (disposed || changing || reverting !== null || kind === current.kind) return false;
    changing = true;
    let accepted = false;
    try {
      if (!await change(kind) || disposed) return false;
      const entry = { index: current.index + 1, kind, from: current.kind };
      browser.history.pushState(state(entry), '', url(kind));
      current = entry;
      ready = true;
      accepted = true;
      return true;
    } finally { changing = false; finishReplacement(accepted); }
  }

  function home() {
    if (disposed || changing || reverting !== null) return;
    if (current.kind !== null && current.index > 0 && current.from === null) browser.history.go(-1);
    else void navigate(null);
  }

  function back() {
    if (disposed || changing || reverting !== null) return;
    if (current.kind !== null && !isDirectoryRoute(current.kind) && isDirectoryRoute(current.from)) browser.history.go(-1);
    else home();
  }

  return {
    start, navigate, home, back,
    replace,
    dispose() {
      disposed = true;
      browser.removeEventListener('popstate', traverse);
      browser.removeEventListener('hashchange', traverse);
    },
  };
}
