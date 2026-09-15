/**
 * db.js — the storage boundary.
 *
 * Spec Instruction 3: "Modules must never directly access IndexedDB."
 * Every module (tasks, spendee, people, ...) is expected to talk to this
 * file only, through the generic CRUD functions below. That gives us a
 * single seam to swap for a real backend later (Instruction 46) — a future
 * cloud-sync layer can implement the same function signatures and nothing
 * outside this file has to change.
 *
 * Records always get: id (generateId), createdAt, updatedAt (ISO strings).
 */

import { CONFIG } from './config.js?v=5';
import { generateId, nowISO } from './utils.js?v=5';

let dbPromise = null;

/** Open (or create/upgrade) the database. Safe to call many times — the
 * promise is memoized so every caller shares one connection.
 *
 * Two failure modes get special handling, because without it a failed
 * open here breaks every button on the page that touches data (which is
 * most of them), often with no visible explanation:
 *  - `onblocked`: another tab has an older connection open during a
 *    version upgrade. We reject with a clear, actionable message *and*
 *    clear the memoized promise, so once the other tab is closed, the
 *    very next data operation retries the connection instead of reusing
 *    a permanently-broken cached rejection.
 *  - `onversionchange` on an already-open connection: fires when a
 *    *different* tab (e.g. one running a newer build) wants to upgrade.
 *    We close this tab's connection immediately so we're not the thing
 *    blocking it, and clear the memoized promise so this tab reopens
 *    fresh (and upgrades itself) the next time it needs the database.
 */
function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('This browser does not support IndexedDB. CampusOS needs a modern browser to store your data locally.'));
      return;
    }

    const request = indexedDB.open(CONFIG.db.name, CONFIG.db.version);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      migrate(db);
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Failed to open CampusOS database.'));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('Another tab with CampusOS open is blocking a required update. Close every other CampusOS tab, then reload this page.'));
    };
  });

  return dbPromise;
}

/**
 * Versioned schema upgrades live here. This runs additively and
 * idempotently on every upgrade — it always ensures every store/index
 * CONFIG currently defines exists, regardless of which version someone
 * is upgrading from, rather than only creating stores the first time the
 * database is ever opened. That matters because a returning user's
 * browser already has a database at some earlier version; if new stores
 * were only created when `oldVersion < 1`, anyone upgrading from an
 * older build would silently never get the new store, and any code that
 * queries it would throw (breaking that whole page's initialization).
 * Never delete or rename a store here without a migration path for its
 * data (Instruction 32: imports/upgrades must not corrupt data).
 */
function migrate(db) {
  for (const store of Object.values(CONFIG.stores)) {
    if (db.objectStoreNames.contains(store.name)) continue;
    const objectStore = db.createObjectStore(store.name, { keyPath: store.keyPath });
    for (const indexName of store.indexes) {
      objectStore.createIndex(indexName, indexName, { unique: false });
    }
  }
}

function withStore(storeName, mode, work) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = work(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error(`Transaction failed on "${storeName}".`));
    tx.onabort = () => reject(tx.error || new Error(`Transaction aborted on "${storeName}".`));
  }));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Create a record. Stamps id/createdAt/updatedAt unless already present
 * (import restores need to keep original ids/timestamps). */
export async function create(storeName, data) {
  const record = {
    ...data,
    id: data.id || generateId(),
    createdAt: data.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
  await withStore(storeName, 'readwrite', (store) => store.put(record));
  return record;
}

export async function getById(storeName, id) {
  return withStore(storeName, 'readonly', (store) => requestToPromise(store.get(id)));
}

export async function getAll(storeName) {
  const result = await withStore(storeName, 'readonly', (store) => requestToPromise(store.getAll()));
  return result || [];
}

export async function update(storeName, id, patch) {
  const existing = await getById(storeName, id);
  if (!existing) throw new Error(`Cannot update "${storeName}" record ${id} — it doesn't exist.`);
  const record = { ...existing, ...patch, id, updatedAt: nowISO() };
  await withStore(storeName, 'readwrite', (store) => store.put(record));
  return record;
}

export async function remove(storeName, id) {
  await withStore(storeName, 'readwrite', (store) => store.delete(id));
  return true;
}

export async function clearStore(storeName) {
  await withStore(storeName, 'readwrite', (store) => store.clear());
  return true;
}

/** Query by index, e.g. queryByIndex('tasks', 'status', 'completed'). */
export async function queryByIndex(storeName, indexName, value) {
  return withStore(storeName, 'readonly', (store) => requestToPromise(store.index(indexName).getAll(value)));
}

/** Simple key/value bucket for app-level settings (theme, onboarding
 * flags, etc.) so Settings doesn't need its own bespoke store logic. */
export async function getConfigValue(key, fallback = null) {
  const row = await getById(CONFIG.stores.appConfig.name, key);
  return row ? row.value : fallback;
}

export async function setConfigValue(key, value) {
  await withStore(CONFIG.stores.appConfig.name, 'readwrite', (store) => store.put({ key, value }));
  return value;
}

/** Dump every store as plain objects — used by Settings → Export
 * (Instruction 32). Large binary blobs (library files) are intentionally
 * excluded here; export.js handles those separately and must say so. */
export async function exportAllStores() {
  const dump = {};
  for (const store of Object.values(CONFIG.stores)) {
    dump[store.name] = await getAll(store.name);
  }
  return dump;
}

/** Bulk-restore a store from an export/import payload. Existing records
 * with the same id are overwritten; nothing else is touched. */
export async function bulkPut(storeName, records) {
  return withStore(storeName, 'readwrite', (store) => {
    for (const record of records) store.put(record);
  });
}

export async function isReady() {
  try {
    await openDB();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err?.message || 'Unknown storage error.' };
  }
}
