// @license
// Copyright (c) 2026 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

// ............................................................................
// Small dependency free helpers turning IndexedDB's event based API into
// promises. Kept free of any rljson knowledge so it stays trivially testable.
// ............................................................................

/**
 * Resolves with the result of an IndexedDB request once it succeeds.
 * Rejects with the request error when it fails.
 * @param request - The request to wrap
 * @returns A promise resolving with the request result
 */
export const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Resolves once an IndexedDB transaction has committed.
 * Rejects when the transaction errors or is aborted.
 * @param transaction - The transaction to wrap
 * @returns A promise resolving once the transaction completed
 */
export const transactionToPromise = (
  transaction: IDBTransaction,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

/**
 * Callback invoked inside the `versionchange` transaction to create or migrate
 * object stores.
 * @param db - The database being upgraded
 */
export type IdbUpgrade = (db: IDBDatabase) => void;

/**
 * Opens (or creates) an IndexedDB database at the given version. The upgrade
 * callback is invoked inside the `versionchange` transaction, which is the only
 * place object stores may be created.
 * @param factory - The IndexedDB factory to use (e.g. the global `indexedDB`)
 * @param name - The database name
 * @param version - The version to open at, or `undefined` to use the existing
 * version (so a persisted database is not forced down to version 1)
 * @param onUpgrade - Callback to create/migrate object stores during an upgrade
 * @returns A promise resolving with the opened database
 */
export const openDb = (
  factory: IDBFactory,
  name: string,
  version: number | undefined,
  onUpgrade: IdbUpgrade,
): Promise<IDBDatabase> => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request =
      version === undefined ? factory.open(name) : factory.open(name, version);
    request.onupgradeneeded = () => onUpgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error(`Opening database "${name}" is blocked`));
  });
};

/**
 * Deletes an IndexedDB database.
 * @param factory - The IndexedDB factory to use
 * @param name - The name of the database to delete
 * @returns A promise resolving once the database has been deleted
 */
export const deleteDb = (factory: IDBFactory, name: string): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
