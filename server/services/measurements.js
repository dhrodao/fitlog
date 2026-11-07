import { db, nowIso } from '../db.js';
import { HttpError, toNumber } from '../http.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Numeric measurement fields, mapping the API name to its DB column.
const NUMERIC_FIELDS = [
  { key: 'weightKg', column: 'weight_kg' },
  { key: 'bodyFat', column: 'body_fat' },
  { key: 'waistCm', column: 'waist_cm' },
];

export function serializeMeasurement(row) {
  return {
    id: row.id,
    date: row.date,
    weightKg: row.weight_kg,
    bodyFat: row.body_fat,
    waistCm: row.waist_cm,
    notes: row.notes,
  };
}

function normalizeNumeric(value) {
  // Explicit null/'' clears the field; any other value is parsed as a number.
  if (value === null || value === '') return null;
  const num = toNumber(value);
  return num;
}

function normalizeNotes(value) {
  if (value === null || value === '') return null;
  return String(value).slice(0, 1000);
}

/**
 * Merge an incoming partial measurement onto the existing stored row.
 *
 * Semantics (per field):
 *   - omitted (key not present in `body`) -> keep the stored value
 *   - present and null/'' -> clear the value
 *   - present with a value -> use the new value
 *
 * `existing` may be null (new date); omitted fields then default to null.
 * Returns a plain object with DB columns, ready to upsert.
 */
export function mergeMeasurement(existing, body) {
  const merged = {
    weight_kg: existing ? existing.weight_kg : null,
    body_fat: existing ? existing.body_fat : null,
    waist_cm: existing ? existing.waist_cm : null,
    notes: existing ? existing.notes : null,
  };

  for (const { key, column } of NUMERIC_FIELDS) {
    if (Object.hasOwn(body, key)) {
      merged[column] = normalizeNumeric(body[key]);
    }
  }
  if (Object.hasOwn(body, 'notes')) {
    merged.notes = normalizeNotes(body.notes);
  }

  return merged;
}

/**
 * Upsert a measurement for (userId, date) applying non-destructive merge.
 * Throws HttpError(400) on a bad date or if the merged record has no measure.
 */
export function upsertMeasurement(userId, body) {
  const date = String(body?.date || new Date().toISOString().slice(0, 10));
  if (!DATE_RE.test(date)) {
    throw new HttpError(400, 'La fecha debe tener formato AAAA-MM-DD');
  }

  const existing = db
    .prepare('SELECT * FROM measurements WHERE user_id = ? AND date = ?')
    .get(userId, date);

  const merged = mergeMeasurement(existing, body || {});

  if (
    merged.weight_kg === null &&
    merged.body_fat === null &&
    merged.waist_cm === null
  ) {
    throw new HttpError(400, 'Añade al menos una medida');
  }

  db.prepare(
    `INSERT INTO measurements (user_id, date, weight_kg, body_fat, waist_cm, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       weight_kg = excluded.weight_kg,
       body_fat = excluded.body_fat,
       waist_cm = excluded.waist_cm,
       notes = excluded.notes`
  ).run(
    userId,
    date,
    merged.weight_kg,
    merged.body_fat,
    merged.waist_cm,
    merged.notes,
    nowIso()
  );

  return db
    .prepare('SELECT * FROM measurements WHERE user_id = ? AND date = ?')
    .get(userId, date);
}
