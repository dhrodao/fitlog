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
  interactive = false,
  tooltipRows,
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
              `<circle data-dot="${index}" cx="${xAt(index).toFixed(1)}" cy="${yAt(point.value).toFixed(1)}" r="2.6" fill="${color}" stroke="var(--surface)" stroke-width="1.5"><title>${esc(shortLabel(point.label, labelFn))}: ${esc(formatValue(point.value))}</title></circle>`
          )
          .join('')
      : '';

  const gradientId = `line-gradient-${++gradientCounter}`;

  // Interactive overlay: full-height hit area per point (Hevy-style tap/hover)
  // plus a movable marker, an active dot and a floating tooltip.
  const slot = points.length > 0 ? innerW / points.length : innerW;
  const hitAreas = interactive
    ? points
        .map((point, index) => {
          const cx = xAt(index);
          const defaultRows = [
            [shortLabel(point.label, labelFn), formatValue(point.value)],
          ];
          const rows =
            typeof tooltipRows === 'function' ? tooltipRows(point.raw) : defaultRows;
          const tipHtml = rows
            .map(
              ([label, value]) =>
                `<div class="ct-row"><span>${esc(String(label))}</span><strong>${esc(String(value))}</strong></div>`
            )
            .join('');
          const hx = Math.max(padLeft, cx - slot / 2);
          return `<rect class="chart-hit" data-hit="${index}" x="${hx.toFixed(1)}" y="${padTop.toFixed(1)}" width="${slot.toFixed(1)}" height="${innerH.toFixed(1)}" fill="transparent" data-cx="${cx.toFixed(1)}" data-cy="${yAt(point.value).toFixed(1)}" data-tip="${esc(tipHtml)}" />`;
        })
        .join('')
    : '';

  const svgBody = `
        ${gridLines.join('')}
        ${area && points.length > 1 ? `<path d="${areaPath}" fill="url(#${gradientId})" />` : ''}
        ${points.length > 1 ? `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />` : ''}
        ${dots}
        ${xLabels}`;

  if (!interactive) {
    return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de progreso">
        <defs>
          <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.32" />
            <stop offset="100%" stop-color="${color}" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${svgBody}
      </svg>
    </div>
  `;
  }

  return `
    <div class="chart-wrap chart-interactive" data-line-chart>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de progreso">
        <defs>
          <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.32" />
            <stop offset="100%" stop-color="${color}" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line class="chart-marker" data-marker x1="0" y1="${padTop.toFixed(1)}" x2="0" y2="${(padTop + innerH).toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 4" opacity="0" />
        ${svgBody}
        <circle class="chart-active-dot" data-active-dot cx="0" cy="0" r="4.2" fill="${color}" stroke="var(--surface)" stroke-width="2" opacity="0" />
        ${hitAreas}
      </svg>
      <div class="chart-tooltip" data-chart-tooltip hidden></div>
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
  interactive = false,
  tooltipRows,
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
      const idxAttr = interactive ? ` data-bar="${index}"` : '';
      return `<rect${idxAttr} x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(barHeight, value > 0 ? 2 : 0).toFixed(1)}" rx="${Math.min(5, barWidth / 2).toFixed(1)}" fill="${value > 0 ? color : 'var(--surface-3)'}"><title>${esc(shortLabel(item[labelKey], labelFn))}: ${esc(formatValue(value))}</title></rect>`;
    })
    .join('');

  // Full-slot transparent hit areas make the bars easy to tap, Hevy-style.
  const hitAreas = interactive
    ? data
        .map((item, index) => {
          const cx = padLeft + slot * index + slot / 2;
          const defaultRows = [[shortLabel(item[labelKey], labelFn), formatValue(Number(item[valueKey]) || 0)]];
          const rows = typeof tooltipRows === 'function' ? tooltipRows(item) : defaultRows;
          const tipHtml = rows
            .map(
              ([label, value]) =>
                `<div class="ct-row"><span>${esc(String(label))}</span><strong>${esc(String(value))}</strong></div>`
            )
            .join('');
          return `<rect class="chart-hit" data-hit="${index}" x="${(padLeft + slot * index).toFixed(1)}" y="${padTop.toFixed(1)}" width="${slot.toFixed(1)}" height="${innerH.toFixed(1)}" fill="transparent" data-cx="${cx.toFixed(1)}" data-tip="${esc(tipHtml)}" />`;
        })
        .join('')
    : '';

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

  if (!interactive) {
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

  return `
    <div class="chart-wrap chart-interactive" data-bar-chart>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de progreso">
        ${gridLines.join('')}
        <line class="chart-marker" data-marker x1="0" y1="${padTop.toFixed(1)}" x2="0" y2="${(padTop + innerH).toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 4" opacity="0" />
        ${bars}
        ${xLabels}
        ${hitAreas}
      </svg>
      <div class="chart-tooltip" data-chart-tooltip hidden></div>
    </div>
  `;
}

