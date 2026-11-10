// Subtle haptic feedback for key actions. No-ops where the Vibration API is
// unavailable (iOS Safari, desktop) or when the user prefers reduced motion.
// `pattern` is an ms duration or an array accepted by navigator.vibrate.
const reducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function haptic(pattern = 10) {
  if (reducedMotion) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore: haptics are best-effort */
  }
}

const paths = {
  home: '<path d="m3 10.2 9-7.2 9 7.2V20a1 1 0 0 1-1 1h-4.8v-6.5H8.8V21H4a1 1 0 0 1-1-1Z"/>',
  dumbbell:
    '<path d="M6.8 6.5v11M17.2 6.5v11M3.2 9.2v5.6M20.8 9.2v5.6M6.8 12h10.4"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.4c.8-3.4 3.7-5.4 7.2-5.4s6.4 2 7.2 5.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2"/>',
  folder: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z"/>',
  folderPlus:
    '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z"/><path d="M12 11v5M9.5 13.5h5"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  backspace:
    '<path d="M9.5 5H19a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9.5L3.5 12Z"/><path d="m12.5 9.5 5 5M17.5 9.5l-5 5"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
  trash:
    '<path d="M4 7h16M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7M10 11v5M14 11v5"/>',
  pencil:
    '<path d="M4 20h4.3L20 8.3a2.1 2.1 0 0 0-3-3L5.3 17Z"/><path d="m14.5 6.8 2.7 2.7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trophy:
    '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 5H4.5v1.5A3.5 3.5 0 0 0 8 10M16 5h3.5v1.5A3.5 3.5 0 0 1 16 10M12 13v4M8.5 21h7M9.5 21v-3.5h5V21"/>',
  flame:
    '<path d="M12 3s1.2 2.4.4 4.4C11.5 9.6 9.5 10 9.5 12c0-1-.8-2-.8-2S7 12 7 14.2A5 5 0 0 0 12 19a5 5 0 0 0 5-5c0-4-3-6.5-5-11Z"/>',
  scale:
    '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.5a4 4 0 0 1 6 0M12 8v3.5"/>',
  chart: '<path d="M4 19.5V5M4 19.5h16"/><path d="m7.5 14 3-3.5 3 2 4-5.5"/>',
  play: '<path d="M8 5.5v13l11-6.5Z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 4v4.5H8"/><path d="M12 8v4.2l3 1.8"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  logout: '<path d="M9 4H5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5 20h4M16 8l4 4-4 4M20 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2 1.5M9 2.5h6M12 2.5V6"/>',
  repeat: '<path d="M17 3.5 20 7l-3 3.5M20 7H7.5A3.5 3.5 0 0 0 4 10.5V12M7 20.5 4 17l3-3.5M4 17h12.5A3.5 3.5 0 0 0 20 13.5V12"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.4"/>',
  sparkles:
    '<path d="M12 3.5 13.7 8l4.5 1.7-4.5 1.7L12 16l-1.7-4.6L5.8 9.7 10.3 8Z"/><path d="M18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4ZM20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6Z"/>',
  drag: '<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  sort: '<path d="M8 5v14M4.5 15.5 8 19l3.5-3.5M16 19V5M12.5 8.5 16 5l3.5 3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.7-4.2a1.5 1.5 0 0 1 2 0L20 20"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-13.7-5.3L4 8M4 4v4h4M4 13a8 8 0 0 0 13.7 5.3L20 16M20 20v-4h-4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5ZM3.5 12 12 17l8.5-5M3.5 16 12 21l8.5-5"/>',
  activity: '<path d="M3 12h4l2.5-7 4.5 14 2.5-7H21"/>',
  filter: '<path d="M4 5h16l-6.2 7.2V19l-3.6 2v-8.8Z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-3.2 3.9M6.4 6.4C3.9 8.2 2.5 12 2.5 12S6 18 12 18c1.2 0 2.3-.2 3.3-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  google: '<path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" fill="#4285F4" stroke="none"/><path d="M12 22c2.7 0 5-.9 6.6-2.5l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" fill="#34A853" stroke="none"/><path d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9Z" fill="#FBBC05" stroke="none"/><path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9Z" fill="#EA4335" stroke="none"/>',
};

