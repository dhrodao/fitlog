import { Router } from 'express';
import { asyncHandler } from '../http.js';
import {
  getCatalogExercise,
  listCategories,
  searchCatalog,
  getWgerStatus,
  syncWger,
} from '../wger.js';
import {
  getOrCreateByName,
  getOrCreateFromCatalog,
  listUserExercises,
  serializeExercise,
} from '../services/exercises.js';

const router = Router();

router.get('/search', (req, res) => {
  const results = searchCatalog(req.query.q, {
    limit: req.query.limit,
    category: req.query.category,
  });
  res.json({ exercises: results });
});

router.get('/categories', (req, res) => {
  res.json({ categories: listCategories() });
});

router.get('/catalog/:id', (req, res) => {
  const exercise = getCatalogExercise(Number(req.params.id));
  if (!exercise) return res.status(404).json({ error: 'Ejercicio no encontrado' });
  res.json({ exercise });
});

router.get('/mine', (req, res) => {
  res.json({
    exercises: listUserExercises(req.user.id, req.query.q || ''),
  });
});

router.post('/custom', (req, res) => {
  const exercise = getOrCreateByName(req.user.id, req.body?.name, {
    category: req.body?.category || 'Personalizado',
    imageUrl: req.body?.imageUrl || null,
  });
  res.status(201).json({ exercise: serializeExercise(exercise) });
});

router.post('/from-catalog', (req, res) => {
  const exercise = getOrCreateFromCatalog(req.user.id, Number(req.body?.catalogId));
  res.status(201).json({ exercise: serializeExercise(exercise) });
});

router.get('/status', (req, res) => {
  res.json(getWgerStatus());
});

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const result = await syncWger({ force: req.body?.force !== false });
    res.json(result);
  })
);

export default router;
