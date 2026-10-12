import { describe, expect, it } from 'vitest';
import { catalogRoutes, createDocumentNavigation, documentHash, documentKind, documentRoute, recordRoute, routeKind, routeDocumentId, type DocumentRoute, type NavigationBrowser } from '@/app/navigation';
import { types, type Kind } from '@/features/documents/model';
import { documentLinkCodec } from '@/features/documents/document-links';
import { newDocument } from '@/features/documents/documents-store';

function browser(hash = '', search = '?workspace=local') {
  const entries: { state: any; url: string }[] = [{ state: null, url: `/tools${search}${hash}` }];
  let position = 0;
  const listeners = new Map<string, Set<() => void>>();
  const location = { pathname: '/tools', search, hash };
  function update() {
    const url = new URL(entries[position].url, 'http://localhost');
    Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash });
  }
  const emit = (type: string) => { for (const listener of listeners.get(type) ?? []) listener(); };
  const api: NavigationBrowser = {
    location,
    history: {
      get state() { return entries[position].state; },
      pushState(state, _title, url) {
        entries.splice(position + 1);
        entries.push({ state, url: String(url) }); position++; update();
      },
      replaceState(state, _title, url) { entries[position] = { state, url: String(url) }; update(); },
      go(delta = 0) {
        const next = position + delta;
        if (next < 0 || next >= entries.length) return;
        position = next; update(); queueMicrotask(() => emit('popstate'));
      },
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  return {
    api, entries,
    manualHash(hash: string) {
      api.history.pushState(null, '', location.pathname + location.search + hash);
      emit('popstate'); emit('hashchange');
    },
  };
}
async function settled() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

describe('document routes', () => {
  it.each(catalogRoutes)('supports the lowercase %s directory route', route => {
    expect(documentHash(route)).toBe(`#/${route}`);
    expect(documentRoute(`#/${route}`)).toBe(route);
    expect(documentRoute(`#/${route.toUpperCase()}/`)).toBe(route);
  });
  it('gives the saved documents column its own route', () => {
    expect(documentHash('documents')).toBe('#/documents');
    expect(documentRoute('#/documents')).toBe('documents');
    expect(documentRoute('#/documents/')).toBe('documents');
    expect(documentRoute('#/documents/qt')).toBe('QT');
  });
  it.each(Object.keys(types) as Kind[])('round trips the %s form route', kind => {
    expect(documentHash(kind)).toBe(`#/documents/${kind.toLowerCase()}`);
    expect(documentKind(documentHash(kind))).toBe(kind);
  });
  it('supports home and rejects unknown forms without prototype keys', () => {
    expect(documentHash(null)).toBe('#/');
    for (const hash of ['', '#/', '#/documents/nope', '#/documents/__proto__', '#/documents/QT/__proto__']) expect(documentKind(hash)).toBeNull();
    expect(documentKind('#/documents/qt/')).toBe('QT');
  });
  it('round trips independently addressed documents of the same type', () => {
    const first = recordRoute('QT', 'first-document'), second = recordRoute('QT', 'second-document');
    expect(first).not.toBe(second);
    expect(documentHash(first)).toBe('#/documents/qt/first-document');
    expect(documentRoute(documentHash(first))).toBe(first);
    expect(routeKind(first)).toBe('QT'); expect(routeDocumentId(first)).toBe('first-document');
  });
});

describe('document navigation history', () => {
  it('defers a form-to-record replacement until an asynchronous open finishes', async () => {
    const doc = newDocument('QT'), b = browser(), codec = documentLinkCodec(() => [doc]);
    const nav = createDocumentNavigation(b.api, async route => {
      if (route === 'QT') { nav.replace(recordRoute('QT', doc.id!)); await settled(); }
      return true;
    }, codec);
    await nav.start(); await nav.navigate('QT');
    expect(b.entries).toHaveLength(2); expect(b.api.location.hash).toBe('#/documents/qt/' + doc.fields.number);
    nav.home(); await settled(); expect(b.api.location.hash).toBe('#/');
    nav.dispose();
  });
  it('keeps the record ID through number edits, refresh, browser back and forward without adding entries', async () => {
    const doc = newDocument('QT'); doc.fields.number = 'BEFORE';
    const codec = documentLinkCodec(() => [doc]), b = browser(), opened: DocumentRoute[] = [];
    const nav = createDocumentNavigation(b.api, async route => { opened.push(route); return true; }, codec);
    await nav.start(); await nav.navigate('documents'); await nav.navigate(recordRoute('QT', doc.id!));
    const count = b.entries.length;
    doc.fields.number = 'AFTER'; nav.replace(recordRoute('QT', doc.id!));
    expect(b.entries).toHaveLength(count); expect(b.api.location.hash).toBe('#/documents/qt/AFTER');
    b.api.history.go(-1); await settled(); expect(b.api.location.hash).toBe('#/documents');
    b.api.history.go(1); await settled(); expect(opened.at(-1)).toBe(recordRoute('QT', doc.id!));
    nav.dispose();
    const refreshed = createDocumentNavigation(b.api, async route => { opened.push(route); return true; }, codec);
    await refreshed.start(); expect(opened.at(-1)).toBe(recordRoute('QT', doc.id!)); expect(b.entries).toHaveLength(count);
    refreshed.dispose();
  });
  it('canonicalizes a renamed number from an earlier history entry using its original ID', async () => {
    const doc = newDocument('QT'); doc.fields.number = 'BEFORE';
    const codec = documentLinkCodec(() => [doc]), b = browser(), opened: DocumentRoute[] = [];
    const nav = createDocumentNavigation(b.api, async route => { opened.push(route); return true; }, codec);
    await nav.start(); await nav.navigate(recordRoute('QT', doc.id!)); await nav.navigate('documents');
    doc.fields.number = 'AFTER'; b.api.history.go(-1); await settled();
    expect(opened.at(-1)).toBe(recordRoute('QT', doc.id!)); expect(b.api.location.hash).toBe('#/documents/qt/AFTER');
    nav.dispose();
  });
  it('navigates between two same-type records and retains the exact ID on refresh and back', async () => {
    const b = browser(), opened: DocumentRoute[] = [];
    const nav = createDocumentNavigation(b.api, async route => { opened.push(route); return true; });
    await nav.start(); await nav.navigate('documents');
    await nav.navigate(recordRoute('QT', 'first')); await nav.navigate(recordRoute('QT', 'second'));
    expect(opened.slice(-2)).toEqual([recordRoute('QT', 'first'), recordRoute('QT', 'second')]);
    b.api.history.go(-1); await settled();
    expect(b.api.location.hash).toBe('#/documents/qt/first');
    nav.dispose();
    const refreshed = createDocumentNavigation(b.api, async route => { opened.push(route); return true; });
    await refreshed.start(); expect(opened.at(-1)).toBe(recordRoute('QT', 'first'));
    refreshed.dispose();
  });
  it('replaces a newly created form route with its ID without adding a history entry', async () => {
    const b = browser(), nav = createDocumentNavigation(b.api, async () => true);
    await nav.start(); await nav.navigate('QT'); const count = b.entries.length;
    nav.replace(recordRoute('QT', 'new-document'));
    expect(b.entries).toHaveLength(count);
    expect(b.api.location.hash).toBe('#/documents/qt/new-document');
    nav.dispose();
  });
  it.each(catalogRoutes)('returns from a source form to the %s directory', async route => {
    const b = browser(), changes: DocumentRoute[] = [];
    const nav = createDocumentNavigation(b.api, async target => { changes.push(target); return true; });
    await nav.start(); await nav.navigate(route); await nav.navigate('QT');
    nav.back(); await settled();
    expect(b.api.location.hash).toBe(`#/${route}`); expect(changes.at(-1)).toBe(route);
    b.api.history.go(1); await settled(); expect(changes.at(-1)).toBe('QT'); nav.dispose();
  });
  it.each(catalogRoutes)('keeps the %s directory on refresh without adding history', async route => {
    const b = browser(`#/${route}`), first = createDocumentNavigation(b.api, async () => true);
    await first.start(); first.dispose();
    const reloaded = createDocumentNavigation(b.api, async () => true);
    await reloaded.start(); expect(b.entries).toHaveLength(2); expect(b.api.location.hash).toBe(`#/${route}`);
    reloaded.dispose();
  });
  it('returns to the saved documents column after editing a document opened there', async () => {
    const b = browser(), changes: DocumentRoute[] = [];
    const nav = createDocumentNavigation(b.api, async route => { changes.push(route); return true; });
    await nav.start(); await nav.navigate('documents'); await nav.navigate('SC');
    nav.back(); await settled();
    expect(b.api.location.hash).toBe('#/documents'); expect(changes.at(-1)).toBe('documents');
    b.api.history.go(1); await settled(); expect(b.api.location.hash).toBe('#/documents/sc');
    nav.dispose();
  });
  it('opens the column directly and preserves it on reload without duplicating history', async () => {
    const b = browser('#/documents');
    const first = createDocumentNavigation(b.api, async () => true);
    await first.start(); expect(b.entries).toHaveLength(2); first.dispose();
    const changes: DocumentRoute[] = [];
    const reloaded = createDocumentNavigation(b.api, async route => { changes.push(route); return true; });
    await reloaded.start();
    expect(changes).toEqual(['documents']); expect(b.entries).toHaveLength(2);
    reloaded.home(); await settled(); expect(b.api.location.hash).toBe('#/');
    reloaded.dispose();
  });
  it('opens distinct form URLs and supports browser back and forward', async () => {
    const b = browser(), changes: DocumentRoute[] = [];
    const nav = createDocumentNavigation(b.api, async kind => { changes.push(kind); return true; });
    await nav.start(); await nav.navigate('QT');
    expect(b.api.location.hash).toBe('#/documents/qt');
    expect(b.api.location.search).toBe('?workspace=local');
    b.api.history.go(-1); await settled();
    expect(changes.at(-1)).toBeNull(); expect(b.api.location.hash).toBe('#/');
    b.api.history.go(1); await settled();
    expect(changes.at(-1)).toBe('QT'); expect(b.api.location.hash).toBe('#/documents/qt');
    nav.dispose();
  });
  it('seeds home for a direct form link and does not duplicate history on refresh', async () => {
    const b = browser('#/documents/SC');
    const nav = createDocumentNavigation(b.api, async () => true);
    await nav.start();
    expect(b.entries).toHaveLength(2); expect(b.api.location.hash).toBe('#/documents/sc');
    nav.dispose();
    const changes: DocumentRoute[] = [];
    const reloaded = createDocumentNavigation(b.api, async kind => { changes.push(kind); return true; });
    await reloaded.start(); expect(b.entries).toHaveLength(2); expect(changes).toEqual(['SC']);
    reloaded.home(); await settled();
    expect(b.api.location.hash).toBe('#/'); expect(changes.at(-1)).toBeNull();
    b.api.history.go(1); await settled(); expect(changes.at(-1)).toBe('SC');
    reloaded.dispose();
  });
  it('the form return button reuses home history instead of adding a duplicate entry', async () => {
    const b = browser(), nav = createDocumentNavigation(b.api, async () => true);
    await nav.start(); await nav.navigate('PI'); nav.home(); await settled();
    expect(b.entries).toHaveLength(2); expect(b.api.location.hash).toBe('#/');
    b.api.history.go(1); await settled(); expect(b.api.location.hash).toBe('#/documents/pi');
    nav.dispose();
  });
  it('does not change URL or history when a form cannot be loaded', async () => {
    const b = browser(), nav = createDocumentNavigation(b.api, async kind => kind !== 'QT');
    await nav.start(); expect(await nav.navigate('QT')).toBe(false);
    expect(b.entries).toHaveLength(1); expect(b.api.location.hash).toBe('#/'); nav.dispose();
  });
  it('does not add history for reopening the current form', async () => {
    const b = browser(), nav = createDocumentNavigation(b.api, async () => true);
    await nav.start(); await nav.navigate('QT');
    expect(await nav.navigate('QT')).toBe(false); expect(b.entries).toHaveLength(2);
    nav.dispose();
  });
  it('returns home after switching form types and keeps their browser history', async () => {
    const b = browser(), changes: DocumentRoute[] = [];
    const nav = createDocumentNavigation(b.api, async kind => { changes.push(kind); return true; });
    await nav.start(); await nav.navigate('QT'); await nav.navigate('SC');
    nav.home(); await settled(); expect(b.api.location.hash).toBe('#/');
    b.api.history.go(-1); await settled(); expect(changes.at(-1)).toBe('SC');
    b.api.history.go(-1); await settled(); expect(changes.at(-1)).toBe('QT'); nav.dispose();
  });
  it('falls back to home when a freshly opened deep link contains an unreadable draft', async () => {
    const b = browser('#/documents/QT');
    const nav = createDocumentNavigation(b.api, async kind => kind === null);
    await nav.start(); await settled(); expect(b.api.location.hash).toBe('#/'); nav.dispose();
  });
  it('canceling browser back restores the form entry and retains forward history', async () => {
    const b = browser(); let allowHome = true;
    const nav = createDocumentNavigation(b.api, async kind => kind !== null || allowHome);
    await nav.start(); await nav.navigate('QT'); allowHome = false;
    b.api.history.go(-1); await settled();
    expect(b.api.location.hash).toBe('#/documents/qt'); expect(b.entries).toHaveLength(2);
    allowHome = true; b.api.history.go(-1); await settled();
    expect(b.api.location.hash).toBe('#/'); b.api.history.go(1); await settled();
    expect(b.api.location.hash).toBe('#/documents/qt'); nav.dispose();
  });
  it('handles manual hash changes once, despite paired browser events', async () => {
    const b = browser(), changes: DocumentRoute[] = [];
    const nav = createDocumentNavigation(b.api, async kind => { changes.push(kind); return true; });
    await nav.start(); b.manualHash('#/documents/PL'); await settled();
    expect(changes).toEqual([null, 'PL']);
    expect(b.api.location.hash).toBe('#/documents/pl');
    b.api.history.go(-1); await settled(); expect(changes.at(-1)).toBeNull(); nav.dispose();
  });
  it('recovers to home when a form deep link cannot be loaded on refresh', async () => {
    const b = browser('#/documents/CD');
    const first = createDocumentNavigation(b.api, async () => true);
    await first.start(); first.dispose();
    const reloaded = createDocumentNavigation(b.api, async kind => kind === null);
    await reloaded.start(); await settled(); expect(b.api.location.hash).toBe('#/'); reloaded.dispose();
  });
  it('normalizes old uppercase history entries without adding another entry', async () => {
    const b = browser(), nav = createDocumentNavigation(b.api, async () => true);
    await nav.start(); await nav.navigate('QT'); nav.dispose();
    b.api.history.replaceState(b.api.history.state, '', '/tools?workspace=local#/documents/QT');
    const reloaded = createDocumentNavigation(b.api, async () => true);
    await reloaded.start();
    expect(b.api.location.hash).toBe('#/documents/qt'); expect(b.entries).toHaveLength(2);
    reloaded.home(); await settled();
    b.api.history.go(1); await settled();
    expect(b.api.location.hash).toBe('#/documents/qt'); expect(b.entries).toHaveLength(2);
    reloaded.dispose();
  });
  it('processes the latest browser destination after an asynchronous confirmation', async () => {
    const b = browser(), changes: DocumentRoute[] = [];
    let waiting: Promise<boolean> | null = null;
    let resolve!: (value: boolean) => void;
    const nav = createDocumentNavigation(b.api, async kind => {
      if (waiting) { const pending = waiting; waiting = null; await pending; }
      changes.push(kind); return true;
    });
    await nav.start(); await nav.navigate('QT'); await nav.navigate('SC');
    waiting = new Promise(r => { resolve = r; });
    b.api.history.go(-1); await settled(); b.api.history.go(-1); await settled();
    resolve(true); await settled();
    expect(changes.at(-1)).toBeNull(); expect(b.api.location.hash).toBe('#/'); nav.dispose();
  });
});
