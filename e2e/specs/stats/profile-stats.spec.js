import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

test.describe('Profile statistics', () => {
  test('switches the chart metric and shows the week totals in the tooltip', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('Stats Press'));

    // One workout in a previous week (20 min, 600 kg of volume) and one in the
    // current week (15 min, 400 kg). The current one omits the dates so the
    // server stamps it at boot time, which always lands in the current bucket.
    const earlier = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await api.seedWorkout({
      clientId: uniqueName('stats-earlier'),
      name: uniqueName('Stats earlier'),
      startedAt: earlier.toISOString(),
      finishedAt: new Date(earlier.getTime() + 20 * 60 * 1000).toISOString(),
      exercises: [
        {
          exerciseId: exercise.id,
          sets: [{ weightKg: 60, reps: 10, completed: true }],
        },
      ],
    });
    await api.seedWorkout({
      clientId: uniqueName('stats-current'),
      name: uniqueName('Stats current'),
      durationSeconds: 15 * 60,
      exercises: [
        {
          exerciseId: exercise.id,
          sets: [{ weightKg: 80, reps: 5, completed: true }],
        },
      ],
    });

    await page.goto('/#/profile');
    await expect(page.locator('[data-chart-title]')).toHaveText('Duración');

    const stats = page.locator('.stat-grid .stat');
    await expect(stats.nth(0).locator('.value')).toHaveText('2');
    await expect(stats.nth(1).locator('.value')).toHaveText('1000');
    await expect(stats.nth(2).locator('.value')).toHaveText('2');
    await expect(
      page.locator('[data-chart] svg[aria-label="Gráfico de progreso"]')
    ).toBeVisible();

    await page.locator('[data-metric="volume"]').click();
    await expect(page.locator('[data-chart-title]')).toHaveText('Volumen');

    const hits = page.locator('[data-chart] .chart-hit');
    await hits.last().hover();
    const tooltip = page.locator('[data-chart-tooltip]');
    await expect(tooltip).toBeVisible();
    const rows = tooltip.locator('.ct-row');
    await expect(rows.filter({ hasText: 'Entrenos' }).locator('strong')).toHaveText(
      '1'
    );
    await expect(rows.filter({ hasText: 'Tiempo' }).locator('strong')).toHaveText(
      '15 min'
    );
    await expect(rows.filter({ hasText: 'Volumen' }).locator('strong')).toHaveText(
      '400 kg'
    );
    await expect(rows.filter({ hasText: 'Series' }).locator('strong')).toHaveText(
      '1'
    );

    await page.locator('[data-metric="reps"]').click();
    await expect(page.locator('[data-chart-title]')).toHaveText('Repeticiones');
  });
});
