import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import { goOffline } from '../../fixtures/pwa.js';

test.describe('Inline offline states', () => {
  test(
    'each data view keeps its header and offers a retry instead of crashing',
    { tag: '@pwa' },
    async ({ login, reset, api, context, page }) => {
      const exercise = await api.seedExercise(uniqueName('Offline Press'));
      const workout = await api.seedWorkout({
        clientId: uniqueName('offline-detail'),
        name: uniqueName('Entreno sin conexión'),
        startedAt: '2026-05-04T10:00:00.000Z',
        finishedAt: '2026-05-04T10:30:00.000Z',
        exercises: [
          {
            exerciseId: exercise.id,
            sets: [{ weightKg: 50, reps: 8, completed: true }],
          },
        ],
      });

      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();

      // Stay inside the running app: a full reload would boot offline and show
      // the cold-start state instead of the per-view blocks tested here.
      await goOffline(context, page);

      const views = [
        {
          hash: '/workouts',
          header: 'Historial',
          text: 'Tu historial aparecerá cuando vuelvas a estar en línea.',
        },
        {
          hash: '/exercises',
          header: 'Ejercicios',
          text: 'El catálogo de ejercicios aparecerá cuando vuelvas a estar en línea.',
        },
        {
          hash: '/measurements',
          header: 'Medidas',
          text: 'Tu progreso de peso aparecerá cuando vuelvas a estar en línea.',
        },
        {
          hash: '/profile',
          header: 'Información',
          text: 'Tus estadísticas aparecerán cuando vuelvas a estar en línea.',
        },
        {
          hash: `/workouts/${workout.id}`,
          header: 'Entrenamiento',
          text: 'Este entrenamiento aparecerá cuando vuelvas a estar en línea.',
        },
      ];

      for (const view of views) {
        await page.evaluate((hash) => {
          location.hash = hash;
        }, view.hash);

        await expect(
          page.getByText(view.header, { exact: true }).first(),
          `header for ${view.hash}`
        ).toBeVisible();
        await expect(
          page.getByText(view.text),
          `offline copy for ${view.hash}`
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Reintentar' }).first(),
          `retry for ${view.hash}`
        ).toBeVisible();
        // No login redirect and no full-screen error while the session is alive.
        await expect(page.locator('[data-dev-login]')).toHaveCount(0);
        await expect(page.getByText('No se pudo cargar')).toHaveCount(0);
      }
    }
  );
});
