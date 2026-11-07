import { Router } from 'express';
import { asyncHandler } from '../http.js';
import { getCatalogImageFile } from '../catalog-images.js';
import {
  getCatalogExercise,
  listCategories,
  searchCatalog,
  getCatalogStatus,
  syncCatalog,
} from '../catalog.js';
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
    offset: req.query.offset,
    category: req.query.category,
  });
  res.json({ exercises: results });
});

router.get('/categories', (req, res) => {
  res.json({ categories: listCategories() });
});

router.get(
  '/image/:id/:index',
  asyncHandler(async (req, res) => {
    const index = Number.parseInt(req.params.index, 10);
    if (index !== 0 && index !== 1) {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    try {
      const image = await getCatalogImageFile(req.params.id, index);
      if (!image) {
        return res.status(404).json({ error: 'Imagen no encontrada' });
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(image.file);
    } catch {
      res.status(502).json({ error: 'No se pudo cargar la imagen' });
    }
  })
);

router.get('/catalog/:id', (req, res) => {
  const exercise = getCatalogExercise(req.params.id);
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
  const exercise = getOrCreateFromCatalog(req.user.id, req.body?.catalogId);
  res.status(201).json({ exercise: serializeExercise(exercise) });
});

router.get('/status', (req, res) => {
  res.json(getCatalogStatus());
});

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const result = await syncCatalog({ force: req.body?.force !== false });
    res.json(result);
  })
);

export default router;
