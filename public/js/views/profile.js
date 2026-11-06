import { api, errorMessage } from '../api.js';
import { barChart } from '../charts.js';
import { currentTheme, toggleTheme } from '../theme.js';
import {
  avatar,
  confirmDialog,
  esc,
  formatDate,
  formatDuration,
  formatNumber,
  formatVolume,
  icon,
  openModal,
  toast,
} from '../ui.js';

const METRICS = {
  duration: {
    label: 'Duración',
    valueKey: 'durationSeconds',
    formatValue: (value) => formatDuration(value, { short: true }),
  },
  volume: {
    label: 'Volumen',
    valueKey: 'volume',
    formatValue: (value) => `${formatVolume(value)}`,
  },
  reps: {
    label: 'Repeticiones',
    valueKey: 'reps',
    formatValue: (value) => formatNumber(value),
  },
};

function totalsSummary(totals, write) {
  const rows = write
    ? [
        ['Entrenos importados', totals.imported],
        ['Omitidos (duplicados)', `${totals.skipped} (${totals.duplicates})`],
        ['Ejercicios', totals.exercises],
        ['Series', totals.sets],
      ]
    : [
        ['Entrenos a importar', totals.imported],
        ['Ejercicios', totals.exercises],
        ['Series', totals.sets],
      ];
  return `
    <div class="import-summary">
      ${rows
        .map(
          ([label, value]) =>
            `<div class="import-summary-row"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`
        )
        .join('')}
    </div>`;
}

function openHevyImport(ctx) {
  const modal = openModal({
    title: 'Importar de Hevy',
    subtitle: 'Sube el CSV exportado o conecta con la API',
    content: `
      <div class="segmented" data-hevy-tabs style="margin-bottom:14px">
        <button type="button" class="active" data-tab="csv">Archivo CSV</button>
        <button type="button" data-tab="api">API de Hevy</button>
      </div>

      <div data-panel="csv">
        <p class="text-muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">
          En Hevy: Ajustes → Exportar datos. Sube aquí el archivo <code>workouts.csv</code>.
        </p>
        <label class="btn btn-secondary btn-block" style="cursor:pointer">
          ${icon('layers', 16)} Elegir archivo CSV
          <input type="file" accept=".csv,text/csv" data-csv-file hidden>
        </label>
        <div class="text-muted" data-csv-name style="font-size:12.5px;margin-top:8px"></div>
      </div>

      <div data-panel="api" hidden>
        <p class="text-muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">
          Pega tu API key de Hevy (requiere Hevy Pro: Ajustes → API).
        </p>
        <input type="password" class="input" data-api-key placeholder="API key de Hevy" autocomplete="off" style="width:100%">
      </div>

      <div data-import-result style="margin-top:14px"></div>
    `,
    actions: [
      {
        label: 'Previsualizar',
        variant: 'btn-secondary',
        close: false,
        onClick: () => runHevy(false),
      },
      {
        label: 'Importar',
        variant: 'btn-primary',
        close: false,
        onClick: () => runHevy(true),
      },
    ],
  });

  const body = modal.body;
  let activeTab = 'csv';
  let csvText = '';

  const setTab = (tab) => {
    activeTab = tab;
    body
      .querySelectorAll('[data-tab]')
      .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    body.querySelector('[data-panel="csv"]').hidden = tab !== 'csv';
    body.querySelector('[data-panel="api"]').hidden = tab !== 'api';
  };

  body.querySelector('[data-hevy-tabs]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) setTab(button.dataset.tab);
  });

  const fileInput = body.querySelector('[data-csv-file]');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    csvText = await file.text();
    body.querySelector('[data-csv-name]').textContent =
      `${file.name} (${Math.round(file.size / 1024)} KB)`;
  });

  const result = body.querySelector('[data-import-result]');

  async function runHevy(write) {
    const buttons = modal.el.querySelectorAll('[data-action-index]');
    try {
      if (activeTab === 'csv' && !csvText) {
        toast('Elige primero el archivo CSV', 'error');
        return;
      }
      let apiKey = '';
      if (activeTab === 'api') {
        apiKey = body.querySelector('[data-api-key]').value.trim();
        if (!apiKey) {
          toast('Introduce tu API key', 'error');
          return;
        }
      }

      buttons.forEach((b) => {
        b.disabled = true;
      });
      result.innerHTML = `<div class="text-muted" style="font-size:13px">${write ? 'Importando…' : 'Analizando…'}</div>`;

      const response =
        activeTab === 'csv'
          ? await api.import.hevyCsv(csvText, write)
          : await api.import.hevyApi(apiKey, write);

      result.innerHTML = totalsSummary(response.totals, write);

      if (write) {
        toast(`Importados ${response.totals.imported} entrenos`, 'success');
        setTimeout(() => {
          modal.close();
          ctx.refresh();
        }, 1200);
      }
    } catch (error) {
      if (error.status === 401 && activeTab === 'csv') {
        modal.close();
        ctx.handleUnauthorized();
        return;
      }
      result.innerHTML = `<div class="import-error">${esc(errorMessage(error))}</div>`;
    } finally {
      buttons.forEach((b) => {
        b.disabled = false;
      });
    }
  }
}

