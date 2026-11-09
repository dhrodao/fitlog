import test from 'node:test';
import assert from 'node:assert/strict';
import { applyKey } from '../public/js/keypad-logic.js';

const W = { field: 'weightKg' };
const R = { field: 'reps' };

// Press a sequence of keys starting from a field value.
function press(start, keys, options, fresh = false) {
  let state = { value: start, fresh };
  for (const key of keys) state = applyKey(state.value, key, { ...options, fresh: state.fresh });
  return state;
}

test('numeric keypad rules', async (t) => {
  await t.test('digits append to the current value', () => {
    assert.equal(press('', ['6', '0'], W).value, '60');
    assert.equal(press('6', ['2'], R).value, '62');
  });

  await t.test('the first digit after focusing replaces the whole value', () => {
    const state = press('200', ['5', '0'], W, true);
    assert.equal(state.value, '50');
    assert.equal(state.fresh, false, 'later digits append');
  });

  await t.test('a leading zero is replaced by the next digit', () => {
    assert.equal(press('', ['0', '5'], R).value, '5');
    assert.equal(press('0', ['0'], R).value, '0');
  });

  await t.test('weight accepts one decimal separator, reps none', () => {
    assert.equal(press('', ['6', '0', '.', '5'], W).value, '60.5');
    assert.equal(press('60.5', ['.'], W).value, '60.5', 'a second separator is ignored');
    assert.equal(press('72,5', ['.'], W).value, '72,5', 'a comma already counts as the separator');
    assert.equal(press('12', ['.'], R).value, '12', 'reps are whole numbers');
  });

  await t.test('a lone separator starts with a zero', () => {
    assert.equal(press('', ['.'], W).value, '0.');
    assert.equal(press('90', ['.'], W, true).value, '0.', 'also when it replaces a selection');
  });

  await t.test('backspace removes the last character; on a selection it clears', () => {
    assert.equal(press('62.5', ['backspace'], W).value, '62.');
    assert.equal(press('7', ['backspace'], R).value, '');
    assert.equal(press('', ['backspace'], R).value, '');
    assert.equal(press('200', ['backspace'], W, true).value, '', 'selected value is cleared at once');
  });

  await t.test('weight steps by 2.5 and reps by 1', () => {
    assert.equal(press('100', ['inc'], W).value, '102.5');
    assert.equal(press('100', ['dec'], W).value, '97.5');
    assert.equal(press('12', ['inc'], R).value, '13');
    assert.equal(press('12', ['dec'], R).value, '11');
  });

  await t.test('steps start from zero on an empty or invalid field', () => {
    assert.equal(press('', ['inc'], W).value, '2.5');
    assert.equal(press('', ['inc'], R).value, '1');
    assert.equal(press('abc', ['inc'], W).value, '2.5');
  });

  await t.test('steps accept a comma decimal and never go below zero', () => {
    assert.equal(press('72,5', ['inc'], W).value, '75');
    assert.equal(press('1', ['dec'], W).value, '0');
    assert.equal(press('0', ['dec'], R).value, '0');
  });

  await t.test('after a step the next digit replaces the value', () => {
    const stepped = press('100', ['inc'], W);
    assert.equal(stepped.fresh, true);
    assert.equal(press(stepped.value, ['8'], W, stepped.fresh).value, '8');
  });

  await t.test('length is capped so a field cannot grow without bound', () => {
    assert.equal(press('1234', ['5'], R).value, '1234');
    assert.equal(press('1234567', ['8'], W).value, '1234567');
  });

  await t.test('unknown keys leave the value untouched', () => {
    assert.deepEqual(applyKey('60', 'x', { field: 'weightKg', fresh: true }), {
      value: '60',
      fresh: true,
    });
  });
});
