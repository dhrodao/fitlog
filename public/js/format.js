// Locale-safe numeric parsing for user input.
//
// Spanish users type "72,5"; Number("72,5") is NaN, which the old code clamped
// to 0 or null, silently corrupting data. parseDecimalInput accepts both comma
// and dot decimals and common thousands separators, and clearly signals invalid
// input instead of guessing.

export const INVALID = Symbol('invalid-number');

/**
 * Parse a user-entered decimal string tolerant of locale.
 *
 * Rules:
 *   - trims; empty / whitespace -> null (no value entered)
 *   - a single comma OR a single dot is the decimal separator ("72,5" -> 72.5)
 *   - when BOTH separators appear, the LAST one is the decimal and the other is
 *     a thousands separator ("1.234,5" -> 1234.5, "1,234.5" -> 1234.5)
 *   - a separator repeated with no other separator is treated as thousands
 *     ("1.234.567" -> 1234567)
 *   - an optional leading minus is allowed
 *   - anything that does not parse to a finite number -> INVALID
 *
 * @param {string|number|null|undefined} raw
 * @returns {number|null|typeof INVALID}
 */
export function parseDecimalInput(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  // Keep a leading sign, strip spaces used as thousands separators.
  let sign = '';
  if (s[0] === '+' || s[0] === '-') {
    sign = s[0] === '-' ? '-' : '';
    s = s.slice(1);
  }
  s = s.replace(/\s/g, '');

  if (!/^[0-9.,]+$/.test(s) || s === '') return INVALID;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  let normalized;
  if (hasDot && hasComma) {
    // The last separator is the decimal; the other groups thousands.
    const decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    normalized = s.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (hasComma || hasDot) {
    const sep = hasComma ? ',' : '.';
    const count = s.split(sep).length - 1;
    if (count === 1) {
      // Single separator -> decimal.
      normalized = s.replace(sep, '.');
    } else {
      // Repeated single separator -> thousands grouping, drop them.
      normalized = s.split(sep).join('');
    }
  } else {
    normalized = s;
  }

  const value = Number(`${sign}${normalized}`);
  return Number.isFinite(value) ? value : INVALID;
}

/**
 * Parse a non-negative integer from user input (sets, reps). Uses
 * parseDecimalInput then rounds; negatives and invalid input -> INVALID.
 * Empty -> null.
 * @returns {number|null|typeof INVALID}
 */
export function parseIntegerInput(raw) {
  const value = parseDecimalInput(raw);
  if (value === null || value === INVALID) return value;
  if (value < 0) return INVALID;
  return Math.round(value);
}
