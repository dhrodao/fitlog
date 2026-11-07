// Locale-safe numeric parsing tests. Pure functions, no DOM or DB.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDecimalInput,
  parseIntegerInput,
  INVALID,
} from '../public/js/format.js';

test('parseDecimalInput — decimals and separators', () => {
  assert.equal(parseDecimalInput('72,5'), 72.5);
  assert.equal(parseDecimalInput('72.5'), 72.5);
  assert.equal(parseDecimalInput('1.234,5'), 1234.5);
  assert.equal(parseDecimalInput('1,234.5'), 1234.5);
  assert.equal(parseDecimalInput('1.234.567'), 1234567);
  assert.equal(parseDecimalInput('1,234,567'), 1234567);
  assert.equal(parseDecimalInput('100'), 100);
  assert.equal(parseDecimalInput('  80  '), 80);
  assert.equal(parseDecimalInput('-5,5'), -5.5);
  assert.equal(parseDecimalInput('0'), 0);
});

test('parseDecimalInput — empty is null, garbage is INVALID', () => {
  assert.equal(parseDecimalInput(''), null);
  assert.equal(parseDecimalInput('   '), null);
  assert.equal(parseDecimalInput(null), null);
  assert.equal(parseDecimalInput(undefined), null);
  assert.equal(parseDecimalInput('abc'), INVALID);
  assert.equal(parseDecimalInput('5kg'), INVALID);
  assert.equal(parseDecimalInput(','), INVALID);
  assert.equal(parseDecimalInput('.'), INVALID);
});

test('parseDecimalInput — mid-typing values resolve sensibly', () => {
  // "60." is a single dot -> decimal 60.
  assert.equal(parseDecimalInput('60.'), 60);
  assert.equal(parseDecimalInput('60,'), 60);
});

test('parseIntegerInput — rounds, rejects negatives', () => {
  assert.equal(parseIntegerInput('12'), 12);
  assert.equal(parseIntegerInput('12,6'), 13);
  assert.equal(parseIntegerInput('3'), 3);
  assert.equal(parseIntegerInput(''), null);
  assert.equal(parseIntegerInput('-2'), INVALID);
  assert.equal(parseIntegerInput('abc'), INVALID);
});
