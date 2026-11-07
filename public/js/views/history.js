import { api } from '../api.js';
import { attachPullToRefresh } from '../pull-refresh.js';
import { workoutCard, loadView } from '../view-helpers.js';
import {
  connectionNeeded,
  esc,
  formatMonth,
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

export async function render(container, ctx) {
  let workouts = [];
  let offset = 0;
  let hasMore = true;
  let offline = false;

  const loadPage = async () => {
    const { workouts: page } = await api.workouts.list(PAGE_SIZE, offset);
    workouts = workouts.concat(page);
    offset += page.length;
    hasMore = page.length === PAGE_SIZE;
  };

  const result = await loadView(container, ctx, () => loadPage(), {
    errorTitle: 'No se pudo cargar el historial',
  });
  if (!result.ok) return;
  if (result.offline) {
    // Offline: render the view header and show a "needs connection" block in
    // the list area instead of a full-screen error. No workouts are cached.
    offline = true;
    hasMore = false;
  }

  const renderBody = () => {
    const groups = groupByMonth(workouts);
    const body = container.querySelector('[data-body]');
    if (offline) {
      body.innerHTML = connectionNeeded(
        'Tu historial aparecerá cuando vuelvas a estar en línea.',
        'data-retry'
      );
      return;
    }
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
          <div class="stack-sm">${group.workouts.map((w) => workoutCard(w, { withYear: true })).join('')}</div>
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

  // Retry from the inline offline block re-runs the view load.
  container.querySelector('[data-retry]')?.addEventListener('click', () => ctx.refresh());

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