// Wires tap/hover interaction for an interactive barChart rendered inside
// `root`. Shows a tooltip with the bar's detail (Hevy-style) and highlights
// the selected column. Safe to call on containers without an interactive chart.
export function attachBarChart(root) {
  const wrap = root.querySelector('[data-bar-chart]');
  if (!wrap || wrap.dataset.wired === '1') return;
  wrap.dataset.wired = '1';
  const svg = wrap.querySelector('svg');
  const tooltip = wrap.querySelector('[data-chart-tooltip]');
  const marker = wrap.querySelector('[data-marker]');
  if (!svg || !tooltip) return;

  const clear = () => {
    tooltip.hidden = true;
    if (marker) marker.setAttribute('opacity', '0');
    wrap.querySelectorAll('.chart-hit.active').forEach((el) => el.classList.remove('active'));
    wrap.querySelectorAll('rect[data-bar].dim').forEach((el) => el.classList.remove('dim'));
  };

  const select = (hit) => {
    const index = hit.dataset.hit;
    const cx = Number(hit.dataset.cx);
    tooltip.innerHTML = hit.dataset.tip || '';
    tooltip.hidden = false;

    // Position the tooltip horizontally over the bar, clamped to the wrap.
    const rect = wrap.getBoundingClientRect();
    const ratio = cx / 340; // viewBox width used by barChart
    const px = ratio * rect.width;
    tooltip.style.left = `${px}px`;

    if (marker) {
      marker.setAttribute('x1', String(cx));
      marker.setAttribute('x2', String(cx));
      marker.setAttribute('opacity', '1');
    }
    wrap.querySelectorAll('.chart-hit.active').forEach((el) => el.classList.remove('active'));
    hit.classList.add('active');
    wrap.querySelectorAll('rect[data-bar]').forEach((el) => {
      el.classList.toggle('dim', el.dataset.bar !== index);
    });
  };

  svg.addEventListener('click', (event) => {
    const hit = event.target.closest('.chart-hit');
    if (!hit) {
      clear();
      return;
    }
    if (hit.classList.contains('active')) {
      clear();
    } else {
      select(hit);
    }
  });

  svg.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return; // touch uses tap/click
    const hit = event.target.closest('.chart-hit');
    if (hit) select(hit);
  });
  svg.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    clear();
  });
}

// Wires tap/hover interaction for an interactive lineChart rendered inside
// `root`. Mirrors attachBarChart: floating tooltip, vertical marker and an
// active dot that snaps to the selected point. Safe to call when no
// interactive line chart is present.
export function attachLineChart(root) {
  const wrap = root.querySelector('[data-line-chart]');
  if (!wrap || wrap.dataset.wired === '1') return;
  wrap.dataset.wired = '1';
  const svg = wrap.querySelector('svg');
  const tooltip = wrap.querySelector('[data-chart-tooltip]');
  const marker = wrap.querySelector('[data-marker]');
  const activeDot = wrap.querySelector('[data-active-dot]');
  if (!svg || !tooltip) return;

  const clear = () => {
    tooltip.hidden = true;
    if (marker) marker.setAttribute('opacity', '0');
    if (activeDot) activeDot.setAttribute('opacity', '0');
    wrap.querySelectorAll('.chart-hit.active').forEach((el) => el.classList.remove('active'));
  };

  const select = (hit) => {
    const cx = Number(hit.dataset.cx);
    const cy = Number(hit.dataset.cy);
    tooltip.innerHTML = hit.dataset.tip || '';
    tooltip.hidden = false;

    const rect = wrap.getBoundingClientRect();
    const ratio = cx / 340; // viewBox width used by lineChart
    tooltip.style.left = `${ratio * rect.width}px`;

    if (marker) {
      marker.setAttribute('x1', String(cx));
      marker.setAttribute('x2', String(cx));
      marker.setAttribute('opacity', '1');
    }
    if (activeDot) {
      activeDot.setAttribute('cx', String(cx));
      activeDot.setAttribute('cy', String(cy));
      activeDot.setAttribute('opacity', '1');
    }
    wrap.querySelectorAll('.chart-hit.active').forEach((el) => el.classList.remove('active'));
    hit.classList.add('active');
  };

  svg.addEventListener('click', (event) => {
    const hit = event.target.closest('.chart-hit');
    if (!hit) {
      clear();
      return;
    }
    if (hit.classList.contains('active')) clear();
    else select(hit);
  });

  svg.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const hit = event.target.closest('.chart-hit');
    if (hit) select(hit);
  });
  svg.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    clear();
  });
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
