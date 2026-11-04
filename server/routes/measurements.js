import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { HttpError, toNumber } from '../http.js';

const router = Router();

function serialize(row) {
  return {
    id: row.id,
    date: row.date,
    weightKg: row.weight_kg,
    bodyFat: row.body_fat,
    waistCm: row.waist_cm,
    notes: row.notes,
  };
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      'SELECT * FROM measurements WHERE user_id = ? ORDER BY date ASC, id ASC'
    )
    .all(req.user.id);
  res.json({ measurements: rows.map(serialize) });
});

router.post('/', (req, res) => {
  const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, 'La fecha debe tener formato AAAA-MM-DD');
  }

  const weight = toNumber(req.body?.weightKg);
  const bodyFat = toNumber(req.body?.bodyFat);
  const waist = toNumber(req.body?.waistCm);
  const notes = req.body?.notes ? String(req.body.notes).slice(0, 1000) : null;

  if (weight === null && bodyFat === null && waist === null) {
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
  ).run(req.user.id, date, weight, bodyFat, waist, notes, nowIso());

  const row = db
    .prepare('SELECT * FROM measurements WHERE user_id = ? AND date = ?')
    .get(req.user.id, date);

  res.status(201).json({ measurement: serialize(row) });
});

router.delete('/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM measurements WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user.id);
  if (!info.changes) throw new HttpError(404, 'Medida no encontrada');
  res.json({ ok: true });
});

export default router;
