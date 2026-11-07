import { api, errorMessage } from '../api.js';
import { openExercisePicker } from '../exercise-picker.js';
import { attachSwipeToDelete } from '../swipe.js';
import { createWriteScheduler } from '../pending-writes.js';
import {
  saveActiveWorkout,
  loadActiveWorkout,
} from '../offline/active-store.js';
import { createActiveWorkoutRepo } from '../offline/active-repo.js';
import * as activeStore from '../offline/active-store.js';
import * as localModel from '../offline/local-workout.js';
import {
  confirmDialog,
  esc,
  formatClock,
  formatNumber,
  formatVolume,
  haptic,
  icon,
  openActionSheet,
  openModal,
  setLoading,
  toast,
} from '../ui.js';
import { parseDecimalInput, INVALID } from '../format.js';
import { createRestTimer } from '../rest-timer.js';

function computeTotals(workout) {
  let volume = 0;
  let sets = 0;
  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      if (set.completed) {
        sets += 1;
        volume += (Number(set.weightKg) || 0) * (Number(set.reps) || 0);
      }
    }
  }
  return { volume, sets };
}

function prevSet(previousSets, index) {
  return previousSets?.[index] || previousSets?.[previousSets.length - 1] || null;
}

function prevLabel(previousSets, index) {
  const prev = prevSet(previousSets, index);
  if (!prev) return '—';
  const weight = prev.weightKg != null ? `${formatNumber(prev.weightKg, 1)}kg` : '—';
  return `${weight} × ${prev.reps ?? '—'}`;
}

