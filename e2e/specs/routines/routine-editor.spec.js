import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

const editorNames = (page) =>
  page.locator('.editor-exercise .name').allTextContents();

async function seedThreeExerciseRoutine(api) {
  const exercises = [];
  for (const label of ['Edit A', 'Edit B', 'Edit C']) {
    exercises.push(await api.seedExercise(uniqueName(label)));
  }
  const routine = await api.seedRoutine({
    name: uniqueName('Routine Edit'),
    folder: 'Tirón',
    exercises: exercises.map((exercise) => ({
      exerciseId: exercise.id,
      targetSets: 3,
    })),
  });
  return { exercises, routine };
}

async function openEditorFromDetail(page, routine) {
  await page.goto(`/#/routines/${routine.id}`);
  await page.locator('[data-menu]').click();
  const sheet = page.getByRole('dialog');
  await expect(
    sheet.getByRole('heading', { name: routine.name })
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'Editar rutina' }).click();
  await expect(page).toHaveURL(new RegExp(`#/routines/${routine.id}/edit$`));
}

test.describe('Editing a routine', () => {
  test('renames, changes targets, reorders and removes an exercise', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { exercises, routine } = await seedThreeExerciseRoutine(api);
    const [a, b, c] = exercises;
    const newName = uniqueName('Routine Edited');

    await openEditorFromDetail(page, routine);
    expect(await editorNames(page)).toEqual([a.name, b.name, c.name]);

    await page.locator('[data-input="name"]').fill(newName);
    await page
      .locator('.editor-exercise')
      .nth(0)
      .locator('[data-field="targetSets"]')
      .fill('5');
    await page
      .locator('.editor-exercise')
      .nth(2)
      .locator('[data-move="up"]')
      .click();
    await expect.poll(() => editorNames(page)).toEqual([a.name, c.name, b.name]);

    await page
      .locator('.editor-exercise')
      .filter({ hasText: b.name })
      .locator('[data-remove]')
      .click();
    await expect.poll(() => editorNames(page)).toEqual([a.name, c.name]);

    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `/api/routines/${routine.id}`
    );
    await page.locator('[data-save]').click();
    await saved;

    await expect(page.getByText('Rutina guardada')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/routines/${routine.id}$`));
    await expect(page.getByRole('heading', { name: newName })).toBeVisible();
    await expect(page.locator('.routine-exercise')).toHaveCount(2);
    await expect(page.locator('.routine-exercise').nth(0)).toContainText(
      a.name
    );
    await expect(page.locator('.routine-exercise').nth(0)).toContainText(
      '5 series'
    );
    await expect(page.locator('.routine-exercise').nth(1)).toContainText(
      c.name
    );

    await page.reload();
    await expect(page.getByRole('heading', { name: newName })).toBeVisible();
    await expect(page.locator('.routine-exercise')).toHaveCount(2);

    await page.goto('/#/routines');
    await expect(
      page.locator('.routine-card').filter({ hasText: newName })
    ).toContainText('2 ejercicios');
  });
});

test.describe('Routine editor validation', () => {
  test('requires a name and at least one exercise without creating anything', async ({
    login,
    reset,
    context,
    page,
  }) => {
    const listRoutines = async () => {
      const response = await context.request.get('/api/routines');
      return (await response.json()).routines;
    };

    const before = await listRoutines();
    await page.goto('/#/routines/new');

    await page.locator('[data-save]').click();
    await expect(
      page.getByText('Ponle un nombre a la rutina')
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/routines\/new$/);

    await page.locator('[data-input="name"]').fill(uniqueName('Routine Invalid'));
    await page.locator('[data-save]').click();
    await expect(
      page.getByText('Añade al menos un ejercicio')
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/routines\/new$/);

    expect(await listRoutines()).toHaveLength(before.length);
  });
});

test.describe('Leaving the routine editor', () => {
  test('warns about unsaved changes and can stay or discard them', async ({
    login,
    reset,
    page,
  }) => {
    await page.goto('/#/routines/new');

    // Without changes, leaving goes straight back to the list.
    await page.locator('[data-cancel]').click();
    await expect(page).toHaveURL(/#\/routines$/);
    await expect(
      page.getByRole('heading', { name: 'Entrenamiento', exact: true })
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/#/routines/new');
    const name = uniqueName('Routine Dirty');
    await page.locator('[data-input="name"]').fill(name);

    await page.locator('[data-cancel]').click();
    let dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Descartar cambios' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Seguir editando' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/routines\/new$/);
    await expect(page.locator('[data-input="name"]')).toHaveValue(name);

    await page.locator('[data-cancel]').click();
    dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Descartar cambios' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Descartar' }).click();
    await expect(page).toHaveURL(/#\/routines$/);
  });
});
