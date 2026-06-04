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
races. When a store is created, an index is added for every **scalar (string or
number) column** of the table config so queries can be served without a full
scan. Because rows are whole objects, **adding columns to an existing table
needs no schema change** - only a new `tableCfg` row. (Columns added later are
therefore not indexed; queries on them fall back to a scan, see below.)

## Queries

`readRows` narrows through a native IndexedDB index when it can, otherwise it
scans the store with `getAll()`. `_indexableWhereColumn()` picks a where column
to query through the index, requiring:

- a string or number value (booleans and json values are not valid IndexedDB
  keys), and
- an existing index for that column.

It returns `null` (forcing a scan) when **any** where value is `null`, because
the row filter treats a null condition against an absent field as a match, so
index narrowing could drop valid rows.

Whichever path runs, the same `IoMem` predicate is then applied in JavaScript,
so the index only needs to return a superset of the matching rows. Output stays
byte-identical to the in-memory backend.

## Testing

The package runs the shared conformance suite from `@rljson/io`. Under Node it
uses `fake-indexeddb` (registered via `test/setup/test-setup.ts`) so the
browser-targeted code runs in vitest's `node` environment.
