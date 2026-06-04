// @license
// Copyright (c) 2026 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { Io, IoTestSetup } from '@rljson/io';

import { IoIndexedDb } from '../src/io-indexed-db';

// ..............................................................................
class MyIoTestSetup implements IoTestSetup {
  async beforeAll(): Promise<void> {
    // IndexedDb does not need any setup before all tests
  }

  async beforeEach(): Promise<void> {
    this._io = await IoIndexedDb.example();
  }

  async afterEach(): Promise<void> {
    await (this.io as IoIndexedDb).deleteDatabase();
  }

  async afterAll(): Promise<void> {
    // IndexedDb does not need any cleanup after all tests
  }

  get io(): Io {
    if (!this._io) {
      throw new Error('Call init() before accessing io');
    }
    return this._io;
  }

  private _io: Io | null = null;
}

// .............................................................................
export const testSetup = () => new MyIoTestSetup();
