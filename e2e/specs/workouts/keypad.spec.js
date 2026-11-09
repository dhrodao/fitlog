import { test, expect } from '../../fixtures/index.js';
import {
  addExerciseFromPicker,
  addSet,
  exerciseBlocks,
  startEmptyWorkout,
} from '../../fixtures/workout-actions.js';

const NAME_A = 'Keypad Press A';
const NAME_B = 'Keypad Press B';

async function twoExercises(page, api) {
  await api.seedExercise(NAME_A);
  await api.seedExercise(NAME_B);
  await startEmptyWorkout(page);
  await addExerciseFromPicker(page, NAME_A);
  await addExerciseFromPicker(page, NAME_B);
  const blockA = exerciseBlocks(page).filter({ hasText: NAME_A });
  const blockB = exerciseBlocks(page).filter({ hasText: NAME_B });
  // Normalise: two sets on A, one on B, whatever the default is.
  while ((await blockA.locator('[data-set-id]').count()) < 2) await addSet(page, blockA);
  while ((await blockB.locator('[data-set-id]').count()) < 1) await addSet(page, blockB);
  return { blockA, blockB };
}

const key = (page, name) => page.locator(`.keypad [data-key="${name}"]`);

async function press(page, keys) {
  for (const name of keys) await key(page, name).tap();
}

test.describe('On-screen keypad on a touch device', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('replaces the system keyboard and walks through the sets', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { blockA, blockB } = await twoExercises(page, api);
    const setA1 = blockA.locator('[data-set-id]').nth(0);
    const setA2 = blockA.locator('[data-set-id]').nth(1);
    const setB1 = blockB.locator('[data-set-id]').first();
    const keypad = page.locator('.keypad');

    // The system keyboard is suppressed on the fields.
    await expect(setA1.locator('[data-field="weightKg"]')).toHaveAttribute('inputmode', 'none');
    await expect(setA1.locator('[data-field="reps"]')).toHaveAttribute('inputmode', 'none');
    await expect(keypad).not.toHaveClass(/open/);

    // Tapping Kg opens the keypad and hides the bottom navigation.
    await setA1.locator('[data-field="weightKg"]').tap();
    await expect(keypad).toHaveClass(/open/);
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeHidden();
    await expect(key(page, 'action')).toHaveAccessibleName('Siguiente: repeticiones');

    // Typing, decimals and the +/- steps (2.5 kg).
    await press(page, ['6', '0', '.', '5']);
    await expect(setA1.locator('[data-field="weightKg"]')).toHaveValue('60.5');
    await press(page, ['inc']);
    await expect(setA1.locator('[data-field="weightKg"]')).toHaveValue('63');
    await press(page, ['dec']);
    await expect(setA1.locator('[data-field="weightKg"]')).toHaveValue('60.5');
    // After a step the value counts as selected: the next digit replaces it and
    // backspace on a selection clears it.
    await press(page, ['7', '2', 'backspace']);
    await expect(setA1.locator('[data-field="weightKg"]')).toHaveValue('7');
    await press(page, ['backspace', '6', '0', '.']);
    await expect(setA1.locator('[data-field="weightKg"]')).toHaveValue('60.');

    // Arrow: Kg -> Reps of the same set. Reps has no decimal key and steps by 1.
    await key(page, 'action').tap();
    await expect(setA1.locator('[data-field="reps"]')).toBeFocused();
    await expect(key(page, '.')).toBeHidden();
    await expect(key(page, 'action')).toHaveAccessibleName('Completar serie');
    await press(page, ['1', '1', 'inc']);
    await expect(setA1.locator('[data-field="reps"]')).toHaveValue('12');

    // Check: completes the set and lands on Kg of the next set of A.
    await key(page, 'action').tap();
    await expect(setA1.locator('[data-toggle]')).toHaveClass(/checked/);
    await expect(setA2.locator('[data-field="weightKg"]')).toBeFocused();
    await expect(keypad).toHaveClass(/open/);

    // The rest countdown started by that completion stays visible, docked
    // right above the keypad rather than hidden behind it.
    const rest = page.locator('[data-rest-timer]');
    await expect(rest).toBeVisible();
    const restBox = await rest.boundingBox();
    const keypadBox = await keypad.boundingBox();
    expect(restBox.y + restBox.height).toBeLessThanOrEqual(keypadBox.y);
    const centerHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-rest-timer]') != null, {
      x: restBox.x + restBox.width / 2,
      y: restBox.y + restBox.height / 2,
    });
    expect(centerHit, 'the rest timer is not covered by the keypad').toBe(true);

    // It is also usable: +15s and skip work without closing the keypad or
    // taking the focus away from the field being edited.
    const restSeconds = async () => {
      const [m, s] = (await page.locator('[data-rest-count]').innerText()).split(':').map(Number);
      return m * 60 + s;
    };
    const before = await restSeconds();
    await page.locator('[data-rest-add]').tap();
    await expect.poll(restSeconds).toBeGreaterThanOrEqual(before + 10);
    await expect(keypad).toHaveClass(/open/);
    await expect(setA2.locator('[data-field="weightKg"]')).toBeFocused();
    await page.locator('[data-rest-skip]').tap();
    await expect(rest).toBeHidden();
    await expect(keypad).toHaveClass(/open/);
    await expect(setA2.locator('[data-field="weightKg"]')).toBeFocused();

    // Walk every remaining set in order. Completing a set must land on Kg of
    // the next one: the next set of the exercise or, after its last set, the
    // first set of the next exercise. After the very last set the keypad closes.
    const weights = page.locator('[data-exercises] [data-field="weightKg"]');
    const total = await weights.count();
    for (let i = 1; i < total; i += 1) {
      await expect(weights.nth(i)).toBeFocused();
      await press(page, ['5', '0']);
      await key(page, 'action').tap();
      await expect(page.locator('[data-exercises] [data-field="reps"]').nth(i)).toBeFocused();
      await press(page, ['8']);
      await key(page, 'action').tap();
      await expect(page.locator('[data-exercises] [data-toggle]').nth(i)).toHaveClass(/checked/);
      if (i < total - 1) await expect(weights.nth(i + 1)).toBeFocused();
    }
    // The first set of B was reached through the exercise boundary.
    await expect(setB1.locator('[data-toggle]')).toHaveClass(/checked/);
    await expect(keypad).not.toHaveClass(/open/);
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();

    // Every value went through the normal input handling (stats were updated).
    await expect(page.locator('[data-stat-sets]')).toHaveText(String(total));
  });

  test('the hide key and a tap elsewhere close it; completed sets stay completed', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { blockA } = await twoExercises(page, api);
    const setA1 = blockA.locator('[data-set-id]').first();
    const keypad = page.locator('.keypad');

    await setA1.locator('[data-field="weightKg"]').tap();
    await expect(keypad).toHaveClass(/open/);
    await key(page, 'hide').tap();
    await expect(keypad).not.toHaveClass(/open/);

    await setA1.locator('[data-field="reps"]').tap();
    await expect(keypad).toHaveClass(/open/);
    await page.locator('.workout-timer-strip').tap();
    await expect(keypad).not.toHaveClass(/open/);

    // Pressing the check key on an already completed set does not un-complete it.
    await setA1.locator('[data-toggle]').tap();
    await expect(setA1.locator('[data-toggle]')).toHaveClass(/checked/);
    await setA1.locator('[data-field="reps"]').tap();
    await key(page, 'action').tap();
    await expect(setA1.locator('[data-toggle]')).toHaveClass(/checked/);
  });
});