export async function render(container, ctx) {
  let data;
  try {
    data = await api.stats.overview('6m');
  } catch (error) {
    if (error.status === 401) {
      ctx.handleUnauthorized();
      return;
    }
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${icon('info', 24)}</div>
        <h3>No se pudo cargar</h3>
        <p>${esc(errorMessage(error))}</p>
        <button type="button" class="btn btn-secondary btn-sm" data-retry>Reintentar</button>
      </div>`;
    container.querySelector('[data-retry]')?.addEventListener('click', () => ctx.refresh());
    return;
  }

  const user = ctx.user;
  const totals = data.totals || {};
  const weekly = data.weekly || [];
  const recent = data.recent || [];
  let metric = 'duration';

  const chartHtml = (key) => {
    const config = METRICS[key];
    return barChart({
      data: weekly,
      valueKey: config.valueKey,
      labelKey: 'weekStart',
      height: 170,
      formatValue: config.formatValue,
    });
  };

  container.innerHTML = `
    <div class="view stagger">
      <div class="topbar">
        <div class="topbar-title">${esc(user?.name || 'Perfil')}</div>
        <div class="topbar-side">
          <button type="button" class="icon-btn surface" data-theme-toggle aria-label="Cambiar tema">
            ${icon(currentTheme() === 'dark' ? 'sun' : 'moon', 18)}
          </button>
        </div>
      </div>

      <div class="profile-head">
        ${avatar(user, 'lg')}
        <div class="info">
          <div class="name">${esc(user?.name || 'Atleta')}</div>
          ${user?.email ? `<div class="email">${esc(user.email)}</div>` : ''}
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat accent">
          <span class="value">${esc(String(data.allTimeWorkouts || 0))}</span>
          <span class="label">Entrenos</span>
        </div>
        <div class="stat">
          <span class="value">${esc(formatVolume(totals.volume))}</span>
          <span class="label">Volumen (6m)</span>
        </div>
        <div class="stat">
          <span class="value">${esc(String(totals.sets || 0))}</span>
          <span class="label">Series (6m)</span>
        </div>
      </div>

      <section class="chart-card">
        <div class="chart-head">
          <div>
            <div class="t" data-chart-title>${METRICS[metric].label}</div>
            <div class="s">Últimos meses por semana</div>
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
        <div class="section-head"><h2>Información</h2></div>
        <div class="more-grid">
          <a class="quick-tile" href="#/workouts" data-link="/workouts">
            <span class="q-icon">${icon('chart', 18)}</span><span>Estadísticas</span>
          </a>
          <a class="quick-tile" href="#/exercises" data-link="/exercises">
            <span class="q-icon">${icon('dumbbell', 18)}</span><span>Ejercicios</span>
          </a>
          <a class="quick-tile" href="#/measurements" data-link="/measurements">
            <span class="q-icon">${icon('scale', 18)}</span><span>Medidas</span>
          </a>
          <a class="quick-tile" href="#/routines" data-link="/routines">
            <span class="q-icon">${icon('list', 18)}</span><span>Rutinas</span>
          </a>
          <button type="button" class="quick-tile" data-import-hevy>
            <span class="q-icon">${icon('layers', 18)}</span><span>Importar de Hevy</span>
          </button>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>Entrenamientos</h2>
          <a class="link-btn" href="#/workouts" data-link="/workouts">Ver todo</a>
        </div>
        <div class="stack-sm">
          ${
            recent.length
              ? recent
                  .map(
                    (workout) => `
                    <button type="button" class="workout-card" data-link="/workouts/${workout.id}">
                      <div class="workout-card-top">
                        <div class="grow" style="min-width:0">
                          <div class="name">${esc(workout.name)}</div>
                          <div class="date">${esc(formatDate(workout.startedAt))} · ${esc(formatDuration(workout.durationSeconds))}</div>
                        </div>
                        ${icon('chevronRight', 17)}
                      </div>
                      <div class="stats">
                        <span class="stat-mini">${icon('dumbbell', 13)} ${formatVolume(workout.summary?.volume)} kg</span>
                        <span class="stat-mini">${icon('check', 13)} ${workout.summary?.sets || 0} series</span>
                      </div>
                    </button>`
                  )
                  .join('')
              : `<div class="card"><div class="empty" style="padding:18px 8px">
                   <div class="empty-icon">${icon('history', 22)}</div>
                   <h3>Sin entrenamientos</h3>
                 </div></div>`
          }
        </div>
      </section>

      <button type="button" class="btn btn-danger btn-block" data-logout>
        ${icon('logout', 17)} Cerrar sesión
      </button>
    </div>
  `;

  const themeListener = () => {
    const button = container.querySelector('[data-theme-toggle]');
    if (button) button.innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon', 18);
    const chart = container.querySelector('[data-chart]');
    if (chart) chart.innerHTML = chartHtml(metric);
  };
  window.addEventListener('themechange', themeListener);

  container.querySelector('[data-theme-toggle]')?.addEventListener('click', () => toggleTheme());

  container.querySelector('[data-import-hevy]')?.addEventListener('click', () => {
    openHevyImport(ctx);
  });

  container.querySelector('[data-metrics]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-metric]');
    if (!button) return;
    metric = button.dataset.metric;
    container.querySelectorAll('[data-metric]').forEach((item) => {
      item.classList.toggle('active', item.dataset.metric === metric);
    });
    container.querySelector('[data-chart]').innerHTML = chartHtml(metric);
    container.querySelector('[data-chart-title]').textContent = METRICS[metric].label;
  });

  container.querySelector('[data-logout]')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Cerrar sesión',
      message: '¿Quieres salir de tu cuenta?',
      confirmLabel: 'Cerrar sesión',
      danger: true,
    });
    if (!confirmed) return;
    toast('Hasta pronto', 'success');
    ctx.logout();
  });

  return () => {
    window.removeEventListener('themechange', themeListener);
  };
}
