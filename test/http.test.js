// Server-side numeric coercion: defence-in-depth comma tolerance. The client
// normalises decimals, but a bare "72,5" must not silently become the fallback.

import test from 'node:test';
import assert from 'node:assert/strict';

import { toNumber } from '../server/http.js';

test('toNumber accepts a single comma as decimal separator', () => {
  assert.equal(toNumber('72,5'), 72.5);
  assert.equal(toNumber('72.5'), 72.5);
  assert.equal(toNumber('100'), 100);
  assert.equal(toNumber(42), 42);
});

test('toNumber returns the fallback for empty or invalid input', () => {
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber('5kg'), null);
  assert.equal(toNumber('', 0), 0);
});

test('toNumber does not guess ambiguous multi-separator strings', () => {
  // Two commas is not a plain decimal; leave it to Number (NaN -> fallback).
  assert.equal(toNumber('1,234,5'), null);
});
