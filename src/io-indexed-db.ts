// @license
// Copyright (c) 2026 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { hip, hsh } from '@rljson/hash';
import { Io, IoTools } from '@rljson/io';
import { IsReady } from '@rljson/is-ready';
import { equals, Json, JsonValue } from '@rljson/json';
import {
  ColumnCfg,
  ContentType,
  iterateTables,
  iterateTablesSync,
  Rljson,
  TableCfg,
  TableKey,
  TableType,
} from '@rljson/rljson';

import {
  deleteDb,
  openDb,
  requestToPromise,
  transactionToPromise,
} from './idb.ts';

// Counter to generate a unique default database name per instance.
let _instanceCounter = 0;

/**
 * Options for creating an {@link IoIndexedDb} instance.
 */
export interface IoIndexedDbOptions {
  /** The IndexedDB database name. Apps may reuse a name to reopen their data. */
  dbName?: string;

  /** The IndexedDB factory to use. Defaults to the global `indexedDB`. */
  factory?: IDBFactory;
}

/**
 * IndexedDB implementation of the rljson Io interface. Persists rljson data
 * into the browser's IndexedDB so it survives page reloads.
 *
 * Each rljson table is stored as one object store keyed on the row `_hash`.
 * Rows are stored as plain objects via structured clone, so no per column
 * serialization is needed.
 */
export class IoIndexedDb implements Io {
  private _ioTools!: IoTools;
  private _isReady = new IsReady();
  private _isOpen = false;
  private _db!: IDBDatabase;
  private readonly _dbName: string;
  private readonly _factory: IDBFactory;

  // Serializes all version bumping reopens so concurrent store creations do not
  // race on the same `version + 1`.
  private _opChain: Promise<void> = Promise.resolve();

  /**
   * Creates a new IndexedDB backed Io instance.
   * @param options - Optional database name and IndexedDB factory
   */
  constructor(options?: IoIndexedDbOptions) {
    this._dbName =
      options?.dbName ??
      `rljson-io-indexed-db-${Date.now()}-${++_instanceCounter}`;
    this._factory = options?.factory ?? globalThis.indexedDB;
  }

  /**
   * Returns an example database.
   * @param options - Optional database name and IndexedDB factory
   * @returns An initialized IoIndexedDb instance
   */
  static example = async (options?: IoIndexedDbOptions) => {
    const io = new IoIndexedDb(options);
    await io.init();
    return io;
  };

  // ...........................................................................
  // General

  async init(): Promise<void> {
    // Calling init twice (the conformance suite does) must be a no-op.
    if (this._isOpen) {
      return;
    }

    // Open without a version so an existing (persisted) database keeps its
    // current version instead of being forced down to version 1.
    this._db = await openDb(this._factory, this._dbName, undefined, () => {});
    this._isOpen = true;
    this._ioTools = new IoTools(this);
    await this._initTableCfgs();
    await this._ioTools.initRevisionsTable();
    this._isReady.resolve();
  }