test.describe('On-screen keypad when editing a finished workout', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('saves what is typed and completes sets from the keypad', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const a = await api.seedExercise('Keypad Edit A');
    const b = await api.seedExercise('Keypad Edit B');
    const workout = await api.seedWorkout({
      clientId: `keypad-edit-${Date.now()}`,
      name: 'Entreno editable',
      startedAt: '2026-01-01T10:00:00.000Z',
      finishedAt: '2026-01-01T10:45:00.000Z',
      exercises: [
        { exerciseId: a.id, sets: [{ weightKg: 40, reps: 5, completed: false }, { weightKg: 40, reps: 5, completed: false }] },
        { exerciseId: b.id, sets: [{ weightKg: 20, reps: 5, completed: false }] },
      ],
    });

    await page.goto(`/#/workouts/${workout.id}`);
    await page.getByRole('button', { name: 'Opciones' }).tap();
    await page.getByText('Editar entrenamiento').tap();

    const weights = page.locator('[data-exercises] [data-field="weightKg"]');
    const reps = page.locator('[data-exercises] [data-field="reps"]');
    const toggles = page.locator('[data-exercises] [data-toggle]');
    const keypad = page.locator('.keypad');
    await expect(weights).toHaveCount(3);
    await expect(weights.first()).toHaveAttribute('inputmode', 'none');

    // Walk the three sets: type weight and reps, then the check key.
    await weights.first().tap();
    await expect(keypad).toHaveClass(/open/);
    for (let i = 0; i < 3; i += 1) {
      await expect(weights.nth(i)).toBeFocused();
      await press(page, ['7', '2', '.', '5']);
      await key(page, 'action').tap();
      await expect(reps.nth(i)).toBeFocused();
      await press(page, ['9']);
      // The check key sends the typed reps together with the completion.
      const completion = page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && /\/sets\//.test(r.url()) && r.request().postDataJSON()?.completed === true
      );
      await key(page, 'action').tap();
      const sent = (await completion).request().postDataJSON();
      expect(sent).toMatchObject({ weightKg: 72.5, reps: 9, completed: true });
      await expect(toggles.nth(i)).toHaveClass(/checked/);
    }
    await expect(keypad).not.toHaveClass(/open/);

    // Persisted: reload the editor and read the values back from the server.
    await page.goto(`/#/workouts/${workout.id}`);
    await page.reload();
    await page.getByRole('button', { name: 'Opciones' }).tap();
    await page.getByText('Editar entrenamiento').tap();
    for (let i = 0; i < 3; i += 1) {
      await expect(weights.nth(i)).toHaveValue('72.5');
      await expect(reps.nth(i)).toHaveValue('9');
      await expect(toggles.nth(i)).toHaveClass(/checked/);
    }
  });
});

test.describe('Desktop keeps the native keyboard', () => {
  test('no keypad and decimal / numeric input modes', async ({ login, reset, api, page }) => {
    const { blockA } = await twoExercises(page, api);
    const setA1 = blockA.locator('[data-set-id]').first();
    await expect(setA1.locator('[data-field="weightKg"]')).toHaveAttribute('inputmode', 'decimal');
    await expect(setA1.locator('[data-field="reps"]')).toHaveAttribute('inputmode', 'numeric');
    await setA1.locator('[data-field="weightKg"]').click();
    await expect(page.locator('.keypad')).toHaveCount(0);
  });
});
