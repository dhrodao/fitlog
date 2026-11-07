// Shared view helpers: markup and label builders that several views used to
// duplicate. Keeping one implementation avoids drift when a card or label needs
// to change. These are pure string builders (no DOM, no listeners); the views
// still attach their own click handlers via data-link.

import { esc, icon, formatDate, formatDuration, formatVolume } from './ui.js';

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
