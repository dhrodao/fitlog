// The active-workout view reimplements epley1rm: there is no build step, so a
// browser module cannot import the server service without leaking server code.
// That duplication is fine, but it can silently drift from the canonical
// formula. This test extracts the real function text from the frontend source
// and runs it, so it fails the moment either copy changes without the other.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { epley1rm as serverE1rm } from '../server/services/strength.js';

const activeSource = readFileSync(
  fileURLToPath(new URL('../public/js/views/active.js', import.meta.url)),
  'utf8'
);

// Pull the exact `function epley1rm(...) { ... }` block out of the view source
// (brace-matched) and evaluate it in an isolated context, so we test the
// shipped implementation rather than a hand-kept third copy.
function extractClientE1rm(source) {
  const start = source.indexOf('function epley1rm');
  assert.notEqual(start, -1, 'epley1rm must exist in active.js');
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.notEqual(end, -1, 'epley1rm body must be balanced');
  const fnText = source.slice(start, end);
  const context = { Number };
  vm.createContext(context);
  vm.runInContext(`${fnText}\nthis.epley1rm = epley1rm;`, context);
  return context.epley1rm;
}

test('active view epley1rm matches the server formula', () => {
  const clientE1rm = extractClientE1rm(activeSource);

  const cases = [
    [100, 1],
    [100, 10],
    [140, 3],
    [60, 5],
    [80, 2],
    [0, 5],
    [100, 0],
    [-5, 5],
    [100, -3],
    [null, 5],
    [100, null],
    [NaN, 3],
    [100, NaN],
    [72.5, 8],
    [95, 1],
  ];

  for (const [w, r] of cases) {
    assert.equal(
      clientE1rm(w, r),
      serverE1rm(w, r),
      `client and server e1RM disagree for weight=${w} reps=${r}`
    );
  }
});