export function icon(name, size = 20, strokeWidth = 1.9) {
  const body = paths[name] || paths.info;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const escapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => escapeMap[char]);
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function avatar(user, size = '') {
  const klass = ['avatar', size].filter(Boolean).join(' ');
  if (user?.picture) {
    return `<span class="${klass}"><img src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer" /></span>`;
  }
  return `<span class="${klass}">${esc(initials(user?.name))}</span>`;
}

export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatDuration(totalSeconds, { short = false } = {}) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (seconds < 60) return short ? `${seconds}s` : `${seconds} seg`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes} min`;
}

export function formatNumber(value, digits = 0) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(num);
}

export function formatVolume(value) {
  const num = Number(value) || 0;
  if (num >= 1000000) return `${formatNumber(num / 1000000, 1)}M`;
  if (num >= 10000) return `${formatNumber(num / 1000, 1)}k`;
  return formatNumber(num);
}

export function formatWeight(value) {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${formatNumber(num, num % 1 === 0 ? 0 : 1)} kg`;
}

export function formatDate(value, { withYear = false } = {}) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const today = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);

  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff > 1 && diff < 7) {
    return date.toLocaleDateString('es-ES', { weekday: 'long' });
  }

  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    ...(withYear || !sameYear ? { year: 'numeric' } : {}),
  });
}

export function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMonth(value) {
  return new Date(value).toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
  });
}

export function weekdayShort(value) {
  return new Date(value)
    .toLocaleDateString('es-ES', { weekday: 'short' })
    .replace('.', '')
    .slice(0, 2);
}

export function formatDateInput(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function debounce(fn, wait = 300) {
  let timer = null;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  }
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function setLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span><span>${esc(label || 'Guardando...')}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.original) {
      button.innerHTML = button.dataset.original;
      delete button.dataset.original;
    }
  }
}

let toastStack = null;

// Icon per toast type. A new type (and its CSS class) only needs an entry here;
// anything not listed falls back to the default icon.
const TOAST_ICONS = {
  success: 'check',
  error: 'info',
  // Personal-record celebration: trophy, styled gold like the record chip.
  record: 'trophy',
};
const DEFAULT_TOAST_ICON = 'sparkles';

export function toast(message, type = 'default') {
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.className = 'toast-stack';
    document.body.append(toastStack);
  }

  const node = document.createElement('div');
  node.className = `toast ${type}`;
  const iconName = TOAST_ICONS[type] ?? DEFAULT_TOAST_ICON;
  node.innerHTML = `${icon(iconName, 16)}<span>${esc(message)}</span>`;
  toastStack.append(node);

  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }, 2600);
}

function createDialogRoot(className) {
  const dialog = document.createElement('dialog');
  dialog.className = className;
  document.getElementById('overlays').append(dialog);

  const close = () => {
    if (!dialog.open) return;
    dialog.close();
    setTimeout(() => dialog.remove(), 240);
  };

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  return { dialog, close };
}

export function openModal({
  title,
  subtitle = '',
  content = '',
  actions = [],
  sheet = false,
  className = '',
  onClose,
}) {
  const { dialog, close } = createDialogRoot(sheet ? 'sheet' : 'modal');

  const buttons = actions
    .map(
      (action, index) =>
        `<button type="button" class="btn ${action.variant || 'btn-secondary'}" data-action-index="${index}">${esc(action.label)}</button>`
    )
    .join('');

  dialog.innerHTML = `
    <div class="modal-panel ${className}">
      ${sheet ? '<div class="sheet-handle"></div>' : ''}
      <div class="modal-head">
        <div>
          <h3>${esc(title)}</h3>
          ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button>
      </div>
      <div class="modal-body">${content}</div>
      ${buttons ? `<div class="modal-actions${actions.length > 2 ? ' stacked' : ''}">${buttons}</div>` : ''}
    </div>
  `;

  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.querySelectorAll('[data-action-index]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = actions[Number(button.dataset.actionIndex)];
      if (!action) return;
      if (action.close === false) {
        await action.onClick?.(close);
        return;
      }
      close();
      action.onClick?.();
    });
  });

  dialog.addEventListener('close', () => onClose?.());
  dialog.showModal();

  return {
    el: dialog,
    body: dialog.querySelector('.modal-body'),
    close,
  };
}

