import { api, errorMessage } from '../api.js';
import { lineChart } from '../charts.js';
import {
  confirmDialog,
  esc,
  formatDate,
  formatDateInput,
  formatNumber,
  formatWeight,
  icon,
  setLoading,
  toast,
} from '../ui.js';

function measurementRow(measurement) {
  const parts = [];
  if (measurement.weightKg != null) parts.push(`<span><b>${formatNumber(measurement.weightKg, 1)}</b> kg</span>`);
  if (measurement.bodyFat != null) parts.push(`<span><b>${formatNumber(measurement.bodyFat, 1)}</b> % grasa</span>`);
  if (measurement.waistCm != null) parts.push(`<span><b>${formatNumber(measurement.waistCm, 1)}</b> cm cintura</span>`);
  return `
    <div class="measurement-row" data-id="${measurement.id}">
      <div class="date">${esc(formatDate(measurement.date, { withYear: true }))}</div>
      <div class="vals">${parts.join('') || '<span class="text-muted">Sin datos</span>'}</div>
      <button type="button" class="icon-btn danger btn-sm" data-remove="${measurement.id}" aria-label="Eliminar medida">
        ${icon('trash', 16)}
      </button>
    </div>
  `;
}

export async function render(container, ctx) {
  let measurements = [];
  try {
    const response = await api.measurements.list();
    measurements = response.measurements || [];
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

  const chartHtml = () => {
    const withWeight = measurements.filter((m) => m.weightKg != null);
    if (withWeight.length < 2) {
      return '<div class="chart-empty">Registra al menos dos pesos para ver tu progreso</div>';
    }
    return lineChart({
      data: withWeight,
      valueKey: 'weightKg',
      labelKey: 'date',
      height: 170,
      formatValue: (value) => formatWeight(value),
    });
  };

  const latest = measurements.length ? measurements[measurements.length - 1] : null;

  container.innerHTML = `
    <div class="view stagger">
      <div class="topbar">
        <button type="button" class="icon-btn surface" data-link="/profile" aria-label="Volver">
          ${icon('arrowLeft', 19)}
        </button>
        <div class="topbar-title">Medidas</div>
        <span style="width:40px"></span>
      </div>

      <section class="chart-card">
        <div class="chart-head">
          <div>
            <div class="t">${latest?.weightKg != null ? esc(formatWeight(latest.weightKg)) : 'Peso corporal'}</div>
            <div class="s">${latest ? esc(formatDate(latest.date, { withYear: true })) : 'Aún sin registros'}</div>
          </div>
          ${icon('scale', 20)}
        </div>
        <div data-chart>${chartHtml()}</div>
      </section>

      <section class="card">
        <div class="section-head"><h2>Nuevo registro</h2></div>
        <div class="measurement-form">
          <div class="field">
            <label>Fecha</label>
            <input class="input" type="date" data-field="date" value="${esc(formatDateInput(new Date()))}" />
          </div>
          <div class="form-grid">
            <div class="field">
              <label>Peso (kg)</label>
              <input class="input" type="number" inputmode="decimal" step="0.1" data-field="weightKg" placeholder="0.0" />
            </div>
            <div class="field">
              <label>Grasa (%)</label>
              <input class="input" type="number" inputmode="decimal" step="0.1" data-field="bodyFat" placeholder="0.0" />
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label>Cintura (cm)</label>
              <input class="input" type="number" inputmode="decimal" step="0.1" data-field="waistCm" placeholder="0.0" />
            </div>
            <div class="field">
              <label>Nota</label>
              <input class="input" type="text" data-field="notes" placeholder="Opcional" maxlength="200" />
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-block" data-save>${icon('plus', 16)} Guardar medida</button>
        </div>
      </section>

      <section>
        <div class="section-head"><h2>Historial</h2><span class="hint">${measurements.length}</span></div>
        <div class="stack-sm" data-list>
          ${
            measurements.length
              ? [...measurements].reverse().map(measurementRow).join('')
              : `<div class="card"><div class="empty" style="padding:18px 8px">
                   <div class="empty-icon">${icon('scale', 22)}</div>
                   <h3>Sin medidas aún</h3>
                   <p>Registra tu peso para empezar a seguir tu progreso.</p>
                 </div></div>`
          }
        </div>
      </section>
    </div>
  `;

  const field = (name) => container.querySelector(`[data-field="${name}"]`);

  const refreshViews = () => {
    container.querySelector('[data-chart]').innerHTML = chartHtml();
    const list = container.querySelector('[data-list]');
    list.innerHTML = measurements.length
      ? [...measurements].reverse().map(measurementRow).join('')
      : `<div class="card"><div class="empty" style="padding:18px 8px">
           <div class="empty-icon">${icon('scale', 22)}</div>
           <h3>Sin medidas aún</h3>
         </div></div>`;
  };

  container.querySelector('[data-save]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const num = (name) => {
      const value = field(name).value.trim();
      return value === '' ? null : Number(value);
    };

    const payload = {
      date: field('date').value || formatDateInput(new Date()),
      weightKg: num('weightKg'),
      bodyFat: num('bodyFat'),
      waistCm: num('waistCm'),
      notes: field('notes').value.trim() || null,
    };

    if (payload.weightKg == null && payload.bodyFat == null && payload.waistCm == null) {
      toast('Añade al menos una medida', 'error');
      return;
    }

    setLoading(button, true, 'Guardando...');
    try {
      const { measurement } = await api.measurements.save(payload);
      // upsert by date (server replaces same-date record)
      const index = measurements.findIndex((m) => m.date === measurement.date);
      if (index >= 0) measurements[index] = measurement;
      else measurements.push(measurement);
      measurements.sort((a, b) => a.date.localeCompare(b.date));
      setLoading(button, false);
      ['weightKg', 'bodyFat', 'waistCm', 'notes'].forEach((name) => {
        field(name).value = '';
      });
      refreshViews();
      toast('Medida guardada', 'success');
    } catch (error) {
      setLoading(button, false);
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  });

  container.querySelector('[data-list]')?.addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove]');
    if (!remove) return;
    const id = Number(remove.dataset.remove);
    const confirmed = await confirmDialog({
      title: 'Eliminar medida',
      message: 'Esta medida se eliminará permanentemente.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.measurements.remove(id);
      measurements = measurements.filter((m) => m.id !== id);
      refreshViews();
      toast('Medida eliminada', 'success');
    } catch (error) {
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  });
}
