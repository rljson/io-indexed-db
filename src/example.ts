// @license
// Copyright (c) 2026 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { IoIndexedDb } from './io-indexed-db.ts';

export const example = async () => {
  // Print methods
  const l = console.log;
  const h1 = (text: string) => l(`${text}`);
  const h2 = (text: string) => l(`  ${text.split('\n')}`);

  // Example
  h1('IoIndexedDb.example');
  h2('Returns an instance of io-indexed-db.');
  const io = await IoIndexedDb.example();
  await io.isReady();
  const dump = await io.dump();
  l(JSON.stringify(dump, null, 2));
  await io.deleteDatabase();
};

/*
// Run via "npx vite-node src/example.ts"
example();
*/