export function openActionSheet(title, items) {
  const content = `<div class="menu-list">${items
    .map(
      (item, index) => `
      <button type="button" class="action-sheet-item ${item.danger ? 'danger' : ''}" data-sheet-index="${index}">
        <span class="menu-icon">${icon(item.icon || 'chevronRight', 18)}</span>
        <span class="grow">${esc(item.label)}${item.sub ? `<span class="menu-sub">${esc(item.sub)}</span>` : ''}</span>
      </button>`
    )
    .join('')}</div>`;

  const modal = openModal({ title, content, sheet: true });
  modal.body.querySelectorAll('[data-sheet-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = items[Number(button.dataset.sheetIndex)];
      modal.close();
      setTimeout(() => item.onClick?.(), 60);
    });
  });
  return modal;
}

export function confirmDialog({
  title = '¿Seguro?',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const modal = openModal({
      title,
      content: `<p class="text-muted" style="font-size:13.5px;line-height:1.5">${esc(message)}</p>`,
      actions: [
        { label: cancelLabel, variant: 'btn-secondary', onClick: () => settle(false) },
        {
          label: confirmLabel,
          variant: danger ? 'btn-danger' : 'btn-primary',
          onClick: () => {
            if (danger) haptic(18);
            settle(true);
          },
        },
      ],
      onClose: () => settle(false),
    });

    modal.el.querySelectorAll('[data-action-index]').forEach((button) => {
      button.addEventListener('click', () => {
        setTimeout(() => settle(false), 0);
      }, { capture: true });
    });
  });
}

export function emptyState({ iconName = 'sparkles', title, text = '', action = '' }) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon(iconName, 24)}</div>
      <h3>${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${action}
    </div>
  `;
}

export function loaderScreen(label = 'Cargando...') {
  return `<div class="loader-screen"><div class="spinner lg"></div><span>${esc(label)}</span></div>`;
}

export function errorScreen(message, retryAttr = '') {
  return `
    <div class="empty">
      <div class="empty-icon">${icon('info', 24)}</div>
      <h3>No se pudo cargar</h3>
      <p>${esc(message)}</p>
      <button type="button" class="btn btn-secondary btn-sm" ${retryAttr}>Reintentar</button>
    </div>
  `;
}

// Shown when the server is unreachable (offline) rather than when the session
// is genuinely invalid. The installed shell loads from cache, so we land here
// instead of bouncing the user to the login screen as if they were logged out.
export function offlineScreen(retryAttr = '') {
  return `
    <div class="empty">
      <div class="empty-icon">${icon('refresh', 24)}</div>
      <h3>Sin conexión</h3>
      <p>No hay conexión con el servidor. Tus datos aparecerán en cuanto
      vuelvas a estar en línea.</p>
      <button type="button" class="btn btn-secondary btn-sm" ${retryAttr}>Reintentar</button>
    </div>
  `;
}

export function monthKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** True when an API error means "the request never reached the server". */
export function isOffline(error) {
  return error?.status === 0;
}

// Inline "needs connection" block, meant to sit INSIDE a view's structure (not
// as a full-screen error): the view still renders its header/layout, and only
// the data region shows this. Keeps a retry button.
export function connectionNeeded(
  text = 'Esta sección necesita conexión. Vuelve a intentarlo cuando estés en línea.',
  retryAttr = ''
) {
  return `
    <div class="card"><div class="empty" style="padding:22px 8px">
      <div class="empty-icon">${icon('refresh', 22)}</div>
      <h3>Sin conexión</h3>
      <p>${esc(text)}</p>
      <button type="button" class="btn btn-secondary btn-sm" ${retryAttr}>Reintentar</button>
    </div></div>
  `;
}
