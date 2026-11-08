import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncCatalog } from '../../server/catalog.js';
import { db } from '../../server/db.js';

/**
 * Runs before the web server boots. It feeds a fixed dataset through the
 * production sync path so the catalog is deterministic and no external fetch
 * is triggered on startup.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'catalog.fixture.json'), 'utf8')
);

const result = await syncCatalog({ force: true, dataset, source: 'e2e' });
db.close();

console.log(`Seeded E2E catalog with ${result.count} exercises.`);
