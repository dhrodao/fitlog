// Shared exercise detail view, opened by tapping an exercise's name/image in a
// workout (past or in progress). It mirrors the Hevy layout: a tabbed modal
// with Resumen (chart + personal records), Historial (every logged session with
// its sets) and Indicaciones (catalog muscles, equipment and instructions).
//
// Read-only and available for every exercise that has an exercises-table id.
// The endpoint is owner-scoped, so it only ever returns the current user's
// data. `exerciseId` is the exercises-table id (exercise.exerciseId in a
// workout detail), NOT the workout_exercise row id.
import { api, errorMessage } from './api.js';
import { lineChart, attachLineChart } from './charts.js';
import {
  esc,
  formatDate,
  formatNumber,
  formatVolume,
  formatWeight,
  icon,
  openModal,
  toast,
} from './ui.js';

const TABS = [
  { key: 'summary', label: 'Resumen' },
  { key: 'history', label: 'Historial' },
  { key: 'guide', label: 'Indicaciones' },
];

// e1RM shown here is an Epley ESTIMATE from each logged set, not a tested max;
// the UI labels it as "estimado" so it is never read as a true one-rep max.
function summaryTab(stats) {
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
        <p class="pr-note">${icon('info', 12)}<span>El 1RM es un valor <b>estimado</b> (fórmula de Epley), no una marca real.</span></p>
      </div>
    </div>
  `;
}

function historyTab(stats) {
  const history = Array.isArray(stats.history) ? stats.history : [];
  if (!history.length) {
    return `<div class="chart-empty">Aún no has registrado este ejercicio en ningún entrenamiento</div>`;
  }

  // Most recent session first (the endpoint returns them oldest-first).
  const sessions = [...history].reverse();

  const setLine = (set, index) => {
    const weight = set.weightKg != null ? `${formatNumber(set.weightKg, 1)} kg` : '—';
    const reps = set.reps != null ? set.reps : '—';
    return `
      <div class="hist-set">
        <span class="hist-set-num">${index + 1}</span>
        <span class="hist-set-val">${esc(weight)} × ${esc(String(reps))}</span>
      </div>`;
  };

  const card = (session) => `
    <div class="hist-session">
      <div class="hist-session-head">
        <div class="hist-session-title">${esc(session.name || 'Entrenamiento')}</div>
        <div class="hist-session-date">${esc(formatDate(session.date, { withYear: true }))}</div>
      </div>
      ${session.superset ? `<span class="superset-chip">${icon('layers', 12)} Superset</span>` : ''}
      <div class="hist-sets">
        ${(session.sets || []).map(setLine).join('')}
      </div>
    </div>`;

  return `<div class="hist-list">${sessions.map(card).join('')}</div>`;
}

function guideTab(stats) {
  const detail = stats.detail;
  if (!detail) {
    return `<div class="chart-empty">No hay indicaciones del catálogo para este ejercicio</div>`;
  }

  const muscles = Array.isArray(detail.muscles) ? detail.muscles : [];
  const equipment = Array.isArray(detail.equipment) ? detail.equipment : [];
  const instructions = Array.isArray(detail.instructions) ? detail.instructions : [];

  const chipRow = (label, items) =>
    items.length
      ? `<div class="guide-block">
           <div class="guide-label">${esc(label)}</div>
           <div class="tag-list">${items.map((item) => `<span class="mini-chip">${esc(item)}</span>`).join('')}</div>
         </div>`
      : '';

  const steps = instructions.length
    ? `<div class="guide-block">
         <div class="guide-label">Cómo hacerlo</div>
         <ol class="guide-steps">${instructions.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
       </div>`
    : '';

  const image = detail.imageUrl
    ? `<div class="guide-image"><img src="${esc(detail.imageUrl)}" alt="" referrerpolicy="no-referrer" /></div>`
    : '';

  // A short looping animation when the catalog has one (Hevy), otherwise the
  // static thumbnail. Served by the app from disk, so same-origin. The image is
  // the poster so nothing flashes before the video loads; it plays as a silent,
  // controlless loop (like Hevy's own animation), so no scrubber is shown.
  const media = detail.videoUrl
    ? `<div class="guide-image"><video
         src="${esc(detail.videoUrl)}"
         ${detail.imageUrl ? `poster="${esc(detail.imageUrl)}"` : ''}
         muted loop autoplay playsinline></video></div>`
    : image;

  if (!muscles.length && !equipment.length && !instructions.length && !media) {
    return `<div class="chart-empty">No hay indicaciones del catálogo para este ejercicio</div>`;
  }

  return `
    <div class="guide">
      ${media}
      ${chipRow('Músculos', muscles)}
      ${chipRow('Equipamiento', equipment)}
      ${steps}
    </div>`;
}

function renderTab(body, stats, key) {
  const panel = body.querySelector('[data-detail-panel]');
  if (!panel) return;
  if (key === 'history') {
    panel.innerHTML = historyTab(stats);
  } else if (key === 'guide') {
    panel.innerHTML = guideTab(stats);
  } else {
    panel.innerHTML = summaryTab(stats);
    attachLineChart(panel.querySelector('[data-chart]'));
  }
}

/**
 * Open the exercise detail modal.
 * @param {object} ctx app context (for handleUnauthorized)
 * @param {{exerciseId:number, name?:string}} options
 */
export async function openExerciseDetail(ctx, { exerciseId, name } = {}) {
  const id = Number(exerciseId);
  if (!Number.isFinite(id)) return;

  const modal = openModal({
    title: name || 'Ejercicio',
    className: 'exercise-detail-modal',
    content: `<div class="progression-loading">${icon('clock', 20)} Cargando…</div>`,
  });

  let stats;
  try {
    stats = await api.stats.exercise(id);
  } catch (error) {
    if (error.status === 401) {
      modal.close();
      ctx.handleUnauthorized();
      return;
    }
    modal.body.innerHTML = `<div class="chart-empty">${esc(errorMessage(error))}</div>`;
    toast(errorMessage(error), 'error');
    return;
  }

  // Hide the Indicaciones tab when there is no catalog detail (custom exercise).
  const tabs = TABS.filter((tab) => tab.key !== 'guide' || stats.detail);

  modal.body.innerHTML = `
    <div class="detail-tabs" role="tablist">
      ${tabs
        .map(
          (tab, index) =>
            `<button type="button" class="detail-tab ${index === 0 ? 'active' : ''}" role="tab" data-tab="${tab.key}" aria-selected="${index === 0 ? 'true' : 'false'}">${esc(tab.label)}</button>`
        )
        .join('')}
    </div>
    <div class="detail-panel" data-detail-panel></div>
  `;

  renderTab(modal.body, stats, tabs[0].key);

  modal.body.querySelector('.detail-tabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    modal.body.querySelectorAll('.detail-tab').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderTab(modal.body, stats, button.dataset.tab);
  });

  return modal;
}
