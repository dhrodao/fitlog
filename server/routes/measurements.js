import { Router } from 'express';
import { db } from '../db.js';
import { HttpError } from '../http.js';
import {
  serializeMeasurement,
  upsertMeasurement,
} from '../services/measurements.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      'SELECT * FROM measurements WHERE user_id = ? ORDER BY date ASC, id ASC'
    )
    .all(req.user.id);
  res.json({ measurements: rows.map(serializeMeasurement) });
});

router.post('/', (req, res) => {
  const row = upsertMeasurement(req.user.id, req.body || {});
  res.status(201).json({ measurement: serializeMeasurement(row) });
});

router.delete('/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM measurements WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user.id);
  if (!info.changes) throw new HttpError(404, 'Medida no encontrada');
  res.json({ ok: true });
});

export default router;
