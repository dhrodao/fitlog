import { api, errorMessage } from '../api.js';
import { lineChart } from '../charts.js';
import { loadView } from '../view-helpers.js';
import {
  confirmDialog,
  connectionNeeded,
  esc,
  formatDate,
  formatDateInput,
  formatNumber,
  formatWeight,
  icon,
  setLoading,
  toast,
} from '../ui.js';
import { parseDecimalInput, INVALID } from '../format.js';

function measurementRow(measurement) {
  const parts = [];
  if (measurement.weightKg != null) parts.push(`<span><b>${formatNumber(measurement.weightKg, 1)}</b> kg</span>`);
  if (measurement.bodyFat != null) parts.push(`<span><b>${formatNumber(measurement.bodyFat, 1)}</b> % grasa</span>`);
  if (measurement.waistCm != null) parts.push(`<span><b>${formatNumber(measurement.waistCm, 1)}</b> cm cintura</span>`);
  return `
    <div class="measurement-row" data-id="${measurement.id}">
      <button type="button" class="measurement-edit" data-edit="${esc(measurement.date)}" aria-label="Editar medida">
        <div class="date">${esc(formatDate(measurement.date, { withYear: true }))}</div>
        <div class="vals">${parts.join('') || '<span class="text-muted">Sin datos</span>'}</div>
      </button>
      <button type="button" class="icon-btn danger btn-sm" data-remove="${measurement.id}" aria-label="Eliminar medida">
        ${icon('trash', 16)}
      </button>
    </div>
  `;
}

