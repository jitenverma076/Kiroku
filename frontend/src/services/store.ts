/**
 * Browser-local storage for documents, their files, and tags.
 *
 * IndexedDB is the whole persistence layer when Kiroku runs without a backend:
 * documents stay in the tab's origin storage and are never uploaded.
 */

const DB_NAME = 'kiroku';
const DB_VERSION = 1;

export const DOCS = 'documents';
export const FILES = 'files';
export const TAGS = 'tags';
export const PREVIEWS = 'previews';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS)) {
        const docs = db.createObjectStore(DOCS, { keyPath: 'id' });
        docs.createIndex('file_hash', 'file_hash', { unique: false });
        docs.createIndex('imported_at', 'imported_at', { unique: false });
      }
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(TAGS)) db.createObjectStore(TAGS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PREVIEWS)) db.createObjectStore(PREVIEWS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open local storage'));
  });
  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Local storage request failed'));
      }),
  );
}

export const getAll = <T>(store: string): Promise<T[]> =>
  run<T[]>(store, 'readonly', s => s.getAll());

export const get = <T>(store: string, key: string): Promise<T | undefined> =>
  run<T | undefined>(store, 'readonly', s => s.get(key));

export const put = <T>(store: string, value: T, key?: string): Promise<IDBValidKey> =>
  run<IDBValidKey>(store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key)));

export const remove = (store: string, key: string): Promise<undefined> =>
  run<undefined>(store, 'readwrite', s => s.delete(key));

/** Total bytes of every stored original, for the storage figure in Settings. */
export async function storageUsage(): Promise<{ files: number; bytes: number }> {
  const blobs = await getAll<Blob>(FILES);
  return { files: blobs.length, bytes: blobs.reduce((sum, b) => sum + (b?.size ?? 0), 0) };
}

/** SHA-256 of the file, used for exact-duplicate detection. */
export async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
