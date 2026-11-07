// Shared view helpers: markup and label builders that several views used to
// duplicate. Keeping one implementation avoids drift when a card or label needs
// to change. These are pure string builders (no DOM, no listeners); the views
// still attach their own click handlers via data-link.

import { esc, icon, formatDate, formatDuration, formatVolume } from './ui.js';

/**
 * Run a view's initial data load, handling the three outcomes every view
 * repeats by hand: a 401 (session lost), an offline error (the request never
 * reached the server), and any other error (render a retry screen).
 *
 * Views used to inline the same ~20-line try/catch around their first fetch;
 * this centralises that glue without touching how a view renders or keeps its
 * state. It only covers the INITIAL load — action handlers (save/delete/
 * paginate) keep their own error handling, which is view-specific.
 *
 * Returns one of:
 *   - { ok: true, data }          the loader resolved; render normally
 *   - { ok: true, offline: true } the server was unreachable; render offline
 *   - { ok: false }               already handled (401 redirect, or the error
 *                                 screen was painted); the view must abort
 *
 * On a non-offline error it paints the retry screen into `container`; the
 * retry button (data-retry) re-runs the current route via ctx.refresh().
 *
 * @param {HTMLElement} container
 * @param {object} ctx  The view context (needs handleUnauthorized + refresh).
 * @param {() => Promise<any>} loader  Performs the fetch and returns its data.
 * @param {object} [options]
 * @param {string} [options.errorTitle] Heading for the error screen.
 */
export async function loadView(container, ctx, loader, { errorTitle } = {}) {
  try {
    const data = await loader();
    return { ok: true, data };
  } catch (error) {
    if (error?.status === 401) {
      ctx.handleUnauthorized();
      return { ok: false };
    }
    if (error?.status === 0) {
      return { ok: true, offline: true };
    }
    const title = errorTitle ? esc(errorTitle) : 'No se pudo cargar';
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${icon('info', 24)}</div>
        <h3>${title}</h3>
        <p>${esc(error?.message || 'Algo salió mal')}</p>
        <button type="button" class="btn btn-secondary btn-sm" data-retry>Reintentar</button>
      </div>`;
    container
      .querySelector('[data-retry]')
      ?.addEventListener('click', () => ctx.refresh());
    return { ok: false };
  }
}

/**
 * A tappable workout summary card linking to the workout detail.
 * Options tune the small differences between the views that use it:
 *   - withYear: show the year in the date (history groups span years).
 *   - showRecords: show the "N PR" badge when the workout set records.
 *   - showExerciseCount: include the exercise-count stat.
 */
export function workoutCard(
  workout,
  { withYear = false, showRecords = true, showExerciseCount = true } = {}
) {
  const records =
    showRecords && workout.summary?.records
      ? `<span class="badge badge-warning">${icon('trophy', 11)} ${workout.summary.records} PR</span>`
      : '';
  const exerciseCount = showExerciseCount
    ? `<span class="stat-mini">${icon('layers', 13)} ${workout.exercises.length} ejercicios</span>`
    : '';
  return `
    <button type="button" class="workout-card" data-link="/workouts/${workout.id}">
      <div class="workout-card-top">
        <div class="grow" style="min-width:0">
          <div class="name">${esc(workout.name)}</div>
          <div class="date">${esc(formatDate(workout.startedAt, { withYear }))} · ${esc(formatDuration(workout.durationSeconds))}</div>
        </div>
        ${records}
        ${icon('chevronRight', 17)}
      </div>
      <div class="stats">
        <span class="stat-mini">${icon('dumbbell', 13)} ${formatVolume(workout.summary?.volume)} kg</span>
        <span class="stat-mini">${icon('check', 13)} ${workout.summary?.sets || 0} series</span>
        ${exerciseCount}
      </div>
    </button>
  `;
}

/**
 * Label for a 7-day week starting at `weekStart` (ISO date). Dates are rendered
 * in UTC to match how the server buckets weeks. Returns '' for an invalid date.
 */
export function weekRangeLabel(weekStart) {
  const start = new Date(weekStart);
  if (Number.isNaN(start.getTime())) return '';
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d, withMonth) =>
    d.toLocaleDateString('es-ES', {
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
      timeZone: 'UTC',
    });
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return `${fmt(start, !sameMonth)} – ${fmt(end, true)}`;
}
