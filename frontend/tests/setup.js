// Vitest setup: stub Nuxt runtime helpers so server modules that reference
// them at import time (e.g. server/utils/db.js) can be loaded under Node.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const contentRoot = path.join(os.tmpdir(), `sg-vitest-content-${process.pid}`);
fs.mkdirSync(contentRoot, { recursive: true });
delete process.env.CONTENT_DIR;
delete process.env.CONTENT_PATH;
process.env.CONTENT_DIRS ||= `test=${contentRoot}`;

if (typeof globalThis.useRuntimeConfig !== 'function') {
  globalThis.useRuntimeConfig = () => ({
    databasePath: path.join(os.tmpdir(), `sg-vitest-${process.pid}.sqlite`),
  });
}
