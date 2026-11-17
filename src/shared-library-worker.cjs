'use strict';
const { parentPort, workerData } = require('node:worker_threads');
let file,
  databaseId,
  root,
  queue = Promise.resolve(),
  closed = false,
  kept = null; // { stamp, store }: the view of the library from the last request.

// Building a view of the library reads its whole record directory (about 15 ms for a few
// thousand records), and used to happen for every request, even one cached thumbnail. The
// library's identity, revision and change epoch say whether anything changed since: when
// they are the same as after the last request, that view is still exact and is reused.
// Requests run one at a time, and a view is never kept across a failed request.
function stamp() {
  try {
    const db = new (require('node:sqlite').DatabaseSync)(file, { readOnly: true, timeout: 5000 });
    try {
      const state = Object.fromEntries(
        db
          .prepare(
            "SELECT key,value FROM state WHERE key IN ('identity','change_epoch','query_index_identity','query_index_version')"
          )
          .all()
          .map(r => [r.key, r.value])
      );
      return state.identity && state.change_epoch ? state : null;
    } finally {
      db.close();
    }
  } catch {
    return null; // Unreadable just now: build a fresh view, which reports the real problem.
  }
}
const sameStamp = (a, b) =>
  !!a && !!b && ['identity', 'change_epoch', 'query_index_identity', 'query_index_version'].every(k => a[k] === b[k]);
/** Whether this view still describes exactly what the stamp says is on disk. */
function current(store, state) {
  const token = store.deferredState?.token;
  if (!state || !token || store.pendingWrite) return false;
  try {
    const [id, revision] = JSON.parse(state.identity);
    return token.id === id && token.revision === revision && token.epoch === state.change_epoch;
  } catch {
    return false;
  }
}
parentPort.on('message', message => {
  queue = queue.then(async () => {
    try {
      if (closed) throw Error('Library handle closed.');
      let value;
      if (message.method === 'open') {
        const bootstrap = require('./shared-library-bootstrap.cjs'),
          locations = require('./shared-library-location.cjs');
        // resolve() reads library.json without the lock. Re-check it inside the lock
        // so a library moved meanwhile is reopened at its new path, never written at the old one.
        for (let attempt = 0; ; attempt++) {
          const location = await locations.resolve({
            ...workerData,
            legacyPaddockPath: bootstrap.paddockPath(workerData)
          });
          try {
            const within = fn =>
              locations.lock(location.root, () => {
                locations.assertCurrent(location.root, location.file, location.databaseId);
                return fn();
              });
            const adoption = await within(() => bootstrap.adopt(location.file, location.root, workerData)),
              nativeHistoryRepair = await within(() =>
                require('./shared-library-native-history.cjs').repair(location.file, location.root)
              );
            file = location.file;
            databaseId = location.databaseId;
            root = location.root;
            value = { ...location, adoption, nativeHistoryRepair };
            break;
          } catch (e) {
            if (e.code !== 'LIBRARY_MOVED' || attempt >= 2) throw e;
          }
        }
      } else if (message.method === 'close') {
        closed = true;
        value = true;
      } else {
        if (!file) throw Error('Open the library first.');
        // Never let a restore through a stale handle create a new file at a moved-away path.
        if (message.method === 'restore') require('./shared-library-location.cjs').checkOpen(root, file, databaseId);
        if (message.method === 'restore')
          value = await require('./shared-library-restore.cjs').restore(
            file,
            { ...workerData, sharedRoot: root, openedDatabaseId: databaseId },
            message.input
          );
        else
          for (let attempt = 0; ; attempt++)
            try {
              if (require('./shared-library-location.cjs').checkOpen(root, file, databaseId) !== databaseId)
                throw Object.assign(Error('The shared library was replaced. Reopen it explicitly before continuing.'), {
                  code: 'DATABASE_MISMATCH'
                });
              const before = stamp(),
                reuse = kept && sameStamp(kept.stamp, before) && current(kept.store, before);
              const store = reuse ? kept.store : new (require('./store.cjs').Store)(file, { deferred: true });
              kept = null; // Kept again only after this request succeeds.
              value = await require('./shared-library-engine.cjs').call(
                store,
                { ...workerData, thumbnailRoot: root },
                message.method,
                message.input
              );
              const after = stamp();
              if (current(store, after)) kept = { stamp: after, store };
              break;
            } catch (e) {
              if (
                attempt >= 5 ||
                (!['QUERY_CHANGED', 'SQLITE_BUSY'].includes(e.code) &&
                  !/database changed in another process|database is locked/.test(e.message))
              )
                throw e;
              await new Promise(r => setTimeout(r, 20 * (attempt + 1)));
            }
      }
      parentPort.postMessage({ id: message.id, value });
    } catch (e) {
      parentPort.postMessage({
        id: message.id,
        error: { message: e.message, code: e.apiCode || e.code, details: e.details }
      });
    }
  });
});
