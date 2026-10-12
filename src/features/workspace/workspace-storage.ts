// Business data is committed atomically to IndexedDB. Synchronous readers use
// the last committed snapshot; mutations must run through updateWorkspace().
export const WORKSPACE_PREFIX = 'trade-toolbox:v1:';
export const KEY = WORKSPACE_PREFIX;
export const WORKSPACE_DATABASE = 'tradekit-lite-workspace';
const stores = ['values', 'images', 'meta'];
type ImageRecord = { id: string; data: string };
export type PackedValue = { parts: (string | { image: string })[] };

export function packValue(raw: string, images: Map<string, ImageRecord>): PackedValue {
  const parts: PackedValue['parts'] = [];
  const pattern = /data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+/gi;
  let offset = 0;
  for (const match of raw.matchAll(pattern)) {
    parts.push(raw.slice(offset, match.index));
    let image = images.get(match[0]);
    if (!image) { image = { id: crypto.randomUUID(), data: match[0] }; images.set(image.data, image); }
    parts.push({ image: image.id }); offset = match.index + match[0].length;
  }
  parts.push(raw.slice(offset));
  return { parts };
}
export function unpackValue(value: PackedValue, images: Map<string, string>): string {
  return value.parts.map(part => {
    if (typeof part === 'string') return part;
    const data = images.get(part.image);
    if (data === undefined) throw Error('本地图片副本缺失，原始记录未覆盖。请检查浏览器存储或恢复备份。');
    return data;
  }).join('');
}

export function mapStorage(data: Map<string, string>, writable = false): Storage {
  return {
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(String(key)) ?? null,
    setItem(key, value) {
      if (!writable) throw Error('请通过事务保存资料。');
      if (!String(key).startsWith(WORKSPACE_PREFIX)) throw Error('不支持的资料键。');
      data.set(String(key), String(value));
    },
    removeItem(key) {
      if (!writable) throw Error('请通过事务删除资料。');
      if (!String(key).startsWith(WORKSPACE_PREFIX)) throw Error('不支持的资料键。');
      data.delete(String(key));
    },
    clear() { throw Error('不允许清空全部浏览器资料。'); },
  };
}

export class WorkspaceDatabase {
  private cache = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private channel?: BroadcastChannel;
  private closed = false;
  private readonly legacy: Storage;
  readonly storage: Storage;

  private constructor(private db: IDBDatabase, legacy: Storage) {
    this.legacy = legacy;
    const owner = this;
    // Keep this facade's identity stable, while reading newly committed maps.
    this.storage = {
      get length() { return owner.cache.size; },
      key: index => [...this.cache.keys()][index] ?? null,
      getItem: key => this.cache.get(String(key)) ?? null,
      setItem() { throw Error('请通过事务保存资料。'); },
      removeItem() { throw Error('请通过事务删除资料。'); },
      clear() { throw Error('不允许清空全部浏览器资料。'); },
    };
    db.onversionchange = () => this.close();
  }

