import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

const TZ = 'Europe/Madrid';

function partsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type) => Number(parts.find((item) => item.type === type).value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

// Convert a wall-clock time in `timeZone` to the UTC instant that displays it.
function zonedToUtc({ year, month, day, hour, minute }, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall;
  for (let i = 0; i < 2; i += 1) {
    const parts = partsInZone(new Date(instant), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    );
    instant = wall - (asUtc - instant);
  }
  return new Date(instant);
}

function currentLocalMonday(timeZone) {
  const now = partsInZone(new Date(), timeZone);
  const date = new Date(Date.UTC(now.year, now.month - 1, now.day));
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - sinceMonday);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addDays({ year, month, day }, days) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

test.describe('Home weekly statistics', () => {
  test('counts a workout after local midnight in the new week', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('Weekly Press'));
    const monday = currentLocalMonday(TZ);
    const previousMonday = addDays(monday, -14);

    // Europe/Madrid is ahead of UTC, so 00:30 on Monday is still Sunday in
    // UTC. Local bucketing must put it in the new week, not the previous one.
    const justAfterLocalMidnight = zonedToUtc(
      { ...monday, hour: 0, minute: 30 },
      TZ
    );
    const mondayNoon = zonedToUtc({ ...monday, hour: 12, minute: 0 }, TZ);
    const previousNoon = zonedToUtc(
      { ...previousMonday, hour: 12, minute: 0 },
      TZ
    );

    const seed = async (clientId, startedAt, durationSeconds, weightKg) => {
      await api.seedWorkout({
        clientId: uniqueName(clientId),
        name: clientId,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date(
          startedAt.getTime() + durationSeconds * 1000
        ).toISOString(),
        exercises: [
          {
            exerciseId: exercise.id,
            sets: [{ weightKg, reps: 10, completed: true }],
          },
        ],
      });
    };

    await seed('weekly-midnight', justAfterLocalMidnight, 600, 60);
    await seed('weekly-midday', mondayNoon, 300, 80);
    await seed('weekly-previous', previousNoon, 1500, 50);

    await page.goto('/#/');

    await expect(page.locator('[data-week-label]')).toHaveText('Esta semana');
    await expect(page.locator('[data-week-big]')).toHaveText('15 min');
    await expect(page.locator('[data-stat="a"]')).toHaveText('3');
    await expect(page.locator('[data-stat="b"]')).toHaveText('1900 kg');
    await expect(page.locator('[data-stat="c"]')).toHaveText('3');

    const currentWeek = page.locator('.week-bar').last();
    await expect(currentWeek).toHaveClass(/\bhas\b/);
    await currentWeek.click();

    await expect(page.locator('[data-week-big]')).toHaveText('15 min');
    await expect(page.locator('[data-stat="a"]')).toHaveText('2');
    await expect(page.locator('[data-stat-l="a"]')).toHaveText('Entrenos');
    await expect(page.locator('[data-stat="b"]')).toHaveText('1400 kg');
    await expect(page.locator('[data-stat-l="b"]')).toHaveText('Volumen');
    await expect(page.locator('[data-stat="c"]')).toHaveText('2');
    await expect(page.locator('[data-stat-l="c"]')).toHaveText('Series');
    await expect(page.locator('[data-week-label]')).not.toHaveText('Esta semana');

    const previousWeek = page
      .locator('.week-bar')
      .filter({ hasText: `${previousMonday.day}/${previousMonday.month}` });
    await expect(previousWeek).toHaveCount(1);
    await previousWeek.click();

    await expect(page.locator('[data-week-big]')).toHaveText('25 min');
    await expect(page.locator('[data-stat="a"]')).toHaveText('1');
    await expect(page.locator('[data-stat="b"]')).toHaveText('500 kg');
    await expect(page.locator('[data-stat="c"]')).toHaveText('1');

    await currentWeek.click();
    await expect(page.locator('[data-week-label]')).not.toHaveText('Esta semana');
    await currentWeek.click();
    await expect(page.locator('[data-week-label]')).toHaveText('Esta semana');
    await expect(page.locator('[data-week-big]')).toHaveText('15 min');
    await expect(page.locator('[data-stat="a"]')).toHaveText('3');
    await expect(page.locator('[data-stat-l="a"]')).toHaveText('Entrenos (3m)');
    await expect(page.locator('[data-stat="b"]')).toHaveText('1900 kg');
  });
});
