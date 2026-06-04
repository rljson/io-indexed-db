<!--
@license
Copyright (c) 2026 Rljson

Use of this source code is governed by terms that can be
found in the LICENSE file in the root of this package.
-->

# Architecture

`IoIndexedDb` implements the `Io` interface from `@rljson/io`, modeled on
`IoMem` (behavior) and `IoSqlite` (structure).

## Storage model

- Each rljson table is stored as **one IndexedDB object store**, keyed on the
  row `_hash` (`keyPath: '_hash'`).
- Rows are stored as plain objects via **structured clone** - no per column
  serialization, no SQL, no column/table name suffixes. Nested values (e.g. the
  `columns` array of `tableCfgs`) are stored natively.
- Writes use `put`, which is idempotent for hash-addressed content (same `_hash`
  ⇒ same content), giving deduplication for free.
- The meta tables `tableCfgs` and `revisions` are ordinary object stores created
  during `init()`.

## Schema evolution

IndexedDB can only create object stores inside a `versionchange` transaction
fired by opening the database at a higher version. `_ensureStore()` therefore
closes and reopens the connection at `version + 1` to create a new store, and
serializes all such reopens through an internal promise chain to avoid version
races. Because rows are whole objects, **adding columns to an existing table
needs no schema change** - only a new `tableCfg` row.

## Queries

`readRows` loads a store's rows via `getAll()` and filters them in JavaScript
using the same predicate as `IoMem`. This keeps behavior byte-identical to the
in-memory backend and avoids index churn on schema evolution. A native-index
optimization for very large stores is a possible future enhancement.

## Testing

The package runs the shared conformance suite from `@rljson/io`. Under Node it
uses `fake-indexeddb` (registered via `test/setup/test-setup.ts`) so the
browser-targeted code runs in vitest's `node` environment.
