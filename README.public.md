<!--
@license
Copyright (c) 2026 Rljson

Use of this source code is governed by terms that can be
found in the LICENSE file in the root of this package.
-->

# @rljson/io-indexed-db

Implements the [`@rljson/io`](https://github.com/rljson/io) `Io` interface on
top of the browser's IndexedDB. Use it to persist rljson data in the browser so
it survives page reloads.

```ts
import { IoIndexedDb } from '@rljson/io-indexed-db';

// Reopen the same `dbName` to keep your data across sessions.
const io = new IoIndexedDb({ dbName: 'my-app' });
await io.init();
await io.isReady();

await io.write({ data: myRljson });
const rows = await io.readRows({ table: 'myTable', where: { id: 5 } });
```

## Example

[src/example.ts](src/example.ts)