  isReady(): Promise<void> {
    return this._isReady.promise;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  async close(): Promise<void> {
    this._isOpen = false;
    this._db.close();
  }

  /**
   * Closes the connection and deletes the underlying database.
   */
  async deleteDatabase(): Promise<void> {
    this._db.close();
    await deleteDb(this._factory, this._dbName);
  }

  // ...........................................................................
  // Dump

  dump(): Promise<Rljson> {
    return this._dump();
  }

  dumpTable(request: { table: string }): Promise<Rljson> {
    return this._dumpTable(request);
  }

  // ...........................................................................
  // Meta data

  async contentType(request: { table: string }): Promise<ContentType> {
    const tableCfg = await this._ioTools.tableCfg(request.table);
    return tableCfg.type;
  }

  // ...........................................................................
  // Tables

  async tableExists(tableKey: TableKey): Promise<boolean> {
    return this._db.objectStoreNames.contains(tableKey);
  }

  createOrExtendTable(request: { tableCfg: TableCfg }): Promise<void> {
    return this._createOrExtendTable(request);
  }

  async rawTableCfgs(): Promise<TableCfg[]> {
    const tx = this._db.transaction('tableCfgs', 'readonly');
    const rows = await requestToPromise(tx.objectStore('tableCfgs').getAll());
    return rows as TableCfg[];
  }

  // ...........................................................................
  // Rows

  readRows(request: {
    table: string;
    where: { [column: string]: JsonValue };
  }): Promise<Rljson> {
    return this._readRows(request);
  }

  async rowCount(table: string): Promise<number> {
    await this._ioTools.throwWhenTableDoesNotExist(table);
    const tx = this._db.transaction(table, 'readonly');
    return requestToPromise(tx.objectStore(table).count());
  }

  // ...........................................................................
  // Write

  write(request: { data: Rljson }): Promise<void> {
    return this._write(request);
  }

  // ######################
  // Private
  // ######################

  // ...........................................................................
  // Stores / schema

  /**
   * Ensures an object store exists, creating it inside a `versionchange`
   * transaction if needed. An index is created for every scalar (string or
   * number) column so `readRows` can query through it instead of scanning the
   * whole store. Reopens are serialized through `_opChain`.
   * @param storeName - The name of the object store to ensure
   * @param columns - The column configurations to derive indexes from
   * @returns A promise resolving once the store exists
   */
  private _ensureStore(storeName: string, columns: ColumnCfg[]): Promise<void> {
    this._opChain = this._opChain.then(async () => {
      if (this._db.objectStoreNames.contains(storeName)) {
        return;
      }

      const newVersion = this._db.version + 1;
      this._db.close();
      this._db = await openDb(this._factory, this._dbName, newVersion, (db) => {
        const store = db.createObjectStore(storeName, { keyPath: '_hash' });
        for (const column of columns) {
          // `_hash` is the primary key. Only string/number columns can be
          // IndexedDB keys, so booleans and json columns stay unindexed.
          if (column.key === '_hash') {
            continue;
          }
          if (column.type === 'string' || column.type === 'number') {
            store.createIndex(column.key, column.key, { unique: false });
          }
        }
      });
    });

    return this._opChain;
  }

  /**
   * Returns the where column whose value can be served by an IndexedDB index,
   * or null when the query must scan the whole store. A null where value
   * disables index use because the row filter treats a null condition against
   * an absent field as a match, so narrowing could drop valid rows.
   * @param store - The object store being queried
   * @param where - The where clause of the query
   * @returns The name of an indexable where column, or null
   */
  private _indexableWhereColumn(
    store: IDBObjectStore,
    where: { [column: string]: JsonValue },
  ): string | null {
    for (const column in where) {
      if (where[column] === null) {
        return null;
      }
    }

    for (const column in where) {
      const value = where[column];
      if (
        (typeof value === 'string' || typeof value === 'number') &&
        store.indexNames.contains(column)
      ) {
        return column;
      }
    }

    return null;
  }

  // ...........................................................................
  private async _initTableCfgs(): Promise<void> {
    await this._ensureStore('tableCfgs', IoTools.tableCfgsTableCfg.columns);
    await this._putTableCfgRow(IoTools.tableCfgsTableCfg);
  }

  // ...........................................................................
  private async _createOrExtendTable(request: {
    tableCfg: TableCfg;
  }): Promise<void> {
    await this._ioTools.throwWhenTableIsNotCompatible(request.tableCfg);

    const tableCfgHashed = hsh(request.tableCfg);
    const existing = await this._ioTools.tableCfgOrNull(request.tableCfg.key);

    if (!existing) {
      await this._ensureStore(request.tableCfg.key, request.tableCfg.columns);
      await this._putTableCfgRow(tableCfgHashed);
      return;
    }

    // The table already exists. Because rows are stored as whole objects, new
    // columns need no store change - only a new tableCfg row.
    const addedColumns =
      tableCfgHashed.columns.length - existing.columns.length;
    if (addedColumns === 0) {
      return;
    }

    await this._putTableCfgRow(tableCfgHashed);
  }

  // ...........................................................................
  private async _putTableCfgRow(tableCfg: TableCfg): Promise<void> {
    hip(tableCfg);
    const tx = this._db.transaction('tableCfgs', 'readwrite');
    tx.objectStore('tableCfgs').put(tableCfg);
    await transactionToPromise(tx);
  }

  // ...........................................................................
  // Write

  private async _write(request: { data: Rljson }): Promise<void> {
    const data = hsh(request.data);
    this._removeNullValues(data);

    await this._ioTools.throwWhenTablesDoNotExist(request.data);
    await this._ioTools.throwWhenTableDataDoesNotMatchCfg(request.data);

    await iterateTables(data, async (tableName, tableData) => {
      const tx = this._db.transaction(tableName, 'readwrite');
      const store = tx.objectStore(tableName);
      for (const row of tableData._data) {
        // Idempotent dedup: identical content has an identical `_hash` key.
        store.put(row);
      }
      await transactionToPromise(tx);
    });
  }

  // ...........................................................................
  private _removeNullValues(rljson: Rljson): void {
    iterateTablesSync(rljson, (table) => {
      const data = rljson[table]._data;
      for (const row of data) {
        for (const key in row) {
          if ((row as Json)[key] === null) {
            delete (row as Json)[key];
          }
        }
      }
    });
  }

  // ...........................................................................
  // Read

  private async _readRows(request: {
    table: string;
    where: { [column: string]: JsonValue };
  }): Promise<Rljson> {
    await this._ioTools.throwWhenTableDoesNotExist(request.table);
    await this._ioTools.throwWhenColumnDoesNotExist(
      request.table,
      Object.keys(request.where),
    );

    const tableCfg = await this._ioTools.tableCfg(request.table);

    const tx = this._db.transaction(request.table, 'readonly');
    const store = tx.objectStore(request.table);

    // Narrow through an index when possible, otherwise scan the whole store.
    // The JavaScript filter below is applied either way, so the index only
    // needs to return a superset of the matching rows.
    const indexColumn = this._indexableWhereColumn(store, request.where);
    const rows = (await requestToPromise(
      indexColumn
        ? store
            .index(indexColumn)
            .getAll(request.where[indexColumn] as IDBValidKey)
        : store.getAll(),
    )) as Json[];

    const filtered = rows.filter((row) => {
      for (const column in request.where) {
        const a = row[column];
        const b = request.where[column];
        if (b === null && a === undefined) {
          return true;
        }

        if (!equals(a, b)) {
          return false;
        }
      }
      return true;
    });

    const table: TableType = {
      _type: tableCfg.type,
      _data: filtered as any,
    };

    this._ioTools.sortTableDataAndUpdateHash(table);

    return { [request.table]: table } as Rljson;
  }

  // ...........................................................................
  // Dump

  private async _dump(): Promise<Rljson> {
    const result: Rljson = {};

    for (const tableName of Array.from(this._db.objectStoreNames)) {
      const tableDump = await this._dumpTable({ table: tableName });
      result[tableName] = tableDump[tableName];
    }

    hip(result, { updateExistingHashes: false, throwOnWrongHashes: false });
    return result;
  }

  // ...........................................................................
  private async _dumpTable(request: { table: string }): Promise<Rljson> {
    await this._ioTools.throwWhenTableDoesNotExist(request.table);
    const tableCfg = await this._ioTools.tableCfg(request.table);

    const tx = this._db.transaction(request.table, 'readonly');
    const rows = (await requestToPromise(
      tx.objectStore(request.table).getAll(),
    )) as Json[];

    const table: TableType = {
      _type: tableCfg.type,
      _data: rows as any,
      _tableCfg: tableCfg._hash as string,
      _hash: '',
    };

    this._ioTools.sortTableDataAndUpdateHash(table);

    return { [request.table]: table } as Rljson;
  }
}
