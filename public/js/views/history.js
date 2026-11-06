import { api, errorMessage } from '../api.js';
import { attachPullToRefresh } from '../pull-refresh.js';
import {
  esc,
  formatDate,
  formatDuration,
  formatMonth,
  formatVolume,
  icon,
  monthKey,
  setLoading,
} from '../ui.js';

const PAGE_SIZE = 20;

function groupByMonth(workouts) {
  const groups = new Map();
  for (const workout of workouts) {
    const key = monthKey(workout.startedAt);
    if (!groups.has(key)) {
      groups.set(key, { key, label: formatMonth(workout.startedAt), workouts: [] });
    }
    groups.get(key).workouts.push(workout);
  }
  return Array.from(groups.values());
}

function workoutCard(workout) {
  return `
    <button type="button" class="workout-card" data-link="/workouts/${workout.id}">
      <div class="workout-card-top">
        <div class="grow" style="min-width:0">
          <div class="name">${esc(workout.name)}</div>
          <div class="date">${esc(formatDate(workout.startedAt, { withYear: true }))} · ${esc(formatDuration(workout.durationSeconds))}</div>
        </div>
        ${workout.summary?.records ? `<span class="badge badge-warning">${icon('trophy', 11)} ${workout.summary.records} PR</span>` : ''}
        ${icon('chevronRight', 17)}
      </div>
      <div class="stats">
        <span class="stat-mini">${icon('dumbbell', 13)} ${formatVolume(workout.summary?.volume)} kg</span>
        <span class="stat-mini">${icon('check', 13)} ${workout.summary?.sets || 0} series</span>
        <span class="stat-mini">${icon('layers', 13)} ${workout.exercises.length} ejercicios</span>
      </div>
    </button>
  `;
}

export async function render(container, ctx) {
  let workouts = [];
  let offset = 0;
  let hasMore = true;

  const loadPage = async () => {
    const { workouts: page } = await api.workouts.list(PAGE_SIZE, offset);
    workouts = workouts.concat(page);
    offset += page.length;
    hasMore = page.length === PAGE_SIZE;
  };

  try {
    await loadPage();
  } catch (error) {
    if (error.status === 401) {
      ctx.handleUnauthorized();
      return;
    }
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${icon('info', 24)}</div>
        <h3>No se pudo cargar el historial</h3>
        <p>${esc(errorMessage(error))}</p>
        <button type="button" class="btn btn-secondary btn-sm" data-retry>Reintentar</button>
      </div>`;
    container.querySelector('[data-retry]')?.addEventListener('click', () => ctx.refresh());
    return;
  }

  const renderBody = () => {
    const groups = groupByMonth(workouts);
    const body = container.querySelector('[data-body]');
    if (!workouts.length) {
      body.innerHTML = `<div class="card"><div class="empty" style="padding:24px 8px">
        <div class="empty-icon">${icon('history', 24)}</div>
        <h3>Sin entrenamientos</h3>
        <p>Cuando termines tu primer entreno aparecerá aquí.</p>
        <a class="btn btn-primary btn-sm" href="#/routines" data-link="/routines">${icon('play', 15)} Empezar</a>
      </div></div>`;
      return;
    }
    body.innerHTML = `
      ${groups
        .map(
          (group) => `
        <div class="history-month">
          <div class="history-month-title"><span>${esc(group.label)}</span><span>${group.workouts.length}</span></div>
          <div class="stack-sm">${group.workouts.map(workoutCard).join('')}</div>
        </div>`
        )
        .join('')}
      ${hasMore ? `<button type="button" class="btn btn-secondary btn-block" data-more>${icon('chevronDown', 16)} Cargar más</button>` : ''}
    `;
  };

  container.innerHTML = `
    <div class="view stagger">
      <div class="page-head">
        <span class="eyebrow">Tu progreso</span>
        <h1>Historial</h1>
      </div>
      <div class="stack" data-body></div>
    </div>
  `;

  renderBody();

  container.querySelector('[data-body]').addEventListener('click', async (event) => {
    const more = event.target.closest('[data-more]');
    if (!more) return;
    setLoading(more, true, 'Cargando...');
    try {
      await loadPage();
      renderBody();
    } catch (error) {
      setLoading(more, false);
      if (error.status === 401) ctx.handleUnauthorized();
    }
  });

  return attachPullToRefresh({ onRefresh: () => ctx.refresh() });
}
