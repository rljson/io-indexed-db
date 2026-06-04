// @license
// Copyright (c) 2026 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { describe, expect, it } from 'vitest';

import { example } from '../src/example';

describe('example', () => {
  it('should run without error', async () => {
    // Execute example
    const logMessages: string[] = [];
    const log = console.log;
    console.log = (message: string) => logMessages.push(message);
    await example();

    // Restore console.log
    console.log = log;
    expect(logMessages.length).toBeGreaterThan(0);
  });
});
