import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';
import { loginDev, saveMeasurement } from './helpers/fixtures.js';

setupTestEnv();
const { app, db } = await createTestApp();
const { mergeMeasurement } = await import('../server/services/measurements.js');

test.after(() => cleanupTestApp(db));

test('mergeMeasurement — pure merge semantics', async (t) => {
  await t.test('omitted fields preserve stored values', () => {
    const existing = { weight_kg: 80, body_fat: 15, waist_cm: 84, notes: 'x' };
    const merged = mergeMeasurement(existing, { bodyFat: 14 });
    assert.equal(merged.weight_kg, 80);
    assert.equal(merged.body_fat, 14);
    assert.equal(merged.waist_cm, 84);
    assert.equal(merged.notes, 'x');
  });

  await t.test('explicit null clears a field', () => {
    const existing = { weight_kg: 80, body_fat: 15, waist_cm: 84, notes: 'x' };
    const merged = mergeMeasurement(existing, { weightKg: null, notes: null });
    assert.equal(merged.weight_kg, null);
    assert.equal(merged.body_fat, 15);
    assert.equal(merged.notes, null);
  });

  await t.test('empty string clears a field too', () => {
    const existing = { weight_kg: 80, body_fat: null, waist_cm: null, notes: null };
    const merged = mergeMeasurement(existing, { weightKg: '' });
    assert.equal(merged.weight_kg, null);
  });

  await t.test('present values are used', () => {
    const existing = { weight_kg: 80, body_fat: 15, waist_cm: 84, notes: null };
    const merged = mergeMeasurement(existing, { weightKg: 79.5, waistCm: 83 });
    assert.equal(merged.weight_kg, 79.5);
    assert.equal(merged.waist_cm, 83);
    assert.equal(merged.body_fat, 15);
  });

  await t.test('no existing row defaults omitted fields to null', () => {
    const merged = mergeMeasurement(null, { weightKg: 77 });
    assert.equal(merged.weight_kg, 77);
    assert.equal(merged.body_fat, null);
    assert.equal(merged.waist_cm, null);
    assert.equal(merged.notes, null);
  });
});

test('POST /api/measurements — non-destructive upsert', async (t) => {
  const agent = (await import('supertest')).default.agent(app);
  await loginDev(agent);
  const date = '2026-02-10';

  await t.test('partial save keeps omitted fields', async () => {
    await saveMeasurement(agent, { date, weightKg: 80.4 });
    // Recording body fat only must NOT erase the stored weight.
    const after = await saveMeasurement(agent, { date, bodyFat: 15.2 });
    assert.equal(after.weightKg, 80.4);
    assert.equal(after.bodyFat, 15.2);
  });

  await t.test('explicit null clears a field', async () => {
    const res = await agent
      .post('/api/measurements')
      .send({ date, weightKg: null })
      .expect(201);
    assert.equal(res.body.measurement.weightKg, null);
    // body fat set in the previous step survives.
    assert.equal(res.body.measurement.bodyFat, 15.2);
  });

  await t.test('all fields update together', async () => {
    const res = await agent
      .post('/api/measurements')
      .send({ date, weightKg: 79, bodyFat: 14, waistCm: 83 })
      .expect(201);
    assert.equal(res.body.measurement.weightKg, 79);
    assert.equal(res.body.measurement.bodyFat, 14);
    assert.equal(res.body.measurement.waistCm, 83);
  });

  await t.test('a new date inserts a separate row', async () => {
    const other = await saveMeasurement(agent, { date: '2026-02-11', weightKg: 78 });
    assert.equal(other.weightKg, 78);
    const list = await agent.get('/api/measurements').expect(200);
    assert.equal(list.body.measurements.length, 2);
  });

  await t.test('clearing the last measure of a row is rejected', async () => {
    // 2026-02-11 only has weight; clearing it leaves an empty record.
    await agent
      .post('/api/measurements')
      .send({ date: '2026-02-11', weightKg: null })
      .expect(400);
  });

  await t.test('a brand new date with no measures is rejected', async () => {
    await agent
      .post('/api/measurements')
      .send({ date: '2026-03-01' })
      .expect(400);
  });

  await t.test('an invalid date format is rejected', async () => {
    await agent
      .post('/api/measurements')
      .send({ date: '01-03-2026', weightKg: 80 })
      .expect(400);
  });
});
