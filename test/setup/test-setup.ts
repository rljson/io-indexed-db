// Provide a global `indexedDB` / `IDBKeyRange` implementation in Node so the
// browser-targeted IoIndexedDb can run under vitest's `environment: 'node'`.
import 'fake-indexeddb/auto';

import { expect } from 'vitest';
import * as matchers from 'vitest-dom/matchers';

expect.extend(matchers);
