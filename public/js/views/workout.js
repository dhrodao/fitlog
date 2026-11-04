import { api, errorMessage } from '../api.js';
import {
  confirmDialog,
  esc,
  formatDate,
  formatDuration,
  formatNumber,
  formatTime,
  formatVolume,
  icon,
  openActionSheet,
  toast,
} from '../ui.js';

function setChip(set) {
  const weight = set.weightKg != null ? `${formatNumber(set.weightKg, 1)}kg` : '—';
  return `<span class="set-chip ${set.completed ? 'done' : ''}">${weight} × ${set.reps ?? '—'}</span>`;
}

function exerciseBlock(exercise) {
  const done = exercise.sets.filter((set) => set.completed).length;
  return `
    <div class="detail-exercise">
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
    </div>
  `;
}

export async function render(container, ctx, params) {
  const id = params.id;
  let workout;
  try {
    const response = await api.workouts.detail(id);
    workout = response.workout;
  } catch (error) {
    if (error.status === 401) {
      ctx.handleUnauthorized();
      return;
    }
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${icon('info', 24)}</div>
        <h3>No se pudo cargar el entrenamiento</h3>
        <p>${esc(errorMessage(error))}</p>
        <a class="btn btn-secondary btn-sm" href="#/workouts" data-link="/workouts">Volver</a>
      </div>`;
    return;
  }

  // If the workout is still active, send the user to the live screen.
  if (workout.active) {
    ctx.navigate('/workout/active', { replace: true });
    return;
  }

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
              ? workout.exercises.map(exerciseBlock).join('')
              : `<div class="card"><div class="empty" style="padding:18px 8px">
                   <div class="empty-icon">${icon('dumbbell', 22)}</div>
                   <h3>Sin ejercicios registrados</h3>
                 </div></div>`
          }
        </div>
      </section>
    </div>
  `;

  container.querySelector('[data-menu]')?.addEventListener('click', () => {
    const items = [];
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
