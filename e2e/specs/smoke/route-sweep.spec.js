import { test, expect } from '../../fixtures/index.js';

const ROUTES = [
  { hash: '/#/', landmark: (page) => page.getByRole('heading', { name: 'Atleta', exact: true }) },
  { hash: '/#/routines', landmark: (page) => page.getByRole('heading', { name: 'Entrenamiento', exact: true }) },
  { hash: '/#/routines/new', landmark: (page) => page.getByText('Nueva rutina', { exact: true }) },
  { hash: '/#/workouts', landmark: (page) => page.getByRole('heading', { name: 'Historial' }) },
  { hash: '/#/exercises', landmark: (page) => page.getByPlaceholder('Buscar ejercicio...') },
  { hash: '/#/measurements', landmark: (page) => page.getByRole('heading', { name: 'Nuevo registro' }) },
  { hash: '/#/profile', landmark: (page) => page.getByRole('heading', { name: 'Información' }) },
  {
    hash: '/#/workout/active',
    landmark: (page) => page.getByRole('heading', { name: 'No hay entrenamiento activo' }),
  },
];

test.describe('Top-level route sweep', () => {
  test(
    'every top-level route renders its own landmark without loading errors',
    { tag: '@smoke' },
    async ({ login, reset, page }) => {
      for (const route of ROUTES) {
        await page.goto(route.hash);
        await expect(route.landmark(page), `landmark for ${route.hash}`).toBeVisible();
        await expect(page.getByText(/No se pudo cargar/)).toHaveCount(0);
      }
    }
  );
});
