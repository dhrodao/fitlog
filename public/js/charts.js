import { esc, formatNumber, formatVolume } from './ui.js';

let gradientCounter = 0;

function niceBounds(values, { fromZero = false } = {}) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return { min: 0, max: 1 };
  let min = fromZero ? 0 : Math.min(...clean);
  let max = Math.max(...clean);
  if (min === max) {
    max = min + (min === 0 ? 1 : Math.abs(min) * 0.2);
  }
  if (!fromZero) {
    const pad = (max - min) * 0.16;
    min = Math.max(0, min - pad);
    max += pad;
  } else {
    max *= 1.1;
  }
  return { min, max: max || 1 };
}

function shortLabel(value, labelFn) {
  if (labelFn) return labelFn(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// Selects which x-axis tick indexes to render. Always includes the first and
// last points, plus evenly-spaced ticks. Drops any intermediate tick that would
// sit too close to the final one so the labels never overlap.
function pickLabelIndexes(count, step) {
  if (count <= 0) return new Set();
  if (count === 1) return new Set([0]);

  const last = count - 1;
  const selected = new Set([0]);
  for (let index = step; index < last; index += step) {
    selected.add(index);
  }
  // Drop any intermediate tick too close to the last one to avoid overlap.
  for (const index of Array.from(selected)) {
    if (index !== 0 && last - index < step) selected.delete(index);
  }
  selected.add(last);
  return selected;
}

export function lineChart({
  data = [],
  valueKey = 'value',
  labelKey = 'date',
  height = 160,
  color = '#0a84ff',
  labelFn,
  formatValue = formatVolume,
  area = true,
}) {
  const points = data.map((item) => ({
    raw: item,
    value: Number(item[valueKey]) || 0,
    label: item[labelKey],
  }));

  if (points.length === 0) {
    return '<div class="chart-empty">Aún no hay datos para mostrar</div>';
  }

  const width = 340;
  const padLeft = 36;
  const padRight = 8;
  const padTop = 14;
  const padBottom = 24;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const { min, max } = niceBounds(points.map((point) => point.value));
  const range = max - min || 1;

  const xAt = (index) =>
    points.length === 1
      ? padLeft + innerW / 2
      : padLeft + (index / (points.length - 1)) * innerW;
  const yAt = (value) => padTop + innerH - ((value - min) / range) * innerH;

  const linePoints = points.map((point, index) => [xAt(index), yAt(point.value)]);
  const linePath = linePoints
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${xAt(points.length - 1).toFixed(1)} ${(padTop + innerH).toFixed(1)} L${xAt(0).toFixed(1)} ${(padTop + innerH).toFixed(1)} Z`;

  const gridLines = [0, 0.5, 1].map((ratio) => {
    const value = min + range * ratio;
    const y = yAt(value);
    return `
      <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 5" />
      <text x="${padLeft - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="chart-label">${esc(formatValue(value))}</text>
    `;
  });

  const step = Math.max(1, Math.ceil(points.length / 4));
  const labelIndexes = pickLabelIndexes(points.length, step);
  const xLabels = points
    .map((point, index) => ({ point, index }))
    .filter(({ index }) => labelIndexes.has(index))
    .map(({ point, index }) => {
      const anchor =
        index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
      return `<text x="${xAt(index).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}" class="chart-label">${esc(shortLabel(point.label, labelFn))}</text>`;
    })
    .join('');

  const dots =
    points.length <= 24
      ? points
          .map(
            (point, index) =>
              `<circle cx="${xAt(index).toFixed(1)}" cy="${yAt(point.value).toFixed(1)}" r="2.6" fill="${color}" stroke="var(--surface)" stroke-width="1.5"><title>${esc(shortLabel(point.label, labelFn))}: ${esc(formatValue(point.value))}</title></circle>`
          )
          .join('')
      : '';

  const gradientId = `line-gradient-${++gradientCounter}`;

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de progreso">
        <defs>
          <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.32" />
            <stop offset="100%" stop-color="${color}" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${gridLines.join('')}
        ${area && points.length > 1 ? `<path d="${areaPath}" fill="url(#${gradientId})" />` : ''}
        ${points.length > 1 ? `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />` : ''}
        ${dots}
        ${xLabels}
      </svg>
    </div>
  `;
}

export function barChart({
  data = [],
  valueKey = 'value',
  labelKey = 'date',
  height = 160,
  color = '#0a84ff',
  labelFn,
  formatValue = formatVolume,
}) {
  if (!data.length) {
    return '<div class="chart-empty">Aún no hay datos para mostrar</div>';
  }

  const width = 340;
  const padLeft = 36;
  const padRight = 8;
  const padTop = 14;
  const padBottom = 24;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const values = data.map((item) => Number(item[valueKey]) || 0);
  const { min, max } = niceBounds(values, { fromZero: true });
  const range = max - min || 1;
  const slot = innerW / data.length;
  const barWidth = Math.max(4, Math.min(24, slot * 0.58));

  const gridLines = [0, 0.5, 1].map((ratio) => {
    const value = min + range * ratio;
    const y = padTop + innerH - (ratio * innerH);
    return `
      <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 5" />
      <text x="${padLeft - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="chart-label">${esc(formatValue(value))}</text>
    `;
  });

  const bars = data
    .map((item, index) => {
      const value = Number(item[valueKey]) || 0;
      const barHeight = ((value - min) / range) * innerH;
      const x = padLeft + slot * index + (slot - barWidth) / 2;
      const y = padTop + innerH - Math.max(barHeight, value > 0 ? 2 : 0);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(barHeight, value > 0 ? 2 : 0).toFixed(1)}" rx="${Math.min(5, barWidth / 2).toFixed(1)}" fill="${value > 0 ? color : 'var(--surface-3)'}"><title>${esc(shortLabel(item[labelKey], labelFn))}: ${esc(formatValue(value))}</title></rect>`;
    })
    .join('');

  const step = Math.max(1, Math.ceil(data.length / 5));
  const labelIndexes = pickLabelIndexes(data.length, step);
  const xLabels = data
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => labelIndexes.has(index))
    .map(({ item, index }) => {
      const anchor =
        index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle';
      return `<text x="${(padLeft + slot * index + slot / 2).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}" class="chart-label">${esc(shortLabel(item[labelKey], labelFn))}</text>`;
    })
    .join('');

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de progreso">
        ${gridLines.join('')}
        ${bars}
        ${xLabels}
      </svg>
    </div>
  `;
}

export function sparkline(values, { width = 64, height = 24, color = '#0a84ff' } = {}) {
  const clean = values.map((value) => Number(value) || 0);
  if (clean.length < 2) return '';
  const { min, max } = niceBounds(clean);
  const range = max - min || 1;
  const path = clean
    .map((value, index) => {
      const x = (index / (clean.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" /></svg>`;
}

export function formatCompact(value) {
  return formatNumber(value, 0);
}
