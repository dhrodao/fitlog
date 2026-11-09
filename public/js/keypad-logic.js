// Pure editing rules for the on-screen numeric keypad used in the active
// workout. No DOM here so the behaviour can be unit tested.
//
// `fresh` models the "everything is selected" state a field has right after it
// is focused (or after a +/- step): the next digit replaces the value instead
// of being appended to it, like typing over a selection.

export const WEIGHT_STEP = 2.5;
export const REPS_STEP = 1;

const MAX_LENGTH = { weightKg: 7, reps: 4 };

function toNumber(raw) {
  const n = Number(String(raw ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Apply one key press to a field value.
 *
 * @param {string} current  Current text of the field.
 * @param {string} key      '0'-'9', '.', 'backspace', 'inc' or 'dec'.
 * @param {{ field: 'weightKg'|'reps', fresh?: boolean }} options
 * @returns {{ value: string, fresh: boolean }}
 */
export function applyKey(current, key, { field, fresh = false } = {}) {
  const isReps = field === 'reps';
  const text = String(current ?? '');
  const base = fresh ? '' : text;

  if (key === 'inc' || key === 'dec') {
    const step = isReps ? REPS_STEP : WEIGHT_STEP;
    let next = Math.max(0, toNumber(text) + (key === 'inc' ? step : -step));
    next = isReps ? Math.round(next) : Math.round(next * 100) / 100;
    return { value: String(next), fresh: true };
  }

  if (key === 'backspace') {
    return { value: fresh ? '' : base.slice(0, -1), fresh: false };
  }

  if (key === '.') {
    // Reps are whole numbers; weight allows a single decimal separator.
    if (isReps || base.includes('.') || base.includes(',')) {
      return { value: text, fresh };
    }
    const value = base === '' ? '0.' : `${base}.`;
    return value.length > MAX_LENGTH.weightKg
      ? { value: text, fresh }
      : { value, fresh: false };
  }

  if (/^[0-9]$/.test(key)) {
    // "0" followed by a digit is just that digit ("05" -> "5").
    const value = base === '0' ? key : base + key;
    return value.length > MAX_LENGTH[isReps ? 'reps' : 'weightKg']
      ? { value: text, fresh }
      : { value, fresh: false };
  }

  return { value: text, fresh };
}
