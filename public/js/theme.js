const STORAGE_KEY = 'fit-theme';

export function getTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  localStorage.setItem(STORAGE_KEY, value);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', value === 'light' ? '#f4f6f9' : '#07080a');
  window.dispatchEvent(new CustomEvent('themechange', { detail: value }));
  return value;
}

export function initTheme() {
  return applyTheme(getTheme());
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  return applyTheme(next);
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
