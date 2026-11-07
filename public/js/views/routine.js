import { api, errorMessage } from '../api.js';
import { lineChart, attachLineChart } from '../charts.js';
import {
  confirmDialog,
  esc,
  formatDate,
  formatDuration,
  formatNumber,
  formatVolume,
  icon,
  openActionSheet,
  setLoading,
  toast,
} from '../ui.js';

const METRICS = {
  volume: { label: 'Volumen', valueKey: 'volume', formatValue: (v) => `${formatVolume(v)} kg` },
  reps: { label: 'Repeticiones', valueKey: 'reps', formatValue: (v) => formatNumber(v) },
  duration: {
    label: 'Duración',
    valueKey: 'durationSeconds',
    formatValue: (v) => formatDuration(v, { short: true }),
  },
};

function setPreview(lastSets = []) {
  if (!lastSets.length) return '';
  return `
    <div class="set-chips">
      ${lastSets
        .slice(0, 4)
        .map(
          (set) =>
            `<span class="set-chip">${set.weightKg != null ? `${formatNumber(set.weightKg, 1)}kg` : '—'} × ${set.reps ?? '—'}</span>`
        )
        .join('')}
    </div>`;
}

export async function render(container, ctx, params) {
  const id = params.id;
  let data;
  try {
    const response = await api.routines.detail(id, 'year');
    data = response.routine;
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

  const history = data.history || [];
  let metric = 'volume';
  const lastVolume = history.length ? history[history.length - 1] : null;

  // Imported routines are read-only: a later Hevy sync would overwrite any edit.
  const readOnly = data.source === 'hevy';

  const chartHtml = (key) => {
    const config = METRICS[key];
    return lineChart({
      data: history,
      valueKey: config.valueKey,
      labelKey: 'date',
      height: 170,
      formatValue: config.formatValue,
      interactive: true,
      tooltipRows: (item) => [
        [formatDate(item.date), ''],
        ['Volumen', `${formatVolume(item.volume || 0)} kg`],
        ['Repeticiones', formatNumber(item.reps || 0)],
        ['Series', String(item.sets || 0)],
        ['Duración', formatDuration(item.durationSeconds || 0, { short: true })],
      ],
    });
  };

  container.innerHTML = `
    <div class="view">
      <div class="topbar">
        <button type="button" class="icon-btn surface" data-link="/routines" aria-label="Volver">
          ${icon('arrowLeft', 19)}
        </button>
        <div class="topbar-title">Rutina</div>
        <button type="button" class="icon-btn surface" data-menu aria-label="Opciones">
          ${icon('more', 19)}
        </button>
      </div>

      <div class="page-head">
        <h1>${esc(data.name)}</h1>
        ${data.description ? `<p class="text-muted text-sm">${esc(data.description)}</p>` : ''}
        ${data.folder ? `<span class="chip" style="align-self:flex-start">${icon('folder', 13)} ${esc(data.folder)}</span>` : ''}
        ${data.source === 'hevy' ? `<span class="chip-hevy" style="align-self:flex-start">${icon('repeat', 13)} Importada de Hevy</span>` : ''}
      </div>

      <button type="button" class="btn btn-primary btn-block" data-start>
        ${icon('play', 17)} Comenzar Rutina
      </button>

      <section class="chart-card">
        <div class="chart-head">
          <div>
            <div class="t">${lastVolume ? esc(`${formatVolume(lastVolume.volume)} kg`) : 'Sin datos'}</div>
            <div class="s" data-chart-title>${METRICS[metric].label}${lastVolume ? ` · ${esc(formatDate(lastVolume.date))}` : ''}</div>
          </div>
        </div>
        <div data-chart>${chartHtml(metric)}</div>
        <div class="segmented" data-metrics>
          ${Object.entries(METRICS)
            .map(
              ([key, config]) =>
                `<button type="button" class="${key === metric ? 'active' : ''}" data-metric="${key}">${config.label}</button>`
            )
            .join('')}
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>Ejercicios</h2>
          ${
            readOnly
              ? `<span class="hint">${icon('eye', 12)} Solo lectura</span>`
              : `<a class="link-btn" href="#/routines/${data.id}/edit" data-link="/routines/${data.id}/edit">Editar</a>`
          }
        </div>
        <div class="exercise-list">
          ${
            data.exercises.length
              ? data.exercises
                  .map(
                    (item) => `
                    <div class="routine-exercise" style="flex-direction:column;align-items:stretch;gap:10px">
                      <div class="row">
                        <span class="exercise-thumb ${item.exercise.imageUrl ? '' : 'gray'}">
                          ${item.exercise.imageUrl ? `<img src="${esc(item.exercise.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : icon('dumbbell', 22)}
                        </span>
                        <div class="info">
                          <div class="name">${esc(item.exercise.name)}</div>
                          <div class="target">${item.targetSets} series · ${esc(item.targetReps || '8-12')} reps</div>
                        </div>
                      </div>
                      ${setPreview(item.lastSets)}
                      ${item.notes ? `<div class="last">${icon('info', 12)} ${esc(item.notes)}</div>` : ''}
                    </div>`
                  )
                  .join('')
              : `<div class="card"><div class="empty" style="padding:18px 8px">
                   <div class="empty-icon">${icon('dumbbell', 22)}</div>
                   <h3>Rutina vacía</h3>
                   ${
                     readOnly
                       ? `<p>Esta rutina se importó de Hevy y es de solo lectura.</p>`
                       : `<p>Edita la rutina para añadir ejercicios.</p>
                          <a class="btn btn-primary btn-sm" href="#/routines/${data.id}/edit" data-link="/routines/${data.id}/edit">${icon('pencil', 15)} Editar</a>`
                   }
                 </div></div>`
          }
        </div>
      </section>
    </div>
  `;

  attachLineChart(container.querySelector('[data-chart]'));

  const start = async (button) => {
    setLoading(button, true, 'Empezando...');
    try {
      await api.routines.start(data.id);
      ctx.navigate('/workout/active');
    } catch (error) {
      setLoading(button, false);
      if (error.status === 409) ctx.navigate('/workout/active');
      else if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  };

  container.querySelector('[data-start]')?.addEventListener('click', (event) => {
    start(event.currentTarget);
  });

  container.querySelector('[data-metrics]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-metric]');
    if (!button) return;
    metric = button.dataset.metric;
    container.querySelectorAll('[data-metric]').forEach((item) => {
      item.classList.toggle('active', item.dataset.metric === metric);
    });
    container.querySelector('[data-chart]').innerHTML = chartHtml(metric);
    attachLineChart(container.querySelector('[data-chart]'));
    const title = container.querySelector('[data-chart-title]');
    if (title) {
      title.textContent = `${METRICS[metric].label}${lastVolume ? ` · ${formatDate(lastVolume.date)}` : ''}`;
    }
  });

  container.querySelector('[data-menu]')?.addEventListener('click', () => {
    const items = [];
    if (!readOnly) {
      items.push({
        label: 'Editar rutina',
        icon: 'pencil',
        onClick: () => ctx.navigate(`/routines/${data.id}/edit`),
      });
    }
    items.push(
      {
        label: 'Duplicar',
        icon: 'repeat',
        onClick: async () => {
          try {
            await api.routines.duplicate(data.id);
            toast('Rutina duplicada', 'success');
            ctx.navigate('/routines');
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        },
      },
      {
        label: 'Eliminar',
        icon: 'trash',
        danger: true,
        onClick: async () => {
          const confirmed = await confirmDialog({
            title: 'Eliminar rutina',
            message: `"${data.name}" se eliminará. Los entrenamientos ya registrados se conservarán.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!confirmed) return;
          try {
            await api.routines.remove(data.id);
            toast('Rutina eliminada', 'success');
            ctx.navigate('/routines');
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        },
      }
    );
    openActionSheet(data.name, items);
  });
}
