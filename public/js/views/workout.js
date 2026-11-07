import { api, errorMessage } from '../api.js';
import { lineChart, attachLineChart } from '../charts.js';
import {
  confirmDialog,
  connectionNeeded,
  esc,
  formatDate,
  formatDuration,
  formatNumber,
  formatTime,
  formatVolume,
  formatWeight,
  icon,
  openActionSheet,
  openModal,
  toast,
} from '../ui.js';

function setChip(set) {
  const weight = set.weightKg != null ? `${formatNumber(set.weightKg, 1)}kg` : '—';
  return `<span class="set-chip ${set.completed ? 'done' : ''}">${weight} × ${set.reps ?? '—'}</span>`;
}

function groupExercises(exercises) {
  const groups = [];
  for (const exercise of exercises) {
    const current = groups[groups.length - 1];
    if (
      exercise.supersetGroup != null &&
      current &&
      current.supersetGroup === exercise.supersetGroup
    ) {
      current.items.push(exercise);
    } else {
      groups.push({
        supersetGroup: exercise.supersetGroup,
        items: [exercise],
      });
    }
  }
  return groups;
}

function exerciseBlock(exercise, { inSuperset = false } = {}) {
  const done = exercise.sets.filter((set) => set.completed).length;
  return `
    <div class="detail-exercise ${inSuperset ? 'in-superset' : ''}">
      ${inSuperset ? `<span class="superset-chip">${icon('layers', 12)} Superset</span>` : ''}
      <div class="head">
        <span class="exercise-thumb ${exercise.imageUrl ? '' : 'gray'}">
          ${exercise.imageUrl ? `<img src="${esc(exercise.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : icon('dumbbell', 22)}
        </span>
        <div class="info">
          <div class="n">${esc(exercise.name)}</div>
          <div class="s">${done}/${exercise.sets.length} series · ${esc(exercise.category || '')}</div>
        </div>
      </div>
      <div class="set-chips">${exercise.sets.map(setChip).join('')}</div>
      ${exercise.notes ? `<div class="text-xs text-muted">${icon('info', 12)} ${esc(exercise.notes)}</div>` : ''}
      ${
        exercise.exerciseId != null
          ? `<button type="button" class="link-btn progress-link" data-progress="${exercise.exerciseId}" data-progress-name="${esc(exercise.name)}">
               ${icon('chart', 14)} Ver progresión
             </button>`
          : ''
      }
    </div>
  `;
}

// --- per-exercise progression (read-only, available for every workout) ---

// e1RM shown here is an Epley ESTIMATE from each logged set, not a tested max;
// the UI labels it as "estimado" so it is never read as a true one-rep max.
function progressionContent(stats) {
  const history = Array.isArray(stats.history) ? stats.history : [];
  const prs = stats.prs || {};

  const chart =
    history.length < 2
      ? '<div class="chart-empty">Necesitas al menos dos entrenamientos con este ejercicio para ver la progresión</div>'
      : lineChart({
          data: history,
          valueKey: 'e1rm',
          labelKey: 'date',
          height: 170,
          formatValue: (value) => formatWeight(value),
          interactive: true,
          tooltipRows: (item) => [
            [formatDate(item.date), ''],
            ['1RM estimado', formatWeight(item.e1rm)],
            ['Peso máx.', formatWeight(item.maxWeight)],
            ['Volumen', `${formatVolume(item.volume || 0)} kg`],
          ],
        });

  const prCell = (label, value) => `
    <div class="pr-cell">
      <span class="pr-value">${esc(value)}</span>
      <span class="pr-label">${esc(label)}</span>
    </div>`;

  const prGrid = `
    <div class="pr-grid">
      ${prCell('Peso máximo', formatWeight(prs.maxWeight))}
      ${prCell('1RM estimado', formatWeight(prs.bestE1rm))}
      ${prCell('Reps máx.', prs.maxReps != null ? formatNumber(prs.maxReps) : '—')}
      ${prCell('Volumen máx. por sesión', prs.maxVolume != null ? `${formatVolume(prs.maxVolume)} kg` : '—')}
    </div>`;

  return `
    <div class="progression">
      <div class="progression-chart" data-chart>${chart}</div>
      <div class="pr-section">
        <div class="pr-head">Récords personales</div>
        ${prGrid}
        <p class="pr-note">${icon('info', 12)} El 1RM es un valor <b>estimado</b> (fórmula de Epley), no una marca real.</p>
      </div>
    </div>
  `;
}

// Opens a read-only modal with the exercise progression. `exerciseId` is the
// exercises-table id (exercise.exerciseId in the workout detail), which the
// stats endpoint expects — not the workout_exercise row id (exercise.id).
async function openProgression(ctx, exerciseId, name) {
  const modal = openModal({
    title: name || 'Progresión',
    subtitle: '1RM estimado a lo largo del tiempo',
    content: `<div class="progression-loading">${icon('clock', 20)} Cargando…</div>`,
  });

  try {
    const stats = await api.stats.exercise(exerciseId);
    modal.body.innerHTML = progressionContent(stats);
    attachLineChart(modal.body.querySelector('[data-chart]'));
  } catch (error) {
    if (error.status === 401) {
      modal.close();
      ctx.handleUnauthorized();
      return;
    }
    modal.body.innerHTML = `<div class="chart-empty">${esc(errorMessage(error))}</div>`;
    toast(errorMessage(error), 'error');
  }
}

// --- editable mode markup (mirrors the active-workout set editing) ---

function editSetRow(set, index) {
  return `
    <div class="set-row ${set.completed ? 'completed' : ''}" data-set-id="${set.id}">
      <div class="set-num">${index + 1}</div>
      <div class="set-cell">
        <input class="number-input" type="number" inputmode="decimal" step="0.5" min="0" placeholder="0"
          value="${set.weightKg != null ? esc(String(set.weightKg)) : ''}" data-field="weightKg" aria-label="Peso en kg" />
      </div>
      <div class="set-cell">
        <input class="number-input" type="number" inputmode="numeric" min="0" placeholder="0"
          value="${set.reps != null ? esc(String(set.reps)) : ''}" data-field="reps" aria-label="Repeticiones" />
      </div>
      <button type="button" class="check-btn ${set.completed ? 'checked' : ''}" data-toggle aria-label="Completar serie">
        ${icon('check', 18)}
      </button>
      <button type="button" class="icon-btn" data-delete-set aria-label="Eliminar serie ${index + 1}">
        ${icon('trash', 16)}
      </button>
    </div>
  `;
}

function editExerciseBlock(exercise, { inSuperset = false } = {}) {
  return `
    <div class="exercise-block ${inSuperset ? 'in-superset' : ''}" data-we-id="${exercise.id}">
      ${inSuperset ? `<span class="superset-chip">${icon('layers', 12)} Superset</span>` : ''}
      <div class="exercise-block-head">
        <span class="exercise-thumb ${exercise.imageUrl ? '' : 'gray'}">
          ${exercise.imageUrl ? `<img src="${esc(exercise.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : icon('dumbbell', 22)}
        </span>
        <div class="info">
          <div class="name">${esc(exercise.name)}</div>
          <div class="prev">${esc(exercise.category || '')}</div>
        </div>
        <button type="button" class="icon-btn" data-delete-exercise aria-label="Eliminar ejercicio">
          ${icon('trash', 18)}
        </button>
      </div>
      <div class="set-table">
        <div class="set-head">
          <span>Serie</span>
          <span>Kg</span>
          <span>Reps</span>
          <span>${icon('check', 13)}</span>
          <span></span>
        </div>
        ${exercise.sets.map((set, index) => editSetRow(set, index)).join('')}
      </div>
      <button type="button" class="add-set-btn" data-add-set>${icon('plus', 15)} Agregar Serie</button>
    </div>
  `;
}

export async function render(container, ctx, params) {
  const id = params.id;
  let workout;

  async function load() {
    const response = await api.workouts.detail(id);
    workout = response.workout;
  }

  try {
    await load();
  } catch (error) {
    if (error.status === 401) {
      ctx.handleUnauthorized();
      return;
    }
    if (error.status !== 0) {
      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${icon('info', 24)}</div>
          <h3>No se pudo cargar el entrenamiento</h3>
          <p>${esc(errorMessage(error))}</p>
          <a class="btn btn-secondary btn-sm" href="#/workouts" data-link="/workouts">Volver</a>
        </div>`;
      return;
    }
    // Offline: a finished workout is not cached, so render the view header/back
    // button and a "needs connection" block instead of a full-screen error.
    container.innerHTML = `
      <div class="view">
        <div class="topbar">
          <button type="button" class="icon-btn surface" data-link="/workouts" aria-label="Volver">
            ${icon('arrowLeft', 19)}
          </button>
          <div class="topbar-title">Entrenamiento</div>
          <span style="width:40px"></span>
        </div>
        ${connectionNeeded('Este entrenamiento aparecerá cuando vuelvas a estar en línea.', 'data-retry')}
      </div>`;
    container.querySelector('[data-retry]')?.addEventListener('click', () => ctx.refresh());
    return;
  }

  // If the workout is still active, send the user to the live screen.
  if (workout.active) {
    ctx.navigate('/workout/active', { replace: true });
    return;
  }

  // Imported workouts are read-only: a later Hevy sync would overwrite any edit.
  const readOnly = workout.source === 'hevy';
  let editing = false;

  // ---------- read-only (summary) view ----------

  function renderView() {
    const summary = workout.summary || {};
    container.innerHTML = `
    <div class="view">
      <div class="topbar">
        <button type="button" class="icon-btn surface" data-link="/workouts" aria-label="Volver">
          ${icon('arrowLeft', 19)}
        </button>
        <div class="topbar-title">Entrenamiento</div>
        <button type="button" class="icon-btn surface" data-menu aria-label="Opciones">
          ${icon('more', 19)}
        </button>
      </div>

      <section class="summary-hero">
        <div class="date">${esc(formatDate(workout.startedAt, { withYear: true }))} · ${esc(formatTime(workout.startedAt))}</div>
        <h1>${esc(workout.name)}</h1>
        ${workout.location ? `<div class="text-sm text-muted">${icon('target', 13)} ${esc(workout.location)}</div>` : ''}
        ${readOnly ? `<div class="text-xs text-muted">${icon('repeat', 12)} Importado de Hevy · solo lectura</div>` : ''}
        <div class="stats">
          <div class="stat">
            <span class="value">${esc(formatDuration(workout.durationSeconds))}</span>
            <span class="label">Tiempo</span>
          </div>
          <div class="stat">
            <span class="value">${esc(formatVolume(summary.volume))} kg</span>
            <span class="label">Volumen</span>
          </div>
          <div class="stat">
            <span class="value">${esc(String(summary.sets || 0))}</span>
            <span class="label">Series</span>
          </div>
        </div>
        ${
          summary.records
            ? `<span class="badge badge-warning" style="align-self:flex-start">${icon('trophy', 12)} ${summary.records} récord${summary.records === 1 ? '' : 's'}</span>`
            : ''
        }
      </section>

      ${workout.notes ? `<div class="notice">${icon('info', 16)} ${esc(workout.notes)}</div>` : ''}

      <section>
        <div class="section-head"><h2>Ejercicios</h2><span class="hint">${workout.exercises.length}</span></div>
        <div class="stack-sm">
          ${
            workout.exercises.length
              ? groupExercises(workout.exercises)
                  .map((group) =>
                    group.items
                      .map((exercise) =>
                        exerciseBlock(exercise, {
                          inSuperset: group.items.length > 1,
                        })
                      )
                      .join('')
                  )
                  .join('')
              : `<div class="card"><div class="empty" style="padding:18px 8px">
                   <div class="empty-icon">${icon('dumbbell', 22)}</div>
                   <h3>Sin ejercicios registrados</h3>
                 </div></div>`
          }
        </div>
      </section>
    </div>
  `;

    // Read-only progression: available for every workout (including Hevy).
    // Bound to the freshly rendered `.view` (replaced on each renderView call),
    // so the listener never stacks across re-renders of the detail.
    container.querySelector('.view')?.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-progress]');
      if (!trigger) return;
      const exerciseId = Number(trigger.dataset.progress);
      if (!Number.isFinite(exerciseId)) return;
      openProgression(ctx, exerciseId, trigger.dataset.progressName);
    });

    container.querySelector('[data-menu]')?.addEventListener('click', () => {
      const items = [];
      if (!readOnly) {
        items.push({
          label: 'Editar entrenamiento',
          icon: 'pencil',
          onClick: () => {
            editing = true;
            renderEdit();
          },
        });
      }
      if (workout.routineId) {
        items.push({
          label: 'Ver rutina',
          icon: 'list',
          onClick: () => ctx.navigate(`/routines/${workout.routineId}`),
        });
      }
      items.push({
        label: 'Eliminar entrenamiento',
        icon: 'trash',
        danger: true,
        onClick: async () => {
          const confirmed = await confirmDialog({
            title: 'Eliminar entrenamiento',
            message: 'Este entrenamiento y sus series se eliminarán. Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!confirmed) return;
          try {
            await api.workouts.remove(workout.id);
            toast('Entrenamiento eliminado', 'success');
            ctx.navigate('/workouts');
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        },
      });
      openActionSheet(workout.name, items);
    });
  }

  // ---------- editable view ----------

  const getExercise = (weId) => workout.exercises.find((ex) => ex.id === weId);
  const getSet = (weId, setId) =>
    getExercise(weId)?.sets.find((set) => set.id === setId);

  // Shared 403 handler: the backend refuses edits to imported content, so if
  // this workout became read-only server-side we surface it and leave edit mode.
  const handleEditError = (error) => {
    if (error.status === 401) {
      ctx.handleUnauthorized();
      return;
    }
    if (error.status === 403) {
      toast(error.message || 'No se puede editar contenido importado de Hevy', 'error');
      return;
    }
    toast(errorMessage(error), 'error');
  };

  function renderEditExercises() {
    const list = container.querySelector('[data-exercises]');
    if (!list) return;
    list.innerHTML = workout.exercises.length
      ? groupExercises(workout.exercises)
          .map((group) =>
            group.items
              .map((exercise) =>
                editExerciseBlock(exercise, {
                  inSuperset: group.items.length > 1,
                })
              )
              .join('')
          )
          .join('')
      : `<div class="card"><div class="empty" style="padding:18px 8px">
           <div class="empty-icon">${icon('dumbbell', 22)}</div>
           <h3>Sin ejercicios</h3>
         </div></div>`;
  }

  async function reloadAndView() {
    editing = false;
    try {
      await load();
    } catch (error) {
      handleEditError(error);
    }
    renderView();
  }

  function renderEdit() {
    container.innerHTML = `
    <div class="view" style="gap:14px">
      <div class="topbar">
        <button type="button" class="icon-btn surface" data-done aria-label="Terminar edición">
          ${icon('arrowLeft', 19)}
        </button>
        <div class="topbar-title">Editar entrenamiento</div>
        <button type="button" class="btn btn-primary btn-sm" data-done-btn>Listo</button>
      </div>

      <div class="field">
        <label>Nombre</label>
        <input class="input" type="text" data-input="name" value="${esc(workout.name || '')}" placeholder="Entrenamiento" maxlength="120" />
      </div>
      <div class="field">
        <label>Ubicación (opcional)</label>
        <input class="input" type="text" data-input="location" value="${esc(workout.location || '')}" placeholder="Gimnasio" maxlength="120" />
      </div>
      <div class="field">
        <label>Notas (opcional)</label>
        <input class="input" type="text" data-input="notes" value="${esc(workout.notes || '')}" placeholder="Cómo fue el entreno" maxlength="500" />
      </div>

      <section>
        <div class="section-head"><h2>Ejercicios</h2></div>
        <div class="stack-sm" data-exercises></div>
      </section>
    </div>
  `;

    renderEditExercises();

    // --- name / location / notes (persist on blur with absolute values) ---
    container.querySelectorAll('[data-input]').forEach((input) => {
      input.addEventListener('change', async () => {
        const field = input.dataset.input;
        const value = input.value.trim();
        try {
          await api.workouts.update(workout.id, { [field]: value || null });
          workout[field] = value || null;
        } catch (error) {
          handleEditError(error);
        }
      });
    });

    // --- set field edits (weight / reps) ---
    const exercisesEl = container.querySelector('[data-exercises]');

    exercisesEl.addEventListener('change', async (event) => {
      const field = event.target.closest('[data-field]');
      if (!field) return;
      const block = field.closest('[data-we-id]');
      const row = field.closest('[data-set-id]');
      const weId = Number(block.dataset.weId);
      const setId = Number(row.dataset.setId);
      const set = getSet(weId, setId);
      if (!set) return;
      const raw = field.value;
      let value = raw === '' ? null : Number(raw);
      if (value != null) {
        const invalid = !Number.isFinite(value) || value < 0;
        if (invalid) value = 0;
        if (field.dataset.field === 'reps') value = Math.round(value);
        field.value = String(value);
      }
      set[field.dataset.field] = value;
      try {
        await api.workouts.updateSet(workout.id, setId, {
          weightKg: set.weightKg,
          reps: set.reps,
          completed: set.completed,
        });
      } catch (error) {
        handleEditError(error);
      }
    });

    exercisesEl.addEventListener('click', async (event) => {
      const block = event.target.closest('[data-we-id]');
      if (!block) return;
      const weId = Number(block.dataset.weId);

      // toggle completed
      const toggle = event.target.closest('[data-toggle]');
      if (toggle) {
        const row = toggle.closest('[data-set-id]');
        const setId = Number(row.dataset.setId);
        const set = getSet(weId, setId);
        if (!set) return;
        const next = !set.completed;
        try {
          await api.workouts.updateSet(workout.id, setId, {
            weightKg: set.weightKg,
            reps: set.reps,
            completed: next,
          });
          set.completed = next;
          row.classList.toggle('completed', next);
          toggle.classList.toggle('checked', next);
        } catch (error) {
          handleEditError(error);
        }
        return;
      }

      // delete set
      const deleteSet = event.target.closest('[data-delete-set]');
      if (deleteSet) {
        const row = deleteSet.closest('[data-set-id]');
        const setId = Number(row.dataset.setId);
        try {
          await api.workouts.removeSet(workout.id, setId);
          const exercise = getExercise(weId);
          if (exercise) exercise.sets = exercise.sets.filter((s) => s.id !== setId);
          renderEditExercises();
        } catch (error) {
          handleEditError(error);
        }
        return;
      }

      // add set
      const addSet = event.target.closest('[data-add-set]');
      if (addSet) {
        try {
          const { set } = await api.workouts.addSet(workout.id, weId, {});
          const exercise = getExercise(weId);
          if (exercise) exercise.sets.push(set);
          renderEditExercises();
        } catch (error) {
          handleEditError(error);
        }
        return;
      }

      // delete exercise
      const deleteExercise = event.target.closest('[data-delete-exercise]');
      if (deleteExercise) {
        const exercise = getExercise(weId);
        const confirmed = await confirmDialog({
          title: 'Eliminar ejercicio',
          message: `"${exercise ? exercise.name : 'Este ejercicio'}" y sus series se eliminarán del entrenamiento.`,
          confirmLabel: 'Eliminar',
          danger: true,
        });
        if (!confirmed) return;
        try {
          const { workout: fresh } = await api.workouts.removeExercise(workout.id, weId);
          workout = fresh;
          renderEditExercises();
        } catch (error) {
          handleEditError(error);
        }
      }
    });

    const done = () => reloadAndView();
    container.querySelector('[data-done]')?.addEventListener('click', done);
    container.querySelector('[data-done-btn]')?.addEventListener('click', done);
  }

  renderView();
}
