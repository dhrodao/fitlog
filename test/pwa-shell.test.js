// Keeps the PWA shell cache honest without a bundler. Two guarantees:
//   1. PRECACHE lists every first-party JS/CSS module the shell needs, so an
//      installed client can cold-launch offline (all imports are static).
//   2. SHELL_HASH in sw.js matches the current contents of those files, so a
//      deploy that changes a shell file but forgets to bump CACHE_VERSION fails
//      the gate instead of shipping a stale, half-updated shell.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const swSource = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');

/** Parse the PRECACHE array literal out of sw.js. */
function parsePrecache() {
  const block = swSource.match(/const PRECACHE = \[([\s\S]*?)\];/);
  assert.ok(block, 'PRECACHE array found in sw.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Recompute the shell fingerprint the same way the source constant was set. */
function computeShellHash(list) {
  const h = crypto.createHash('sha256');
  for (const url of list) {
    const rel = url === '/' ? '/index.html' : url;
    h.update(url + '\0');
    h.update(fs.readFileSync(path.join(publicDir, rel)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/** Every first-party module under public/js. */
function allFirstPartyModules() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        out.push('/' + path.relative(publicDir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(publicDir, 'js'));
  return out;
}

test('precache lists every first-party JS module', () => {
  const precache = new Set(parsePrecache());
  const missing = allFirstPartyModules().filter((m) => !precache.has(m));
  assert.deepEqual(missing, [], `these shell modules are not precached: ${missing.join(', ')}`);
});

test('precache entries all exist on disk', () => {
  for (const url of parsePrecache()) {
    const rel = url === '/' ? '/index.html' : url;
    assert.ok(
      fs.existsSync(path.join(publicDir, rel)),
      `precached ${url} is missing on disk`
    );
  }
});

test('SHELL_HASH matches the current shell; bump it (and CACHE_VERSION) when it drifts', () => {
  const recorded = swSource.match(/const SHELL_HASH = '([^']+)';/);
  assert.ok(recorded, 'SHELL_HASH constant found in sw.js');
  const expected = computeShellHash(parsePrecache());
  assert.equal(
    recorded[1],
    expected,
    'shell files changed — update SHELL_HASH and bump CACHE_VERSION in public/sw.js'
  );
});