export async function render(container, ctx) {
  let measurements = [];
  let offline = false;
  const result = await loadView(container, ctx, () => api.measurements.list());
  if (!result.ok) return;
  if (result.offline) {
    // Offline: keep the header and the add-measurement form, but show a
    // "needs connection" block where the chart/history (server data) would go.
    offline = true;
  } else {
    measurements = result.data.measurements || [];
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

      ${offline ? connectionNeeded('Tu progreso de peso aparecerá cuando vuelvas a estar en línea.', 'data-retry') : `
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
      `}

      <section class="card">
        <div class="section-head">
          <h2 data-form-title>Nuevo registro</h2>
          <button type="button" class="btn btn-ghost btn-sm" data-cancel-edit hidden>Cancelar</button>
        </div>
        <div class="measurement-form">
          <div class="field">
            <label>Fecha</label>
            <input class="input" type="date" data-field="date" value="${esc(formatDateInput(new Date()))}" />
          </div>
          <div class="form-grid">
            <div class="field">
              <label>Peso (kg)</label>
              <input class="input" type="text" inputmode="decimal" data-field="weightKg" placeholder="0.0" />
            </div>
            <div class="field">
              <label>Grasa (%)</label>
              <input class="input" type="text" inputmode="decimal" data-field="bodyFat" placeholder="0.0" />
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label>Cintura (cm)</label>
              <input class="input" type="text" inputmode="decimal" data-field="waistCm" placeholder="0.0" />
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
        <div class="section-head"><h2>Historial</h2><span class="hint">${offline ? '' : measurements.length}</span></div>
        ${offline ? connectionNeeded('Tu histórico de medidas aparecerá cuando vuelvas a estar en línea.', 'data-retry') : `
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
        `}
      </section>
    </div>
  `;

  const field = (name) => container.querySelector(`[data-field="${name}"]`);

  // Offline: the chart and history (server data) are replaced by the inline
  // block. The add form is still shown but saving needs the server, so it will
  // surface a toast on failure. Wire only the retry button and the save button
  // (whose own catch handles the offline error) and skip the list/chart logic.
  if (offline) {
    container.querySelector('[data-retry]')?.addEventListener('click', () => ctx.refresh());
    container.querySelector('[data-save]')?.addEventListener('click', () => {
      toast('Necesitas conexión para guardar una medida', 'error');
    });
    return;
  }

  // Edit state: null = creating a new record (empty numeric fields are omitted
  // from the payload, so they never clear other fields). A date = editing an
  // existing record (empty fields are sent as explicit null to clear them).
  let editingDate = null;

  const formTitle = container.querySelector('[data-form-title]');
  const cancelEditBtn = container.querySelector('[data-cancel-edit]');
  const saveBtn = container.querySelector('[data-save]');

  const resetForm = () => {
    editingDate = null;
    field('date').value = formatDateInput(new Date());
    ['weightKg', 'bodyFat', 'waistCm', 'notes'].forEach((name) => {
      field(name).value = '';
    });
    formTitle.textContent = 'Nuevo registro';
    cancelEditBtn.hidden = true;
    saveBtn.innerHTML = `${icon('plus', 16)} Guardar medida`;
  };

  const startEdit = (date) => {
    const record = measurements.find((m) => m.date === date);
    if (!record) return;
    editingDate = date;
    field('date').value = record.date;
    field('weightKg').value = record.weightKg != null ? record.weightKg : '';
    field('bodyFat').value = record.bodyFat != null ? record.bodyFat : '';
    field('waistCm').value = record.waistCm != null ? record.waistCm : '';
    field('notes').value = record.notes || '';
    formTitle.textContent = 'Editar registro';
    cancelEditBtn.hidden = false;
    saveBtn.innerHTML = `${icon('plus', 16)} Guardar cambios`;
    container.querySelector('.measurement-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

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

  cancelEditBtn?.addEventListener('click', () => resetForm());

  saveBtn?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const editing = editingDate !== null;

    // When creating, an empty field is omitted so it never clears a stored
    // value. When editing, an empty field is sent as explicit null to clear it.
    const payload = {
      date: field('date').value || formatDateInput(new Date()),
    };
    let invalidField = false;
    const applyNumeric = (name) => {
      const el = field(name);
      const raw = el.value.trim();
      el.classList.remove('input-error');
      if (raw === '') {
        if (editing) payload[name] = null;
        return;
      }
      const parsed = parseDecimalInput(raw);
      if (parsed === INVALID || parsed === null || parsed < 0) {
        el.classList.add('input-error');
        invalidField = true;
        return;
      }
      payload[name] = parsed;
    };
    ['weightKg', 'bodyFat', 'waistCm'].forEach(applyNumeric);

    if (invalidField) {
      toast('Revisa los valores numéricos (usa coma o punto)', 'error');
      return;
    }

    const noteRaw = field('notes').value.trim();
    if (noteRaw !== '') payload.notes = noteRaw;
    else if (editing) payload.notes = null;

    // Client-side guard mirrors the server: the merged record must keep at
    // least one measure. On a new date there is nothing stored to preserve.
    const existing = measurements.find((m) => m.date === payload.date) || null;
    const resolved = (name, column) => {
      if (Object.hasOwn(payload, name)) return payload[name];
      return existing ? existing[name] : null;
    };
    if (
      resolved('weightKg') == null &&
      resolved('bodyFat') == null &&
      resolved('waistCm') == null
    ) {
      toast('Añade al menos una medida', 'error');
      return;
    }

    setLoading(button, true, 'Guardando...');
    try {
      const { measurement } = await api.measurements.save(payload);
      const index = measurements.findIndex((m) => m.date === measurement.date);
      if (index >= 0) measurements[index] = measurement;
      else measurements.push(measurement);
      measurements.sort((a, b) => a.date.localeCompare(b.date));
      setLoading(button, false);
      resetForm();
      refreshViews();
      toast('Medida guardada', 'success');
    } catch (error) {
      setLoading(button, false);
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  });

  container.querySelector('[data-list]')?.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) {
      startEdit(edit.dataset.edit);
      return;
    }
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
      if (editingDate && !measurements.some((m) => m.date === editingDate)) {
        resetForm();
      }
      refreshViews();
      toast('Medida eliminada', 'success');
    } catch (error) {
      if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  });
}