function setRow(exercise, set, index) {
  const previous = prevSet(exercise.previousSets, index);
  const weightPlaceholder = previous?.weightKg != null ? formatNumber(previous.weightKg, 1) : '0';
  const repsPlaceholder = previous?.reps != null ? String(previous.reps) : '0';
  return `
    <div class="set-swipe" data-set-id="${set.id}">
      <div class="set-swipe-bg" aria-hidden="true">
        <button type="button" class="set-delete-btn" data-delete-set aria-label="Eliminar serie ${index + 1}">
          ${icon('trash', 16)}
        </button>
      </div>
      <div class="set-row ${set.completed ? 'completed' : ''}" data-set-handle>
        <div class="set-num">${index + 1}</div>
        <button type="button" class="set-prev" data-prev-fill aria-label="Usar datos de la serie anterior">
          ${esc(prevLabel(exercise.previousSets, index))}
        </button>
        <div class="set-cell">
          <input class="number-input" type="text" inputmode="decimal" placeholder="${esc(weightPlaceholder)}"
            enterkeyhint="next"
            value="${set.weightKg != null ? esc(String(set.weightKg)) : ''}" data-field="weightKg" aria-label="Peso en kg" />
        </div>
        <div class="set-cell">
          <input class="number-input" type="number" inputmode="numeric" min="0" placeholder="${esc(repsPlaceholder)}"
            enterkeyhint="done"
            value="${set.reps != null ? esc(String(set.reps)) : ''}" data-field="reps" aria-label="Repeticiones" />
        </div>
        <button type="button" class="check-btn ${set.completed ? 'checked' : ''}" data-toggle aria-label="Completar serie">
          ${icon('check', 18)}
        </button>
      </div>
    </div>
  `;
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
        <button type="button" class="icon-btn" data-exercise-menu aria-label="Opciones del ejercicio">
          ${icon('more', 19)}
        </button>
      </div>
      <div class="set-table">
        <div class="set-head">
          <span>Serie</span>
          <span>Anterior</span>
          <span>Kg</span>
          <span>Reps</span>
          <span>${icon('check', 13)}</span>
        </div>
        ${exercise.sets.map((set, index) => setRow(exercise, set, index)).join('')}
      </div>
      <button type="button" class="add-set-btn" data-add-set>${icon('plus', 15)} Agregar Serie</button>
    </div>
  `;
}

export async function render(container, ctx) {
  const userId = ctx.user?.id ?? null;
  let workout = ctx.activeWorkout;
  let offline = false;
  try {
    const { workout: fresh } = await api.workouts.active();
    workout = fresh;
    // Refresh the local snapshot with the server's authoritative copy.
    saveActiveWorkout(userId, workout);
  } catch (error) {
    if (error.status === 401) {
      ctx.handleUnauthorized();
      return;
    }
    // status 0 = the request never reached the server (offline). Fall back to
    // the last locally saved snapshot so the user can keep seeing (and editing)
    // the workout instead of losing it. Any other error: keep ctx.activeWorkout.
    if (error.status === 0) {
      offline = true;
      const local = await loadActiveWorkout(userId);
      if (local) workout = local;
    }
  }

  if (!workout) {
    container.innerHTML = `
      <div class="view">
        <div class="empty" style="min-height:60dvh">
          <div class="empty-icon">${icon('activity', 24)}</div>
          <h3>No hay entrenamiento activo</h3>
          <p>Empieza una rutina o un entreno libre para registrar tus series.</p>
          <a class="btn btn-primary btn-sm" href="#/routines" data-link="/routines">${icon('play', 15)} Ir a entrenamientos</a>
        </div>
      </div>`;
    ctx.setActiveWorkout(null);
    return;
  }

  ctx.setActiveWorkout(workout);

  // Repository that decides per-mutation whether to hit the server (online) or
  // the local model (offline). It owns the single source of truth for the
  // workout; the view mirrors repo.current into its own `workout` after each
  // mutation so all the existing render helpers keep working unchanged.
  const repo = createActiveWorkoutRepo({
    userId,
    api,
    store: activeStore,
    model: localModel,
  });
  repo.set(workout);

  // Compare ids tolerantly: server ids are numbers rendered as strings in the
  // dataset; local ids are strings like "local-…". Comparing as strings matches
  // both without turning a local id into NaN via Number().
  const sameId = (a, b) => String(a) === String(b);

  // Show/hide the persistent "offline · will sync" pill. A workout is pending
  // sync whenever the repo holds a local copy; it clears once uploaded.
  const renderOfflineState = () => {
    const el = container.querySelector('[data-offline-state]');
    if (el) el.hidden = !repo.isLocal();
  };

  // Keep the local recovery snapshot in sync with the in-memory workout. Called
  // after every mutation (set edits, add/remove exercise, reorder, …). It is
  // fire-and-forget and never throws, so it can't interfere with the UI.
  const snapshot = () => saveActiveWorkout(userId, workout);

  const renderStats = () => {
    const totals = computeTotals(workout);
    const volumeEl = container.querySelector('[data-stat-volume]');
    const setsEl = container.querySelector('[data-stat-sets]');
    if (volumeEl) volumeEl.textContent = `${formatVolume(totals.volume)} kg`;
    if (setsEl) setsEl.textContent = String(totals.sets);
    // renderStats runs after every structural change and every edit, so it is
    // the single natural place to refresh the local snapshot.
    snapshot();
  };

  const renderExercises = () => {
    const list = container.querySelector('[data-exercises]');
    if (!list) return;
    list.innerHTML = workout.exercises.length
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
           <h3>Sin ejercicios</h3>
           <p>Añade un ejercicio para empezar a registrar series.</p>
         </div></div>`;
    renderStats();
    wireSwipes();
  };

  // Track live swipe controllers so a newly opened row collapses the others.
  const swipeControllers = new Set();

  async function deleteSet(weId, setId) {
    try {
      await repo.deleteSet(setId);
      workout = repo.current;
      // Online, the repo returns the workout untouched (the server owns the
      // delete), so drop the set from the in-memory copy here. Offline the
      // model already removed it; filtering again is a harmless no-op.
      const exercise = getExercise(weId);
      if (exercise) exercise.sets = exercise.sets.filter((s) => !sameId(s.id, setId));
      ctx.setActiveWorkout(workout);
      haptic(16);
      renderExercises();
      renderOfflineState();
    } catch (error) {
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
      throw error; // let the row spring back
    }
  }

  function wireSwipes() {
    swipeControllers.clear();
    const list = container.querySelector('[data-exercises]');
    if (!list) return;
    list.querySelectorAll('.set-swipe').forEach((wrapper) => {
      const handle = wrapper.querySelector('[data-set-handle]');
      if (!handle) return;
      const block = wrapper.closest('[data-we-id]');
      // Keep ids as-is (string for local, numeric-as-string for server). Do not
      // coerce with Number() or local ids become NaN.
      const weId = block.dataset.weId;
      const setId = wrapper.dataset.setId;

      const controller = attachSwipeToDelete(handle, {
        onDelete: () => deleteSet(weId, setId),
      });
      swipeControllers.add(controller);

      // Opening one row closes the rest.
      handle.addEventListener('pointerdown', () => {
        swipeControllers.forEach((other) => {
          if (other !== controller && other.isOpen()) other.close();
        });
      });

      // The revealed button deletes directly (accessible via keyboard too).
      wrapper
        .querySelector('[data-delete-set]')
        ?.addEventListener('click', () => deleteSet(weId, setId));
    });
  }

  container.innerHTML = `
    <div class="view" style="gap:14px">
      <div class="active-head">
        <div class="active-head-row">
          <button type="button" class="icon-btn surface" data-link="/" aria-label="Minimizar">
            ${icon('chevronDown', 20)}
          </button>
          <div class="active-title">
            <div class="t" data-title>${esc(workout.name)}</div>
            <div class="s" data-timer>${formatClock(workout.durationSeconds)}</div>
            <div class="s save-state" data-save-state hidden aria-live="polite">Guardando…</div>
            <div class="s save-state" data-offline-state hidden aria-live="polite">Sin conexión · se sincronizará</div>
          </div>
          <button type="button" class="icon-btn surface" data-rest-toggle aria-label="Temporizador de descanso">
            ${icon('timer', 20)}
          </button>
          <button type="button" class="finish-check" data-finish aria-label="Terminar entrenamiento">
            ${icon('check', 20)}
          </button>
        </div>
      </div>

      <div class="workout-timer-strip">
        <div>
          <div class="timer-sub">Duración</div>
          <div class="timer-big" data-timer-big>${formatClock(workout.durationSeconds)}</div>
        </div>
        <div>
          <div class="timer-sub">Volumen</div>
          <div class="timer-big" data-stat-volume>0 kg</div>
        </div>
        <div>
          <div class="timer-sub">Series</div>
          <div class="timer-big" data-stat-sets>0</div>
        </div>
      </div>

      <div class="stack-sm" data-exercises></div>

      <button type="button" class="add-exercise-btn" data-add-exercise>
        ${icon('plus', 18)} Añadir ejercicio
      </button>

      <button type="button" class="btn btn-secondary btn-block" data-discard>
        ${icon('trash', 16)} Descartar entrenamiento
      </button>
    </div>

    <div class="rest-timer" data-rest-timer hidden aria-live="polite" role="status">
      <button type="button" class="rest-skip" data-rest-skip aria-label="Saltar descanso">
        ${icon('x', 18)}
      </button>
      <div class="rest-timer-main">
        <div class="rest-timer-label">Descanso</div>
        <div class="rest-timer-count" data-rest-count>0:00</div>
      </div>
      <button type="button" class="rest-add" data-rest-add>+15s</button>
    </div>
  `;

  renderExercises();
  renderOfflineState();

  // When the server was unreachable and we fell back to the local snapshot,
  // tell the user they are looking at an offline copy so it is clear why edits
  // are not confirmed as saved yet.
  if (offline) {
    toast('Sin conexión · mostrando tu copia local', 'default');
  }

  // --- timer ---
  const startMs = new Date(workout.startedAt).getTime();
  const tick = () => {
    const seconds = Math.max(0, Math.round((Date.now() - startMs) / 1000));
    const text = formatClock(seconds);
    const timer = container.querySelector('[data-timer]');
    const big = container.querySelector('[data-timer-big]');
    if (timer) timer.textContent = text;
    if (big) big.textContent = text;
  };
  const timerId = setInterval(tick, 1000);
  tick();

  // --- rest timer (client-only, opt-in) ---
  // Starts when a set is marked complete, counts down from the set's
  // restSeconds (or a default), and can be extended or skipped. Opt-in state is
  // persisted so the user's choice survives reloads. No server involvement.
  const REST_PREF_KEY = 'fit-rest-timer';
  const DEFAULT_REST_SECONDS = 90;
  const restEnabled = () => {
    try {
      // Default ON: only an explicit "0" disables it.
      return localStorage.getItem(REST_PREF_KEY) !== '0';
    } catch {
      return true;
    }
  };
  const setRestEnabled = (on) => {
    try {
      localStorage.setItem(REST_PREF_KEY, on ? '1' : '0');
    } catch {
      /* ignore storage failures */
    }
  };

  const restEl = container.querySelector('[data-rest-timer]');
  const restCountEl = container.querySelector('[data-rest-count]');
  const restToggleBtn = container.querySelector('[data-rest-toggle]');
  const restTimer = createRestTimer({ defaultSeconds: DEFAULT_REST_SECONDS });
  let restInterval = null;

  const paintRestToggle = () => {
    if (restToggleBtn) restToggleBtn.classList.toggle('active', restEnabled());
  };

  const paintRestCount = () => {
    if (restCountEl) restCountEl.textContent = formatClock(Math.max(0, restTimer.remaining));
  };

  const stopRestTimer = () => {
    if (restInterval) {
      clearInterval(restInterval);
      restInterval = null;
    }
    restTimer.skip();
    if (restEl) restEl.hidden = true;
  };

  const restTick = () => {
    const done = restTimer.tick();
    paintRestCount();
    if (done) {
      haptic([18, 60, 18]);
      stopRestTimer();
    }
  };

  const startRestTimer = (seconds) => {
    if (!restEnabled() || !restEl) return;
    restTimer.start(seconds);
    paintRestCount();
    restEl.hidden = false;
    if (restInterval) clearInterval(restInterval);
    restInterval = setInterval(restTick, 1000);
  };

  paintRestToggle();

  if (restToggleBtn) {
    restToggleBtn.addEventListener('click', () => {
      const next = !restEnabled();
      setRestEnabled(next);
      paintRestToggle();
      haptic(8);
      if (!next) stopRestTimer();
      toast(next ? 'Temporizador de descanso activado' : 'Temporizador de descanso desactivado', 'default');
    });
  }
  if (restEl) {
    restEl.querySelector('[data-rest-skip]')?.addEventListener('click', () => {
      haptic(8);
      stopRestTimer();
    });
    restEl.querySelector('[data-rest-add]')?.addEventListener('click', () => {
      restTimer.add(15);
      paintRestCount();
      haptic(8);
      if (restEl.hidden) restEl.hidden = false;
      if (!restInterval) restInterval = setInterval(restTick, 1000);
    });
  }

  const getExercise = (weId) => workout.exercises.find((ex) => sameId(ex.id, weId));
  const getSet = (weId, setId) => {
    const exercise = getExercise(weId);
    return exercise?.sets.find((set) => sameId(set.id, setId));
  };

  // Map a set id back to its exercise so the scheduler can read live values.
  const findSetById = (setId) => {
    for (const exercise of workout.exercises) {
      const set = exercise.sets.find((s) => sameId(s.id, setId));
      if (set) return set;
    }
    return null;
  };

  const updateSaveState = () => {
    const el = container.querySelector('[data-save-state]');
    if (el) el.hidden = !setWrites.hasPending();
  };

  // Per-set write scheduler: one debounce per set, and flush()
  // persists pending edits instead of cancelling them. Absolute values are
  // sent, so flushing or re-running is idempotent (last write wins).
  const setWrites = createWriteScheduler({
    wait: 500,
    write: async (setId) => {
      const set = findSetById(setId);
      if (!set) return; // the set was deleted; nothing to persist
      try {
        // Route through the repo: online this is the same PATCH as before;
        // offline (or on a network drop) it updates the local model and keeps
        // the workout pending sync instead of leaving the edit unsaved.
        await repo.updateSet(setId, {
          weightKg: set.weightKg,
          reps: set.reps,
          completed: set.completed,
        });
        workout = repo.current;
        renderOfflineState();
      } catch (error) {
        if (error.status === 401) ctx.handleUnauthorized();
        throw error; // surface via onError, keep it visibly unsaved
      }
    },
    onSettled: updateSaveState,
    onError: (error) => {
      if (error.status !== 401) toast(errorMessage(error), 'error');
    },
  });
  const persistSet = (_weId, setId) => {
    setWrites.schedule(setId);
    updateSaveState();
  };

  const applyWorkout = (fresh) => {
    workout = fresh;
    repo.set(workout);
    ctx.setActiveWorkout(workout);
    renderExercises();
    renderOfflineState();
  };

  const openReplacePicker = (exercise) => {
    // Replace requires the server (it re-resolves history and ids), so offline
    // we degrade with a toast rather than silently doing nothing.
    if (repo.isLocal()) {
      toast('No disponible sin conexión', 'error');
      return;
    }
    openExercisePicker({
      title: 'Reemplazar ejercicio',
      userId,
      onPick: async (item) => {
        try {
          const { workout: fresh } = await api.workouts.replaceExercise(
            workout.id,
            exercise.id,
            {
              ...(item.exerciseId ? { exerciseId: item.exerciseId } : {}),
              ...(item.catalogId ? { catalogId: item.catalogId } : {}),
            }
          );
          applyWorkout(fresh);
          toast(`${item.name} reemplazado`, 'success');
        } catch (error) {
          if (error.status === 401) ctx.handleUnauthorized();
          else toast(errorMessage(error), 'error');
        }
      },
    });
  };

  const openSupersetSheet = (exercise) => {
    if (repo.isLocal()) {
      toast('No disponible sin conexión', 'error');
      return;
    }
    const candidates = workout.exercises.filter(
      (item) =>
        item.id !== exercise.id &&
        !(
          exercise.supersetGroup != null &&
          item.supersetGroup === exercise.supersetGroup
        )
    );

    if (!candidates.length) {
      toast('Añade otro ejercicio para crear una superserie', 'error');
      return;
    }

    const content = `<div class="menu-list">${candidates
      .map(
        (item) => `
        <button type="button" class="list-card" data-superset-pick="${item.id}">
          <span class="exercise-thumb ${item.imageUrl ? '' : 'gray'}" style="width:40px;height:40px;border-radius:11px">
            ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : icon('dumbbell', 18)}
          </span>
          <span class="grow">
            <span class="title">${esc(item.name)}</span>
            <span class="subtitle">${item.supersetGroup != null ? 'Ya está en otra superserie' : esc(item.category || '')}</span>
          </span>
          ${icon('plus', 17)}
        </button>`
      )
      .join('')}</div>`;

    const modal = openModal({
      title: 'Agregar a superserie',
      subtitle: exercise.name,
      sheet: true,
      content,
    });

    modal.body.addEventListener('click', async (event) => {
      const pick = event.target.closest('[data-superset-pick]');
      if (!pick) return;
      const other = getExercise(Number(pick.dataset.supersetPick));
      if (!other) return;
      try {
        const { workout: fresh } = await api.workouts.addToSuperset(
          workout.id,
          exercise.id,
          other.id
        );
        applyWorkout(fresh);
        modal.close();
        toast(`${exercise.name} + ${other.name}`, 'success');
      } catch (error) {
        if (error.status === 401) ctx.handleUnauthorized();
        else toast(errorMessage(error), 'error');
      }
    });
  };

  const openReorderSheet = () => {
    if (repo.isLocal()) {
      toast('No disponible sin conexión', 'error');
      return;
    }
    if (workout.exercises.length < 2) {
      toast('Añade más ejercicios para reordenar', 'error');
      return;
    }

    const buildUnits = () =>
      groupExercises(workout.exercises).map((group) => ({
        ids: group.items.map((item) => item.id),
        items: group.items,
        superset: group.items.length > 1,
      }));

    let units = buildUnits();

    const modal = openModal({
      title: 'Reordenar ejercicios',
      sheet: true,
      content: `<div class="reorder-list" data-reorder-list></div>`,
      actions: [
        {
          label: 'Guardar orden',
          variant: 'btn-primary',
          close: false,
          onClick: async (close) => {
            try {
              const ids = units.flatMap((unit) => unit.ids);
              const { workout: fresh } = await api.workouts.reorderExercises(
                workout.id,
                ids
              );
              applyWorkout(fresh);
              close();
              toast('Orden actualizado', 'success');
            } catch (error) {
              if (error.status === 401) ctx.handleUnauthorized();
              else toast(errorMessage(error), 'error');
            }
          },
        },
      ],
    });

    const renderReorder = () => {
      const list = modal.body.querySelector('[data-reorder-list]');
      if (!list) return;
      list.innerHTML = units
        .map(
          (unit, index) => `
          <div class="reorder-row" data-reorder-index="${index}">
            <div class="reorder-main">
              ${unit.superset ? `<span class="superset-chip">${icon('layers', 12)} Superset</span>` : ''}
              ${unit.items
                .map(
                  (item) => `
                <div class="reorder-item">
                  <span class="exercise-thumb ${item.imageUrl ? '' : 'gray'}" style="width:38px;height:38px;border-radius:10px">
                    ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : icon('dumbbell', 16)}
                  </span>
                  <span class="reorder-name">${esc(item.name)}</span>
                </div>`
                )
                .join('')}
            </div>
            <div class="reorder-actions">
              <button type="button" data-reorder-dir="up" ${index === 0 ? 'disabled' : ''} aria-label="Mover arriba">${icon('arrowUp', 15)}</button>
              <button type="button" data-reorder-dir="down" ${index === units.length - 1 ? 'disabled' : ''} aria-label="Mover abajo">${icon('arrowDown', 15)}</button>
            </div>
          </div>`
        )
        .join('');
    };

    modal.body.addEventListener('click', (event) => {
      const button = event.target.closest('[data-reorder-dir]');
      if (!button) return;
      const row = button.closest('[data-reorder-index]');
      const index = Number(row.dataset.reorderIndex);
      const target = button.dataset.reorderDir === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= units.length) return;
      [units[index], units[target]] = [units[target], units[index]];
      renderReorder();
    });

    renderReorder();
  };

  // --- set interactions ---
  container.querySelector('[data-exercises]').addEventListener('input', (event) => {
    const field = event.target.closest('[data-field]');
    if (!field) return;
    const block = field.closest('[data-we-id]');
    const row = field.closest('[data-set-id]');
    // Preserve ids as-is (string for local, numeric-as-string for server).
    const weId = block.dataset.weId;
    const setId = row.dataset.setId;
    const set = getSet(weId, setId);
    if (!set) return;
    const raw = field.value;
    const parsed = parseDecimalInput(raw);

    // Invalid input (e.g. "5kg", stray letters) must not silently become 0.
    // Flag the field and leave the stored value untouched until it is fixed.
    if (parsed === INVALID) {
      field.classList.add('input-error');
      return;
    }
    field.classList.remove('input-error');

    let value = parsed;
    if (value != null) {
      // Clamp negatives to 0 and keep reps integer. Only overwrite the field
      // when we actually changed it, so mid-typing values like "60." are not
      // clobbered.
      let corrected = false;
      if (value < 0) {
        value = 0;
        corrected = true;
      }
      if (field.dataset.field === 'reps') value = Math.round(value);
      if (corrected) field.value = String(value);
    }
    set[field.dataset.field] = value;
    renderStats();
    persistSet(weId, setId);
  });

  container.querySelector('[data-exercises]').addEventListener('click', async (event) => {
    const block = event.target.closest('[data-we-id]');
    if (!block) return;
    // Preserve ids as-is (string for local, numeric-as-string for server).
    const weId = block.dataset.weId;

    const prevFill = event.target.closest('[data-prev-fill]');
    if (prevFill) {
      const wrapper = prevFill.closest('[data-set-id]');
      const setId = wrapper.dataset.setId;
      const exercise = getExercise(weId);
      const set = getSet(weId, setId);
      if (!exercise || !set) return;
      const index = exercise.sets.indexOf(set);
      const previous =
        exercise.previousSets?.[index] ||
        exercise.previousSets?.[exercise.previousSets.length - 1];
      if (!previous) return;
      if (previous.weightKg != null) set.weightKg = previous.weightKg;
      if (previous.reps != null) set.reps = previous.reps;
      const weightInput = wrapper.querySelector('[data-field="weightKg"]');
      const repsInput = wrapper.querySelector('[data-field="reps"]');
      if (weightInput && set.weightKg != null) weightInput.value = String(set.weightKg);
      if (repsInput && set.reps != null) repsInput.value = String(set.reps);
      haptic(8);
      renderStats();
      persistSet(weId, setId);
      return;
    }

    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const wrapper = toggle.closest('[data-set-id]');
      const setId = wrapper.dataset.setId;
      const set = getSet(weId, setId);
      if (!set) return;
      set.completed = !set.completed;
      wrapper.querySelector('[data-set-handle]')?.classList.toggle('completed', set.completed);
      toggle.classList.toggle('checked', set.completed);
      if (set.completed) {
        haptic(12);
        // Start the rest countdown from this set's planned rest (or a default).
        startRestTimer(set.restSeconds);
      }
      renderStats();
      // Route through the scheduler and flush immediately: this serialises the
      // completion write against any in-flight weight/reps write for the same
      // set, so they can't clobber each other, and keeps it dirty on failure.
      setWrites.schedule(setId);
      setWrites.flushKey(setId);
      return;
    }

    const addSet = event.target.closest('[data-add-set]');
    if (addSet) {
      try {
        // Online: the repo returns the server-created set; offline: the repo
        // returns the set it appended to the local model.
        const { local, set } = await repo.addSet(weId, {});
        workout = repo.current;
        ctx.setActiveWorkout(workout);
        if (!local && set) {
          // Online path: the model does not own the workout, so append the new
          // set to the in-memory exercise just like before.
          const exercise = getExercise(weId);
          if (exercise) exercise.sets.push(set);
        }
        renderExercises();
        renderOfflineState();
      } catch (error) {
        if (error.status === 401) ctx.handleUnauthorized();
        else toast(errorMessage(error), 'error');
      }
      return;
    }

    const menu = event.target.closest('[data-exercise-menu]');
    if (menu) {
      const exercise = getExercise(weId);
      const items = [
        {
          label: 'Reordenar Ejercicios',
          icon: 'sort',
          onClick: openReorderSheet,
        },
        {
          label: 'Reemplazar Ejercicio',
          icon: 'refresh',
          onClick: () => openReplacePicker(exercise),
        },
      ];

      if (workout.exercises.length > 1) {
        items.push({
          label: 'Agregar a Superserie',
          icon: 'layers',
          onClick: () => openSupersetSheet(exercise),
        });
      }

      if (exercise.supersetGroup != null) {
        items.push({
          label: 'Quitar de Superserie',
          icon: 'x',
          onClick: async () => {
            try {
              const { workout: fresh } = await api.workouts.removeFromSuperset(
                workout.id,
                weId
              );
              applyWorkout(fresh);
              toast('Superserie deshecha', 'success');
            } catch (error) {
              if (error.status === 401) ctx.handleUnauthorized();
              else toast(errorMessage(error), 'error');
            }
          },
        });
      }

      items.push({
        label: 'Eliminar Ejercicio',
        icon: 'trash',
        danger: true,
        onClick: async () => {
          try {
            await repo.deleteExercise(weId);
            workout = repo.current;
            // Online the repo returns the server's fresh workout; offline the
            // model removed the exercise in place. Either way repo.current is
            // authoritative.
            applyWorkout(workout);
          } catch (error) {
            if (error.status === 401) ctx.handleUnauthorized();
            else toast(errorMessage(error), 'error');
          }
        },
      });

      openActionSheet(exercise.name, items);
    }
  });

  // --- add exercise picker (shared module with muscle-group filter) ---
  container.querySelector('[data-add-exercise]')?.addEventListener('click', () => {
    openExercisePicker({
      userId,
      onPick: async (item) => {
        try {
          // Online: POST and adopt the server's fresh workout. Offline: the repo
          // appends the exercise to the local model (keeping name/category/
          // imageUrl for rendering). repo.current is authoritative afterwards.
          await repo.addExercise(item);
          workout = repo.current;
          ctx.setActiveWorkout(workout);
          renderExercises();
          renderOfflineState();
          toast(`${item.name} añadido`, 'success');
        } catch (error) {
          if (error.status === 401) ctx.handleUnauthorized();
          else toast(errorMessage(error), 'error');
        }
      },
    });
  });

  // --- finish ---
  container.querySelector('[data-finish]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const totals = computeTotals(workout);
    if (totals.sets === 0) {
      const confirmed = await confirmDialog({
        title: 'Terminar sin series',
        message: 'No has completado ninguna serie. ¿Terminar de todas formas?',
        confirmLabel: 'Terminar',
      });
      if (!confirmed) return;
    }
    setLoading(button, true, '');
    try {
      // Persist any pending set edits before finishing so the last change is
      // never lost in the debounce window.
      await setWrites.flush();
      workout = repo.current;
      const result = await repo.finish({});
      if (result.pending) {
        // Finished offline: the workout does not exist on the server yet, so we
        // cannot navigate to /workouts/:id. Keep the snapshot for later sync.
        ctx.setActiveWorkout(null);
        haptic([12, 40, 24]);
        toast('Entreno guardado localmente; se sincronizará al recuperar la conexión', 'success');
        ctx.navigate('/');
        return;
      }
      const { finished } = result;
      ctx.setActiveWorkout(null);
      haptic([12, 40, 24]);
      toast('¡Entrenamiento guardado!', 'success');
      ctx.navigate(`/workouts/${finished.id}`);
    } catch (error) {
      setLoading(button, false);
      button.innerHTML = icon('check', 20);
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  });

  // --- discard ---
  container.querySelector('[data-discard]')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Descartar entrenamiento',
      message: 'Se eliminará este entrenamiento en curso y sus series. Esta acción no se puede deshacer.',
      confirmLabel: 'Descartar',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await repo.discard();
      ctx.setActiveWorkout(null);
      toast('Entrenamiento descartado', 'success');
      ctx.navigate('/');
    } catch (error) {
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  });

  // Flush pending set writes when the tab is hidden or the page is being
  // unloaded (backgrounding on mobile, closing the PWA, hard reload). This is
  // best-effort: the requests use keepalive-friendly absolute values so a later
  // retry is harmless. Without this, a pending debounce would be lost.
  const flushOnHide = () => {
    if (setWrites.hasPending()) setWrites.flush();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      flushOnHide();
      return;
    }
    // Back in the foreground: the duration clock and the rest timer are both
    // anchored to absolute timestamps, so recompute them right away instead of
    // waiting for the next interval. This corrects any drift accumulated while
    // iOS/Safari had the PWA frozen in the background.
    tick();
    if (restTimer.running) restTick();
  };
  window.addEventListener('pagehide', flushOnHide);
  document.addEventListener('visibilitychange', onVisibility);

  // --- reconnect handling ---
  // When connectivity returns mid-workout we do NOT upload yet: the workout is
  // still in progress and uploading it would finish it prematurely (the /sync
  // endpoint materializes a finished workout). We just drop the offline pill
  // and refill the "Anterior" (previous set) suggestions, which need the server
  // but NOT the current workout — they come from past finished workouts.
  const onOnline = async () => {
    renderOfflineState();
    if (!repo.isLocal()) return;
    // Only exercises linked to a server exercise id can have history.
    const ids = [
      ...new Set(
        workout.exercises
          .map((ex) => ex.exerciseId)
          .filter((id) => Number.isInteger(id))
      ),
    ];
    if (!ids.length) return;
    try {
      const { suggestions } = await api.workouts.suggestions(ids);
      for (const exercise of workout.exercises) {
        const prev = suggestions[exercise.exerciseId];
        if (Array.isArray(prev)) exercise.previousSets = prev;
      }
      renderExercises();
    } catch (error) {
      if (error.status === 401) ctx.handleUnauthorized();
      // Otherwise non-fatal: suggestions just stay empty until finish/reload.
    }
  };
  window.addEventListener('online', onOnline);

  return () => {
    clearInterval(timerId);
    if (restInterval) clearInterval(restInterval);
    window.removeEventListener('pagehide', flushOnHide);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    // Flush (do NOT cancel) pending set writes on navigation so edits made
    // right before leaving the view are persisted instead of dropped.
    setWrites.flush();
  };
}
