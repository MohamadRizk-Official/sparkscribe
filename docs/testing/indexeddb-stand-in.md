# An IndexedDB stand-in for tests

Node has no IndexedDB. `src/lib/audio-store.js` treats that as "no storage" and quietly does nothing, which
`tests/audio-store-test.mjs` relies on. To test the code that *does* use the database (`tests/audio-store-idb-test.mjs`)
the test installs a very small in-memory version on `globalThis.indexedDB` before importing the module.

## What the module needs from IndexedDB
`audio-store.js` opens one database with one object store and then runs one transaction per call:

1. `indexedDB.open(name, 1)` returns a request. The module sets `onupgradeneeded` (to create the store) and `onsuccess`
   (to receive `request.result`, the database) and reads `db.onversionchange`.
2. `db.transaction(store, mode)` returns a transaction with `objectStore()`; the module sets `oncomplete`, `onerror`
   and `onabort` on it **after** it has issued its request.
3. Store methods return a request whose `result` is read in `tx.oncomplete`: `get`, `put` (the key), `delete`, `count`,
   `clear`, `getAll`, `getAllKeys`.

## The stand-in
- A `Map` plays the store. Each method changes the map straight away and returns `{ result }`.
- The transaction fires `oncomplete` on the next tick (`setTimeout(…, 0)`), which is after the module has attached its handler.
- `open()` fires `onupgradeneeded` and then `onsuccess` on the next tick.
- A `failNext` flag makes the next `transaction()` throw, to prove failures are swallowed (`putAudio` says `false`, `getAudio` says `null`).

## Other globals the test sets
`localStorage` (the keep-audio switch) and `navigator.storage` (`persist` and `estimate`). In Node 22 `navigator` is a
getter on `globalThis`, so it must be replaced with `Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })`;
plain assignment throws.

## What it can and cannot show
It checks the module's own logic: what is stored, what comes back, that additions keep earlier fields, that keys are
text, that blanks are refused, and that failures never throw. It does not model real transactions, quotas or
browser eviction, so it says nothing about how a real browser behaves under storage pressure.

See [stand-ins.md](stand-ins.md) for the Supabase, fetch and DOM stand-ins, and [../modules/audio-store.md](../modules/audio-store.md) for the module.
