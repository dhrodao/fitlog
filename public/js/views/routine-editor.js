import { api, errorMessage } from '../api.js';
import { openExercisePicker } from '../exercise-picker.js';
import {
  confirmDialog,
  connectionNeeded,
  esc,
  icon,
  setLoading,
  toast,
} from '../ui.js';

let idSeq = 1;

export async function render(container, ctx, params) {
  const id = params.id;
  const editing = id != null;

  // Creating/editing routines offline is not supported (saving needs the
  // server). When the browser knows it is offline, show a clear notice instead
  // of a form that would only fail on save. Edit-by-URL while offline is also
  // caught by the detail fetch below (status 0 -> error screen).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const backHref = editing ? `/routines/${id}` : '/routines';
    container.innerHTML = `
      <div class="view">
        <div class="topbar">
          <a class="icon-btn surface" href="#${backHref}" data-link="${backHref}" aria-label="Volver">${icon('arrowLeft', 19)}</a>
          <div class="topbar-title">${editing ? 'Editar rutina' : 'Nueva rutina'}</div>
          <span style="width:40px"></span>
        </div>
        ${connectionNeeded('Crear y editar rutinas necesita conexión. Vuelve a intentarlo cuando estés en línea.', 'data-retry')}
      </div>`;
    container.querySelector('[data-retry]')?.addEventListener('click', () => ctx.refresh());
    return;
  }

  const form = { name: '', description: '', folder: '' };
  let exercises = [];

  if (editing) {
    try {
      const { routine } = await api.routines.detail(id, '3m');
      // Imported routines are read-only: block the editor if reached by URL.
      if (routine.source === 'hevy') {
        container.innerHTML = `
          <div class="empty">
            <div class="empty-icon">${icon('eye', 24)}</div>
            <h3>Rutina de solo lectura</h3>
            <p>Esta rutina se importó de Hevy y no se puede editar, porque la próxima sincronización sobrescribiría los cambios. Duplícala para crear una copia editable.</p>
            <a class="btn btn-secondary btn-sm" href="#/routines/${id}" data-link="/routines/${id}">Volver</a>
          </div>`;
        return;
      }
      form.name = routine.name || '';
      form.description = routine.description || '';
      form.folder = routine.folder || '';
      exercises = (routine.exercises || []).map((item) => ({
        uid: idSeq++,
        exerciseId: item.exercise.id,
        name: item.exercise.name,
        category: item.exercise.category,
        imageUrl: item.exercise.imageUrl,
        targetSets: item.targetSets || 3,
        targetReps: item.targetReps || '8-12',
        notes: item.notes || '',
      }));
    } catch (error) {
      if (error.status === 401) {
        ctx.handleUnauthorized();
        return;
      }
      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${icon('info', 24)}</div>
          <h3>No se pudo cargar la rutina</h3>
          <p>${esc(errorMessage(error))}</p>
          <a class="btn btn-secondary btn-sm" href="#/routines" data-link="/routines">Volver</a>
        </div>`;
      return;
    }
  }

  const exerciseCard = (item, index) => `
    <div class="editor-exercise" data-uid="${item.uid}">
      <div class="editor-exercise-top">
        <span class="exercise-thumb ${item.imageUrl ? '' : 'gray'}">
          ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : icon('dumbbell', 22)}
        </span>
        <div class="info">
          <div class="name" style="font-weight:650">${esc(item.name)}</div>
          <div class="text-muted text-xs">${esc(item.category || '')}</div>
        </div>
        <div class="order-buttons">
          <button type="button" data-move="up" ${index === 0 ? 'disabled' : ''} aria-label="Subir">${icon('arrowUp', 15)}</button>
          <button type="button" data-move="down" ${index === exercises.length - 1 ? 'disabled' : ''} aria-label="Bajar">${icon('arrowDown', 15)}</button>
          <button type="button" data-remove aria-label="Quitar">${icon('trash', 15)}</button>
        </div>
      </div>
      <div class="editor-controls">
        <div class="field">
          <label for="routine-ex-${item.uid}-sets">Series</label>
          <input id="routine-ex-${item.uid}-sets" class="input" type="number" inputmode="numeric" min="1" max="20" value="${esc(String(item.targetSets))}" data-field="targetSets" />
        </div>
        <div class="field">
          <label for="routine-ex-${item.uid}-reps">Reps objetivo</label>
          <input id="routine-ex-${item.uid}-reps" class="input" type="text" value="${esc(item.targetReps)}" data-field="targetReps" placeholder="8-12" />
        </div>
      </div>
    </div>
  `;

  const renderList = () => {
    const list = container.querySelector('[data-list]');
    if (!list) return;
    list.innerHTML = exercises.map(exerciseCard).join('');
  };

  container.innerHTML = `
    <div class="view">
      <div class="topbar">
        <button type="button" class="icon-btn surface" data-cancel aria-label="Volver">
          ${icon('arrowLeft', 19)}
        </button>
        <div class="topbar-title">${editing ? 'Editar rutina' : 'Nueva rutina'}</div>
        <button type="button" class="btn btn-primary btn-sm" data-save>Guardar</button>
      </div>

      <div class="field">
        <label for="routine-name">Nombre</label>
        <input id="routine-name" class="input" type="text" data-input="name" value="${esc(form.name)}" placeholder="Día 1 - Pierna" maxlength="120" />
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="routine-folder">Carpeta (opcional)</label>
          <input id="routine-folder" class="input" type="text" data-input="folder" value="${esc(form.folder)}" placeholder="Tirón-Empuje" maxlength="120" />
        </div>
        <div class="field">
          <label for="routine-description">Descripción (opcional)</label>
          <input id="routine-description" class="input" type="text" data-input="description" value="${esc(form.description)}" placeholder="Notas de la rutina" maxlength="200" />
        </div>
      </div>

      <section>
        <div class="section-head"><h2>Ejercicios</h2></div>
        <div class="editor-list" data-list></div>
        <button type="button" class="add-exercise-btn" data-add style="margin-top:10px">
          ${icon('plus', 18)} Añadir ejercicio
        </button>
      </section>
    </div>
  `;

  renderList();

  // Track unsaved changes so leaving the editor can warn before discarding.
  let dirty = false;
  const markDirty = () => {
    dirty = true;
  };

  // --- form field binding ---
  container.querySelectorAll('[data-input]').forEach((input) => {
    input.addEventListener('input', () => {
      form[input.dataset.input] = input.value;
      markDirty();
    });
  });

  // --- exercise list interactions ---
  container.querySelector('[data-list]')?.addEventListener('input', (event) => {
    const field = event.target.closest('[data-field]');
    if (!field) return;
    const card = field.closest('[data-uid]');
    const item = exercises.find((ex) => ex.uid === Number(card.dataset.uid));
    if (!item) return;
    item[field.dataset.field] = field.value;
    markDirty();
  });

  container.querySelector('[data-list]')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-uid]');
    if (!card) return;
    const uid = Number(card.dataset.uid);
    const index = exercises.findIndex((ex) => ex.uid === uid);
    if (index < 0) return;

    if (event.target.closest('[data-remove]')) {
      exercises.splice(index, 1);
      markDirty();
      renderList();
      return;
    }
    const move = event.target.closest('[data-move]');
    if (move) {
      const dir = move.dataset.move === 'up' ? -1 : 1;
      const target = index + dir;
      if (target < 0 || target >= exercises.length) return;
      [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
      markDirty();
      renderList();
    }
  });

  // --- picker (shared module with muscle-group filter) ---
  const openPicker = () => {
    openExercisePicker({
      onPick: (item) => {
        exercises.push({
          uid: idSeq++,
          exerciseId: item.exerciseId,
          catalogId: item.catalogId,
          name: item.name,
          category: item.category,
          imageUrl: item.imageUrl,
          targetSets: 3,
          targetReps: '8-12',
          notes: '',
        });
        markDirty();
        renderList();
        toast(`${item.name} añadido`, 'success');
      },
    });
  };

  container.querySelector('[data-add]')?.addEventListener('click', openPicker);

  // --- cancel / save ---
  const leave = () => ctx.navigate(editing ? `/routines/${id}` : '/routines');
  container.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    if (dirty) {
      const confirmed = await confirmDialog({
        title: 'Descartar cambios',
        message: 'Has hecho cambios sin guardar en la rutina. Si sales ahora se perderán.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir editando',
        danger: true,
      });
      if (!confirmed) return;
    }
    leave();
  });

  container.querySelector('[data-save]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!form.name.trim()) {
      toast('Ponle un nombre a la rutina', 'error');
      return;
    }
    if (!exercises.length) {
      toast('Añade al menos un ejercicio', 'error');
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      folder: form.folder.trim() || null,
      exercises: exercises.map((item) => ({
        ...(item.exerciseId ? { exerciseId: item.exerciseId } : {}),
        ...(item.catalogId && !item.exerciseId ? { catalogId: item.catalogId } : {}),
        ...(!item.exerciseId && !item.catalogId ? { name: item.name } : {}),
        targetSets: Number(item.targetSets) || 3,
        targetReps: String(item.targetReps || '8-12'),
        notes: item.notes || null,
      })),
    };

    setLoading(button, true, 'Guardando...');
    try {
      let routineId = id;
      if (editing) {
        await api.routines.update(id, payload);
      } else {
        const { routine } = await api.routines.create(payload);
        routineId = routine.id;
      }
      toast('Rutina guardada', 'success');
      dirty = false;
      ctx.navigate(`/routines/${routineId}`);
    } catch (error) {
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    } finally {
      setLoading(button, false);
    }
  });
}
