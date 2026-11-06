import { api, errorMessage } from '../api.js';
import { openExercisePicker } from '../exercise-picker.js';
import {
  confirmDialog,
  debounce,
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

function prevLabel(previousSets, index) {
  const prev = previousSets?.[index] || previousSets?.[previousSets.length - 1];
  if (!prev) return '—';
  const weight = prev.weightKg != null ? `${formatNumber(prev.weightKg, 1)}kg` : '—';
  return `${weight} × ${prev.reps ?? '—'}`;
}

function setRow(exercise, set, index) {
  return `
    <div class="set-row ${set.completed ? 'completed' : ''}" data-set-id="${set.id}">
      <div class="set-num">${index + 1}</div>
      <div class="set-cell" style="display:flex;flex-direction:column;gap:2px">
        <span class="text-xs text-muted" style="text-align:center;font-size:10px">${esc(prevLabel(exercise.previousSets, index))}</span>
        <input class="number-input" type="number" inputmode="decimal" step="0.5" placeholder="0"
          enterkeyhint="next"
          value="${set.weightKg != null ? esc(String(set.weightKg)) : ''}" data-field="weightKg" aria-label="Peso en kg" />
      </div>
      <div class="set-cell">
        <input class="number-input" type="number" inputmode="numeric" placeholder="0"
          enterkeyhint="done"
          value="${set.reps != null ? esc(String(set.reps)) : ''}" data-field="reps" aria-label="Repeticiones" />
      </div>
      <button type="button" class="check-btn ${set.completed ? 'checked' : ''}" data-toggle aria-label="Completar serie">
        ${icon('check', 18)}
      </button>
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
          <span class="l">Kg</span>
          <span class="l">Reps</span>
          <span>${icon('check', 13)}</span>
        </div>
        ${exercise.sets.map((set, index) => setRow(exercise, set, index)).join('')}
      </div>
      <button type="button" class="add-set-btn" data-add-set>${icon('plus', 15)} Agregar Serie</button>
    </div>
  `;
}

export async function render(container, ctx) {
  let workout = ctx.activeWorkout;
  try {
    const { workout: fresh } = await api.workouts.active();
    workout = fresh;
  } catch (error) {
    if (error.status === 401) {
      ctx.handleUnauthorized();
      return;
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

  const renderStats = () => {
    const totals = computeTotals(workout);
    const volumeEl = container.querySelector('[data-stat-volume]');
    const setsEl = container.querySelector('[data-stat-sets]');
    if (volumeEl) volumeEl.textContent = `${formatVolume(totals.volume)} kg`;
    if (setsEl) setsEl.textContent = String(totals.sets);
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
  };

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
          </div>
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
  `;

  renderExercises();

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

  const getExercise = (weId) => workout.exercises.find((ex) => ex.id === weId);
  const getSet = (weId, setId) => {
    const exercise = getExercise(weId);
    return exercise?.sets.find((set) => set.id === setId);
  };

  const persistSet = debounce(async (weId, setId) => {
    const set = getSet(weId, setId);
    if (!set) return;
    try {
      await api.workouts.updateSet(workout.id, setId, {
        weightKg: set.weightKg,
        reps: set.reps,
        completed: set.completed,
      });
    } catch (error) {
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  }, 500);

  const applyWorkout = (fresh) => {
    workout = fresh;
    ctx.setActiveWorkout(workout);
    renderExercises();
  };

  const openReplacePicker = (exercise) => {
    openExercisePicker({
      title: 'Reemplazar ejercicio',
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
    const weId = Number(block.dataset.weId);
    const setId = Number(row.dataset.setId);
    const set = getSet(weId, setId);
    if (!set) return;
    const value = field.value === '' ? null : Number(field.value);
    set[field.dataset.field] = value;
    renderStats();
    persistSet(weId, setId);
  });

  container.querySelector('[data-exercises]').addEventListener('click', async (event) => {
    const block = event.target.closest('[data-we-id]');
    if (!block) return;
    const weId = Number(block.dataset.weId);

    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const row = toggle.closest('[data-set-id]');
      const setId = Number(row.dataset.setId);
      const set = getSet(weId, setId);
      if (!set) return;
      set.completed = !set.completed;
      row.classList.toggle('completed', set.completed);
      toggle.classList.toggle('checked', set.completed);
      if (set.completed) haptic(12);
      renderStats();
      try {
        await api.workouts.updateSet(workout.id, setId, {
          weightKg: set.weightKg,
          reps: set.reps,
          completed: set.completed,
        });
      } catch (error) {
        if (error.status === 401) ctx.handleUnauthorized();
        else toast(errorMessage(error), 'error');
      }
      return;
    }

    const addSet = event.target.closest('[data-add-set]');
    if (addSet) {
      try {
        const { set } = await api.workouts.addSet(workout.id, weId, {});
        const exercise = getExercise(weId);
        exercise.sets.push(set);
        renderExercises();
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
            const { workout: fresh } = await api.workouts.removeExercise(
              workout.id,
              weId
            );
            applyWorkout(fresh);
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        },
      });

      openActionSheet(exercise.name, items);
    }
  });

  // --- add exercise picker (shared module with muscle-group filter) ---
  container.querySelector('[data-add-exercise]')?.addEventListener('click', () => {
    openExercisePicker({
      onPick: async (item) => {
        try {
          const { workout: fresh } = await api.workouts.addExercise(workout.id, {
            ...(item.exerciseId ? { exerciseId: item.exerciseId } : {}),
            ...(item.catalogId ? { catalogId: item.catalogId } : {}),
          });
          workout = fresh;
          ctx.setActiveWorkout(workout);
          renderExercises();
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
      const { workout: finished } = await api.workouts.finish(workout.id, {});
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
      await api.workouts.remove(workout.id);
      ctx.setActiveWorkout(null);
      toast('Entrenamiento descartado', 'success');
      ctx.navigate('/');
    } catch (error) {
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  });

  return () => {
    clearInterval(timerId);
    persistSet.cancel?.();
  };
}