  static async open({ factory = indexedDB, legacy = localStorage, name = WORKSPACE_DATABASE }:
    { factory?: IDBFactory; legacy?: Storage; name?: string } = {}) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        for (const store of stores) request.result.createObjectStore(store);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(Error('请关闭旧版页面后重试，原资料仍保留。')); };
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    });
    const workspace = new WorkspaceDatabase(db, legacy);
    try {
      await workspace.update(() => {}, true);
      // Only remove the legacy copy after a successful durable commit, and only
      // if its exact contents match. Unrelated or concurrently edited keys stay.
      for (const [key, raw] of workspace.cache) {
        try { if (legacy.getItem(key) === raw) legacy.removeItem(key); } catch { /* A harmless extra legacy copy remains. */ }
      }
      if (typeof BroadcastChannel !== 'undefined') {
        workspace.channel = new BroadcastChannel(name);
        workspace.channel.onmessage = () => {
          void workspace.refresh().then(() => window.dispatchEvent(new Event('workspace-storage'))).catch(() => {
            window.dispatchEvent(new Event('workspace-storage-error'));
          });
        };
      }
      return workspace;
    } catch (error) { workspace.close(); throw error; }
  }

  update<T>(change: (storage: Storage) => T, migrate = false): Promise<T> {
    const task = this.queue.then(() => this.transaction(change, migrate));
    this.queue = task.catch(() => {});
    return task;
  }
  refresh() { return this.update(() => {}); }
  close() { this.closed = true; this.channel?.close(); this.db.close(); }

  private transaction<T>(change: (storage: Storage) => T, migrate: boolean): Promise<T> {
    if (this.closed) return Promise.reject(Error('本地资料连接已关闭，请重新打开页面。'));
    return new Promise((resolve, reject) => {
      // Reading the latest values and comparing/writing them in ONE transaction
      // prevents a second tab from winning between a conflict check and a write.
      const transaction = this.db.transaction(stores, 'readwrite');
      const values = transaction.objectStore('values'), imageStore = transaction.objectStore('images');
      const keys = values.getAllKeys(), entries = values.getAll(), pictures = imageStore.getAll();
      const migration = transaction.objectStore('meta').get('migrated');
      let ready = 0, result: T, next: Map<string, string>, failure: unknown, changed = false;
      transaction.onabort = () => {
        const error = failure ?? transaction.error;
        reject(error instanceof DOMException && error.name === 'QuotaExceededError'
          ? Error('本地资料存储空间不足，旧数据未改变。请先备份资料，再检查磁盘空间后重试。')
          : error ?? Error('本地资料保存失败，原资料未改变。'));
      };
      transaction.onerror = () => { /* onabort reports the complete transaction failure. */ };
      transaction.oncomplete = () => {
        this.cache = next;
        if (changed) {
          this.channel?.postMessage('updated');
          // Same-page lists need a committed-data notification too. Keep it
          // separate from cross-tab conflict events used by the active editor.
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('workspace-committed'));
        }
        resolve(result);
      };
      const loaded = () => {
        if (++ready !== 4) return;
        try {
          const oldImages = pictures.result as ImageRecord[];
          const imagesById = new Map(oldImages.map(image => [image.id, image.data]));
          const original = new Map((keys.result as string[]).map((key, index) => [key, unpackValue(entries.result[index], imagesById)]));
          next = new Map(original);
          if (migrate && migration.result !== true) {
            for (let index = 0; index < this.legacy.length; index++) {
              const key = this.legacy.key(index);
              if (!key?.startsWith(WORKSPACE_PREFIX) || next.has(key)) continue;
              const raw = this.legacy.getItem(key);
              if (raw !== null) next.set(key, raw);
            }
            transaction.objectStore('meta').put(true, 'migrated');
          }
          result = change(mapStorage(next, true));
          if (result instanceof Promise) throw Error('资料事务回调不能异步执行。');
          const imagesByData = new Map(oldImages.map(image => [image.data, image]));
          const used = new Set<string>();
          for (const [key, raw] of next) {
            const packed = packValue(raw, imagesByData);
            for (const part of packed.parts) if (typeof part !== 'string') used.add(part.image);
            if (raw !== original.get(key)) { values.put(packed, key); changed = true; }
          }
          for (const key of original.keys()) if (!next.has(key)) { values.delete(key); changed = true; }
          const oldIds = new Set(oldImages.map(image => image.id));
          for (const image of imagesByData.values()) if (used.has(image.id) && !oldIds.has(image.id)) imageStore.put(image, image.id);
          // An image is collected only when no draft, recovery, settings or
          // independent directory record references it anymore.
          for (const image of oldImages) if (!used.has(image.id)) imageStore.delete(image.id);
        } catch (error) { failure = error; transaction.abort(); }
      };
      for (const request of [keys, entries, pictures, migration]) request.onsuccess = loaded;
    });
  }
}

let workspace: WorkspaceDatabase | undefined;
export function workspaceStorage(): Storage { return workspace?.storage ?? localStorage; }
export function isWorkspaceSnapshot(storage: Storage) { return workspace?.storage === storage; }
export async function initializeWorkspaceStorage() {
  if (!workspace) workspace = await WorkspaceDatabase.open();
}
export function updateWorkspace<T>(change: (storage: Storage) => T): Promise<T> {
  if (workspace) return workspace.update(change);
  return Promise.resolve().then(() => change(localStorage));
}
export function refreshWorkspaceStorage(): Promise<void> {
  return workspace?.refresh() ?? Promise.resolve();
}
