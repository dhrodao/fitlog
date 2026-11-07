import { api, errorMessage } from './api.js';
import { initTheme } from './theme.js';
import { esc, errorScreen, icon, loaderScreen, offlineScreen } from './ui.js';
import { clearAll as clearOfflineData, loadActiveWorkout } from './offline/active-store.js';
import { syncFinishedOffline } from './offline/sync.js';
import * as LoginView from './views/login.js';
import * as HomeView from './views/home.js';
import * as TrainingView from './views/training.js';
import * as RoutineView from './views/routine.js';
import * as RoutineEditorView from './views/routine-editor.js';
import * as ActiveView from './views/active.js';
import * as HistoryView from './views/history.js';
import * as WorkoutView from './views/workout.js';
import * as ExercisesView from './views/exercises.js';
import * as MeasurementsView from './views/measurements.js';
import * as ProfileView from './views/profile.js';

initTheme();

const shell = document.getElementById('app');
const viewRoot = document.createElement('main');
viewRoot.id = 'view-root';
const nav = document.createElement('nav');
nav.className = 'bottom-nav';
nav.setAttribute('aria-label', 'Navegación principal');
shell.append(viewRoot, nav);

// Shrink the bottom nav while scrolling down, expand it when scrolling up
// or near the top of the page.
let lastScrollY = window.scrollY;
let navScrollTicking = false;

function syncNavScrollState() {
  navScrollTicking = false;
  const y = window.scrollY;
  const goingDown = y > lastScrollY;
  lastScrollY = y;

  if (nav.classList.contains('hidden')) return;

  if (y <= 24) {
    nav.classList.remove('scrolled');
  } else if (goingDown && y > 64) {
    nav.classList.add('scrolled');
  } else if (!goingDown) {
    nav.classList.remove('scrolled');
  }
}

window.addEventListener(
  'scroll',
  () => {
    if (navScrollTicking) return;
    navScrollTicking = true;
    window.requestAnimationFrame(syncNavScrollState);
  },
  { passive: true },
);

const routes = [
  { name: 'login', pattern: /^\/login\/?$/, view: LoginView },
  { name: 'home', pattern: /^\/?$/, view: HomeView },
  { name: 'routines', pattern: /^\/routines\/?$/, view: TrainingView },
  {
    name: 'routine-new',
    pattern: /^\/routines\/new\/?$/,
    view: RoutineEditorView,
    params: () => ({ id: null }),
  },
  {
    name: 'routine-edit',
    pattern: /^\/routines\/(\d+)\/edit\/?$/,
    view: RoutineEditorView,
    params: (match) => ({ id: Number(match[1]) }),
  },
  {
    name: 'routine',
    pattern: /^\/routines\/(\d+)\/?$/,
    view: RoutineView,
    params: (match) => ({ id: Number(match[1]) }),
  },
  { name: 'active', pattern: /^\/workout\/active\/?$/, view: ActiveView },
  { name: 'history', pattern: /^\/workouts\/?$/, view: HistoryView },
  {
    name: 'workout',
    pattern: /^\/workouts\/(\d+)\/?$/,
    view: WorkoutView,
    params: (match) => ({ id: Number(match[1]) }),
  },
  { name: 'exercises', pattern: /^\/exercises\/?$/, view: ExercisesView },
  {
    name: 'measurements',
    pattern: /^\/measurements\/?$/,
    view: MeasurementsView,
  },
  { name: 'profile', pattern: /^\/profile\/?$/, view: ProfileView },
];

const state = {
  user: null,
  authConfig: null,
  cleanup: null,
  version: 0,
  activeWorkout: null,
};

function matchRoute(path) {
  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) {
      return { ...route, params: route.params ? route.params(match) : {} };
    }
  }
  return null;
}

function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('/') ? path : `/${path}`;
  const nextHash = `#${target}`;
  if (location.hash === nextHash) {
    handleRoute();
    return;
  }
  if (replace) {
    history.replaceState(null, '', nextHash);
    handleRoute();
  } else {
    location.hash = target;
  }
}

async function logout() {
  try {
    await api.auth.logout();
  } catch {
    // no-op
  }
  // Wipe any locally cached workout so it never leaks to the next user on a
  // shared device.
  clearOfflineData();
  state.user = null;
  state.activeWorkout = null;
  navigate('/login', { replace: true });
}

async function handleUnauthorized() {
  state.user = null;
  state.activeWorkout = null;
  navigate('/login', { replace: true });
}

const ctx = {
  get user() {
    return state.user;
  },
  get authConfig() {
    return state.authConfig;
  },
  get activeWorkout() {
    return state.activeWorkout;
  },
  setActiveWorkout(workout) {
    state.activeWorkout = workout;
    updateNav(document.documentElement.dataset.route || 'home');
  },
  setUser(user) {
    state.user = user;
  },
  completeLogin(user) {
    state.user = user;
    state.authConfig = null;
    navigate('/', { replace: true });
  },
  navigate,
  logout,
  handleUnauthorized,
  refresh: () => handleRoute(),
  refreshActive: async () => {
    if (!state.user) return null;
    try {
      const { workout } = await api.workouts.active();
      state.activeWorkout = workout;
      return workout;
    } catch (error) {
      // Offline: fall back to the locally saved workout (started/edited with no
      // connectivity) so the "active workout" banner still shows.
      if (error?.status === 0) {
        const local = await loadActiveWorkout(state.user.id);
        state.activeWorkout = local;
        return local;
      }
      return null;
    }
  },
};

