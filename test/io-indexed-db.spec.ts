// @license
// Copyright (c) 2026 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { addColumnsToTableCfg, exampleTableCfg, TableCfg } from '@rljson/rljson';

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import {
  deleteDb,
  openDb,
  requestToPromise,
  transactionToPromise,
} from '../src/idb';
import { IoIndexedDb } from '../src/io-indexed-db';

// .............................................................................
describe('idb helpers', () => {
  describe('requestToPromise', () => {
    it('resolves with the request result on success', async () => {
      const request: any = { result: 42 };
      const promise = requestToPromise<number>(request);
      request.onsuccess();
      expect(await promise).toBe(42);
    });

    it('rejects with the request error on error', async () => {
      const request: any = { error: new Error('boom') };
      const promise = requestToPromise(request);
      request.onerror();
      await expect(promise).rejects.toThrow('boom');
    });
  });

  describe('transactionToPromise', () => {
    it('resolves on complete', async () => {
      const tx: any = {};
      const promise = transactionToPromise(tx);
      tx.oncomplete();
      expect(await promise).toBeUndefined();
    });

    it('rejects on error', async () => {
      const tx: any = { error: new Error('tx-error') };
      const promise = transactionToPromise(tx);
      tx.onerror();
      await expect(promise).rejects.toThrow('tx-error');
    });

    it('rejects on abort', async () => {
      const tx: any = { error: new Error('tx-abort') };
      const promise = transactionToPromise(tx);
      tx.onabort();
      await expect(promise).rejects.toThrow('tx-abort');
    });
  });

  describe('openDb', () => {
    it('runs the upgrade callback and resolves on success', async () => {
      const db: any = { name: 'db' };
      const request: any = { result: db };
      const factory: any = { open: () => request };
      let upgraded: unknown = null;
      const promise = openDb(factory, 'db', 1, (d) => (upgraded = d));
      request.onupgradeneeded();
      request.onsuccess();
      expect(await promise).toBe(db);
      expect(upgraded).toBe(db);
    });

    it('rejects on error', async () => {
      const request: any = { error: new Error('open-error') };
      const factory: any = { open: () => request };
      const promise = openDb(factory, 'db', 1, () => {});
      request.onerror();
      await expect(promise).rejects.toThrow('open-error');
    });

    it('rejects when blocked', async () => {
      const request: any = {};
      const factory: any = { open: () => request };
      const promise = openDb(factory, 'mydb', 1, () => {});
      request.onblocked();
      await expect(promise).rejects.toThrow(
        'Opening database "mydb" is blocked',
      );
    });
  });

  describe('deleteDb', () => {
    it('resolves on success', async () => {
      const request: any = {};
      const factory: any = { deleteDatabase: () => request };
      const promise = deleteDb(factory, 'db');
      request.onsuccess();
      expect(await promise).toBeUndefined();
    });

    it('rejects on error', async () => {
      const request: any = { error: new Error('delete-error') };
      const factory: any = { deleteDatabase: () => request };
      const promise = deleteDb(factory, 'db');
      request.onerror();
      await expect(promise).rejects.toThrow('delete-error');
    });
  });
});

// .............................................................................
describe('IoIndexedDb', () => {
  it('persists data across reopen with the same db name', async () => {
    // Use a dedicated factory so the test does not pollute the global store.
    const factory = new IDBFactory();
    const dbName = 'persistence-test';

    // Create a database, a table and write a row
    const io1 = new IoIndexedDb({ dbName, factory });
    await io1.init();
    await io1.isReady();
    const tableCfg: TableCfg = exampleTableCfg({ key: 'tableA' });
    await io1.createOrExtendTable({ tableCfg });
    await io1.write({
      data: {
        tableA: {
          _type: 'components',
          _data: [{ a: 'hello', b: 5 }],
        },
      },
    });
    await io1.close();

    // Reopen the same database. The stores already exist, so init must not
    // recreate them - it reuses the persisted data.
    const io2 = new IoIndexedDb({ dbName, factory });
    await io2.init();
    await io2.isReady();

    expect(await io2.tableExists('tableA')).toBe(true);
    expect(await io2.rowCount('tableA')).toBe(1);

    const rows = await io2.readRows({ table: 'tableA', where: { a: 'hello' } });
    expect(rows.tableA._data.length).toBe(1);

    await io2.deleteDatabase();
  });

  it('queries a column added via extension (no index, falls back to a scan)', async () => {
    const factory = new IDBFactory();
    const io = new IoIndexedDb({ dbName: 'extension-query-test', factory });
    await io.init();
    await io.isReady();

    // Create a table - its original columns get indexes.
    const tableCfg: TableCfg = exampleTableCfg({ key: 'tableA' });
    await io.createOrExtendTable({ tableCfg });

    // Extend it with a new string column. Extension never bumps the store
    // version, so the new column has NO index.
    const extended = addColumnsToTableCfg(tableCfg, [
      { key: 'extra', type: 'string', titleShort: 'extra', titleLong: 'Extra' },
    ]);
    await io.createOrExtendTable({ tableCfg: extended });

    await io.write({
      data: {
        tableA: {
          _type: 'components',
          _data: [
            { a: 'x', b: 1, extra: 'find-me' },
            { a: 'y', b: 2, extra: 'other' },
          ],
        },
      },
    });

    // 'extra' is not indexed, so the query scans the store and filters in JS.
    const result = await io.readRows({
      table: 'tableA',
      where: { extra: 'find-me' },
    });
    expect(result.tableA._data.length).toBe(1);
    expect((result.tableA._data[0] as { extra: string }).extra).toBe('find-me');

    await io.deleteDatabase();
  });
});
