// Weekly statistics are bucketed by the user's local calendar. A workout just
// after local midnight on Monday belongs to the new week even when its UTC
// instant is still Sunday. The time zone only moves the bucket boundary;
// instants stay in UTC.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';
import { loginDev, createExercise } from './helpers/fixtures.js';

setupTestEnv();
const { app, db, agent } = await createTestApp();
test.after(() => cleanupTestApp(db));

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

function seedWorkout(clientId, startedAt, durationSeconds, exerciseId, weightKg) {
  return agent
    .post('/api/workouts/sync')
    .send({
      clientId,
      name: clientId,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date(startedAt.getTime() + durationSeconds * 1000).toISOString(),
      exercises: [
        {
          exerciseId,
          sets: [{ weightKg, reps: 10, completed: true }],
        },
      ],
    })
    .expect(201);
}

test('weekly buckets follow the local Monday', async (t) => {
  await loginDev(agent);
  const exercise = await createExercise(agent, { name: 'Sentadilla TZ' });
  const monday = currentLocalMonday(TZ);

  // 00:30 local on Monday is still Sunday in UTC for Europe/Madrid.
  const justAfterLocalMidnight = zonedToUtc(
    { ...monday, hour: 0, minute: 30 },
    TZ
  );
  const mondayNoon = zonedToUtc({ ...monday, hour: 12, minute: 0 }, TZ);

  await t.test('UTC instant of the first workout is the previous day', () => {
    assert.equal(justAfterLocalMidnight.getUTCDay(), 0);
    assert.equal(partsInZone(justAfterLocalMidnight, TZ).day, monday.day);
  });

  await seedWorkout('tz-boundary', justAfterLocalMidnight, 600, exercise.id, 60);
  await seedWorkout('tz-midday', mondayNoon, 300, exercise.id, 80);

  await t.test('local weeks count both workouts in the current week', async () => {
    const res = await agent
      .get(`/api/stats/overview?period=3m&tz=${encodeURIComponent(TZ)}`)
      .expect(200);

    const current = res.body.weekly.at(-1);
    assert.equal(current.workouts, 2);
    assert.equal(current.durationSeconds, 900);
    assert.equal(current.sets, 2);
    assert.equal(current.volume, 1400);
    assert.equal(res.body.thisWeekSeconds, 900);
  });

  await t.test('a UTC week would split the midnight workout off', async () => {
    const res = await agent.get('/api/stats/overview?period=3m').expect(200);

    const current = res.body.weekly.at(-1);
    assert.equal(current.workouts, 1, 'only the midday workout stays in the UTC week');
    assert.equal(current.durationSeconds, 300);
  });

  await t.test('an invalid time zone falls back to UTC', async () => {
    const invalid = await agent
      .get('/api/stats/overview?period=3m&tz=Not%2FAZone')
      .expect(200);
    const utc = await agent.get('/api/stats/overview?period=3m').expect(200);

    assert.deepEqual(invalid.body.weekly, utc.body.weekly);
  });
});