function navItem(name, label, path, iconName, active) {
  return `
    <a class="nav-item ${active ? 'active' : ''}" href="#${path}" data-link="${path}" aria-label="${label}">
      ${icon(iconName, 23, 2)}
      <span>${label}</span>
      <span class="nav-dot ${name === 'active' && state.activeWorkout ? '' : 'hidden'}"></span>
    </a>
  `;
}

function updateNav(routeName) {
  document.documentElement.dataset.route = routeName;
  if (!state.user || routeName === 'login') {
    nav.classList.add('hidden');
    shell.classList.add('no-nav');
    return;
  }

  const trainingActive = ['routines', 'routine', 'routine-new', 'routine-edit', 'active', 'history', 'workout'].includes(routeName);
  const profileActive = ['profile', 'measurements', 'exercises'].includes(routeName);

  nav.innerHTML = [
    navItem('home', 'Inicio', '/', 'home', routeName === 'home'),
    navItem('training', 'Entrenar', '/routines', 'dumbbell', trainingActive),
    navItem('profile', 'Perfil', '/profile', 'user', profileActive),
  ].join('');
  nav.classList.remove('hidden');
  shell.classList.remove('no-nav');
}

async function loadActiveState() {
  try {
    const { workout } = await api.workouts.active();
    state.activeWorkout = workout;
  } catch (error) {
    // Offline: recover the locally saved workout if there is one.
    state.activeWorkout =
      error?.status === 0 && state.user
        ? await loadActiveWorkout(state.user.id)
        : null;
  }
}

async function handleRoute() {
  const path = location.hash.replace(/^#/, '') || '/';
  const route = matchRoute(path);

  if (!route) {
    navigate('/', { replace: true });
    return;
  }

  if (!state.user && route.name !== 'login') {
    navigate('/login', { replace: true });
    return;
  }

  if (state.user && route.name === 'login') {
    navigate('/', { replace: true });
    return;
  }

  if (state.cleanup) {
    try {
      state.cleanup();
    } catch {
      // ignore cleanup errors
    }
    state.cleanup = null;
  }

  const version = ++state.version;
  updateNav(route.name);
  viewRoot.innerHTML = loaderScreen();

  if (!state.user) {
    try {
      const { user } = await api.auth.me();
      state.user = user;
    } catch {
      state.user = null;
    }
  }

  if (!state.user && route.name !== 'login') {
    navigate('/login', { replace: true });
    return;
  }

  if (state.user && route.name === 'login') {
    navigate('/', { replace: true });
    return;
  }

  try {
    const cleanup = await route.view.render(viewRoot, ctx, route.params || {});
    if (version !== state.version) {
      cleanup?.();
      return;
    }
    if (typeof cleanup === 'function') state.cleanup = cleanup;
    updateNav(route.name);
    window.scrollTo({ top: 0, behavior: 'auto' });
    lastScrollY = 0;
    nav.classList.remove('scrolled');
  } catch (error) {
    if (error?.status === 401) {
      handleUnauthorized();
      return;
    }
    console.error(error);
    viewRoot.innerHTML = errorScreen(errorMessage(error), 'data-retry');
  }
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-link]');
  if (link) {
    event.preventDefault();
    navigate(link.dataset.link);
    return;
  }

  const retry = event.target.closest('[data-retry]');
  if (retry) {
    event.preventDefault();
    handleRoute();
  }

  const reboot = event.target.closest('[data-reboot]');
  if (reboot) {
    event.preventDefault();
    boot();
  }
});

window.addEventListener('hashchange', handleRoute);

async function boot() {
  shell.classList.add('no-nav');
  viewRoot.innerHTML = loaderScreen('Preparando tu espacio...');

  try {
    state.authConfig = await api.auth.config();
  } catch {
    state.authConfig = { googleEnabled: false, devLoginEnabled: true };
  }

  let offline = false;
  try {
    const { user } = await api.auth.me();
    state.user = user;
  } catch (error) {
    state.user = null;
    // status 0 means the request never reached the server (offline). Treat that
    // differently from a 401: the shell loaded from cache, so show an explicit
    // offline state with a retry instead of bouncing to the login screen as if
    // the session had expired.
    offline = error?.status === 0;
  }

  if (offline && !state.user) {
    nav.classList.add('hidden');
    shell.classList.add('no-nav');
    viewRoot.innerHTML = offlineScreen('data-reboot');
    return;
  }

  await loadActiveState();
  await handleRoute();

  // Upload any workout that was finished while offline, now and whenever
  // connectivity returns. Idempotent (/sync is keyed by clientId), best-effort.
  const trySyncFinished = async () => {
    if (!state.user) return;
    try {
      const finished = await syncFinishedOffline(state.user.id, api);
      if (finished) {
        state.activeWorkout = null;
        updateNav(document.documentElement.dataset.route || 'home');
      }
    } catch {
      // stay pending; will retry on the next reconnect / launch
    }
  };
  trySyncFinished();
  window.addEventListener('online', trySyncFinished);
}

boot();

// Register the service worker (PWA install + offline shell). Non-blocking and
// best-effort: failures must never break the app.
if ('serviceWorker' in navigator) {
  // When a freshly deployed worker takes control (it calls skipWaiting +
  // clients.claim), reload once so the page stops running the old cached JS.
  // Without this the previous worker keeps serving stale modules until the
  // user manually clears the cache, which can leave the shell half-updated.
  // Only reload when a worker *replaces* an existing one: if the page already
  // had a controller at load time, a later controllerchange is an update, not
  // the first install.
  const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadControllerAtLoad && !reloadingForUpdate) {
      reloadingForUpdate = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* ignore: offline/PWA features simply stay disabled */
    });
  });
}
