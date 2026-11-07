import { api, errorMessage } from '../api.js';
import { attachPullToRefresh } from '../pull-refresh.js';
import { currentTheme } from '../theme.js';
import { createLocalWorkout } from '../offline/local-workout.js';
import { saveActiveWorkout } from '../offline/active-store.js';
import { refreshCatalogCache } from '../offline/catalog-cache.js';
import {
  refreshRoutinesCache,
  cachedRoutinesLocal,
  startRoutineLocal,
} from '../offline/routines-cache.js';
import {
  confirmDialog,
  esc,
  formatDate,
  formatDuration,
  formatVolume,
  haptic,
  icon,
  openActionSheet,
  setLoading,
  toast,
} from '../ui.js';

const FOLDERS_KEY = 'fit-folders-collapsed';

function getCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function setCollapsed(set) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(Array.from(set)));
}

function groupRoutines(routines) {
  const groups = new Map();
  for (const routine of routines) {
    const folder = (routine.folder || '').trim() || 'Mis rutinas';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(routine);
  }

  const names = Array.from(groups.keys()).sort((a, b) => {
    if (a === 'Mis rutinas') return 1;
    if (b === 'Mis rutinas') return -1;
    return a.localeCompare(b, 'es');
  });

  return names.map((name) => ({ name, routines: groups.get(name) }));
}

function routineCard(routine, offline = false) {
  return `
    <article class="routine-card">
      <div class="routine-card-top">
        <div class="grow" style="min-width:0">
          <button type="button" class="link-btn" data-open-routine="${routine.id}" style="color:inherit;text-align:left;padding:0">
            <h3>${esc(routine.name)}</h3>
          </button>
          <div class="routine-preview clamp-2">${esc(routine.preview || 'Sin ejercicios todavía')}</div>
        </div>
        ${offline ? '' : `<button type="button" class="icon-btn" data-routine-menu="${routine.id}" aria-label="Opciones de rutina">
          ${icon('more', 19)}
        </button>`}
      </div>
      <div class="routine-meta">
        <span>${icon('list', 13)} ${routine.exerciseCount} ejercicios</span>
        ${routine.folder ? `<span>${icon('folder', 13)} ${esc(routine.folder)}</span>` : ''}
        ${routine.source === 'hevy' ? `<span class="chip-hevy">${icon('repeat', 12)} Hevy</span>` : ''}
      </div>
      <button type="button" class="btn btn-primary btn-block" data-start-routine="${routine.id}">
        ${icon('play', 16)} Empezar Rutina
      </button>
    </article>
  `;
}

export async function render(container, ctx) {
  let data;
  let offline = false;
  try {
    const [routinesResult, workoutsResult] = await Promise.all([
      api.routines.list(),
      api.workouts.list(4, 0),
      ctx.refreshActive(),
    ]);
    data = {
      routines: routinesResult.routines,
      workouts: workoutsResult.workouts,
    };
  } catch (error) {
    if (error.status === 401) {
      ctx.handleUnauthorized();
      return;
    }
    // Offline (request never reached the server): do NOT show a dead error
    // screen — that would hide "Empezar Entrenamiento Vacío", the one action
    // that works with no connectivity. Render the view with empty routine/
    // history lists plus an offline notice; the active-workout banner still
    // shows because refreshActive() falls back to the local snapshot.
    if (error.status === 0) {
      offline = true;
      await ctx.refreshActive();
      // Routines cached while online stay available (read-only) and can be
      // started offline; history is not cached so it stays empty.
      const cachedRoutines = await cachedRoutinesLocal(ctx.user?.id ?? null);
      data = { routines: cachedRoutines, workouts: [] };
    } else {
      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${icon('info', 24)}</div>
          <h3>No se pudo cargar</h3>
          <p>${esc(errorMessage(error))}</p>
          <button type="button" class="btn btn-secondary btn-sm" data-retry>Reintentar</button>
        </div>`;
      container.querySelector('[data-retry]').addEventListener('click', () => ctx.refresh());
      return;
    }
  }

  const collapsed = getCollapsed();
  const groups = groupRoutines(data.routines);
  const active = ctx.activeWorkout;
  const now = Date.now();

  container.innerHTML = `
    <div class="view stagger">
      <div class="training-head">
        <div class="page-head">
          <span class="eyebrow">Tu plan de hoy</span>
          <div class="training-title">
            <h1>Entrenamiento</h1>
          </div>
        </div>
      </div>

      ${active ? `
        <button type="button" class="active-banner" data-open-active>
          <span class="pulse">${icon('activity', 20)}</span>
          <span class="grow">
            <span class="t">Entrenamiento en curso</span>
            <span class="s" data-active-elapsed>${esc(formatDuration(Math.max(0, (now - new Date(active.startedAt).getTime()) / 1000)))} · ${esc(active.name)}</span>
          </span>
          ${icon('chevronRight', 18)}
        </button>
      ` : ''}

      <button type="button" class="start-empty" data-start-empty>
        <span class="plus">${icon('plus', 18)}</span>
        <span class="grow">Empezar Entrenamiento Vacío</span>
        ${icon('chevronRight', 17)}
      </button>

      ${offline ? `
        <div class="notice">
          ${icon('info', 16)}
          <span>${data.routines.length
            ? 'Sin conexión. Puedes empezar un entreno vacío o una rutina guardada; el historial aparecerá cuando vuelvas a estar en línea.'
            : 'Sin conexión. Puedes empezar un entreno vacío; las rutinas y el historial aparecerán cuando vuelvas a estar en línea.'}</span>
        </div>
      ` : ''}

      <section>
        <div class="section-head">
          <h2>Rutinas</h2>
          <button type="button" class="icon-btn" data-new-routine aria-label="Nueva rutina">${icon('folderPlus', 20)}</button>
        </div>
        <div class="more-grid" style="margin-bottom:14px">
          <button type="button" class="quick-tile" data-new-routine>
            <span class="q-icon">${icon('list', 18)}</span>
            <span>Nueva Rutina</span>
          </button>
          <button type="button" class="quick-tile" data-explore>
            <span class="q-icon">${icon('search', 18)}</span>
            <span>Explorar</span>
          </button>
        </div>

        <div class="stack-sm">
          ${
            groups.length
              ? groups
                  .map((group) => {
                    const isClosed = collapsed.has(group.name);
                    return `
                      <div class="folder ${isClosed ? 'closed' : ''}" data-folder="${esc(group.name)}">
                        <button type="button" class="folder-head" data-folder-toggle="${esc(group.name)}">
                          ${icon('chevronDown', 16, 2.4)}
                          <span class="grow">${esc(group.name)}</span>
                          <span class="folder-count">(${group.routines.length})</span>
                        </button>
                        <div class="folder-body">
                          <div class="folder-body-inner">
                            ${group.routines.map((r) => routineCard(r, offline)).join('')}
                          </div>
                        </div>
                      </div>
                    `;
                  })
                  .join('')
              : `<div class="card">
                   <div class="empty" style="padding:18px 8px">
                     <div class="empty-icon">${icon('folderPlus', 22)}</div>
                     <h3>Aún no tienes rutinas</h3>
                     <p>Crea tu primera rutina y empieza a registrar tu progreso.</p>
                     <button type="button" class="btn btn-primary btn-sm" data-new-routine>${icon('plus', 15)} Nueva rutina</button>
                   </div>
                 </div>`
          }
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>Historial reciente</h2>
          <a class="link-btn" href="#/workouts" data-link="/workouts">Ver todo</a>
        </div>
        <div class="stack-sm">
          ${
            data.workouts.length
              ? data.workouts
                  .map(
                    (workout) => `
                    <button type="button" class="workout-card" data-link="/workouts/${workout.id}">
                      <div class="workout-card-top">
                        <div class="grow" style="min-width:0">
                          <div class="name">${esc(workout.name)}</div>
                          <div class="date">${esc(formatDate(workout.startedAt))} · ${esc(formatDuration(workout.durationSeconds))}</div>
                        </div>
                        ${workout.summary?.records ? `<span class="badge badge-warning">${icon('trophy', 11)} ${workout.summary.records} PR</span>` : ''}
                        ${icon('chevronRight', 17)}
                      </div>
                      <div class="stats">
                        <span class="stat-mini">${icon('dumbbell', 13)} ${formatVolume(workout.summary?.volume)} kg</span>
                        <span class="stat-mini">${icon('check', 13)} ${workout.summary?.sets || 0} series</span>
                        <span class="stat-mini">${icon('layers', 13)} ${workout.exercises.length} ejercicios</span>
                      </div>
                    </button>
                  `
                  )
                  .join('')
              : `<div class="card"><div class="empty" style="padding:18px 8px">
                   <div class="empty-icon">${icon('history', 22)}</div>
                   <h3>Sin entrenamientos</h3>
                   <p>Cuando termines tu primer entreno aparecerá aquí.</p>
                 </div></div>`
          }
        </div>
      </section>
    </div>
  `;

  // While online, keep the offline routines cache warm so routines can be read
  // and started on a later offline session. Fire-and-forget; never blocks.
  if (!offline) {
    refreshRoutinesCache(api, ctx.user?.id ?? null);
  }

  const startEmpty = async () => {
    const buttons = container.querySelectorAll('[data-start-empty]');
    buttons.forEach((button) => setLoading(button, true, 'Empezando...'));

    // Create a local workout, persist it as the active snapshot and navigate.
    // Shared by the explicit-offline path and the network-failure fallback.
    const startLocal = async () => {
      const workout = createLocalWorkout({ name: 'Entreno' });
      await saveActiveWorkout(ctx.user?.id ?? null, workout);
      haptic(10);
      ctx.navigate('/workout/active');
    };

    // Explicitly offline: skip the request entirely and go local.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await startLocal();
      return;
    }

    try {
      await api.workouts.create({ name: 'Entreno' });
      haptic(10);
      // Fire-and-forget: warm the offline catalog cache so a later offline
      // session can still build a workout from scratch. Never blocks the nav.
      refreshCatalogCache(api, ctx.user?.id ?? null);
      ctx.navigate('/workout/active');
    } catch (error) {
      buttons.forEach((button) => setLoading(button, false));
      if (error.status === 409) {
        ctx.navigate('/workout/active');
      } else if (error.status === 401) {
        ctx.handleUnauthorized();
      } else if (error.status === 0) {
        // The request never reached the server (connection dropped): degrade to
        // a local workout instead of failing the start.
        await startLocal();
      } else {
        toast(errorMessage(error), 'error');
      }
    }
  };

  const startRoutine = async (button, id) => {
    // Start from a locally cached routine: materialize it into a local workout
    // and persist it as the active snapshot. Shared by the explicit-offline
    // path and the network-failure fallback.
    const startLocal = async () => {
      const workout = await startRoutineLocal(ctx.user?.id ?? null, id);
      if (!workout) {
        if (button) setLoading(button, false);
        toast('Esta rutina no está disponible sin conexión', 'error');
        return false;
      }
      await saveActiveWorkout(ctx.user?.id ?? null, workout);
      haptic(10);
      ctx.navigate('/workout/active');
      return true;
    };

    // Explicitly offline: skip the request and start from the cache.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await startLocal();
      return;
    }
    setLoading(button, true, 'Empezando...');
    try {
      await api.routines.start(id);
      haptic(10);
      refreshCatalogCache(api, ctx.user?.id ?? null);
      ctx.navigate('/workout/active');
    } catch (error) {
      setLoading(button, false);
      if (error.status === 409) {
        ctx.navigate('/workout/active');
      } else if (error.status === 401) {
        ctx.handleUnauthorized();
      } else if (error.status === 0) {
        // The request never reached the server: fall back to the cached routine.
        await startLocal();
      } else {
        toast(errorMessage(error), 'error');
      }
    }
  };

  const openMenu = (routine) => {
    openActionSheet(routine.name, [
      {
        label: 'Empezar rutina',
        icon: 'play',
        onClick: () => {
          const button = container.querySelector(`[data-start-routine="${routine.id}"]`);
          if (button) startRoutine(button, routine.id);
        },
      },
      {
        label: 'Ver rutina',
        icon: 'eye',
        onClick: () => ctx.navigate(`/routines/${routine.id}`),
      },
      {
        label: 'Editar rutina',
        icon: 'pencil',
        onClick: () => ctx.navigate(`/routines/${routine.id}/edit`),
      },
      {
        label: 'Duplicar',
        icon: 'repeat',
        sub: 'Crea una copia con los mismos ejercicios',
        onClick: async () => {
          try {
            await api.routines.duplicate(routine.id);
            toast('Rutina duplicada', 'success');
            ctx.refresh();
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
            message: `"${routine.name}" se eliminará. Los entrenamientos ya registrados se conservarán.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!confirmed) return;
          try {
            await api.routines.remove(routine.id);
            toast('Rutina eliminada', 'success');
            ctx.refresh();
          } catch (error) {
            toast(errorMessage(error), 'error');
          }
        },
      },
    ]);
  };

  const onClick = (event) => {
    if (event.target.closest('[data-start-empty]')) {
      startEmpty();
      return;
    }

    const newRoutine = event.target.closest('[data-new-routine]');
    if (newRoutine) {
      ctx.navigate('/routines/new');
      return;
    }

    const explore = event.target.closest('[data-explore]');
    if (explore) {
      ctx.navigate('/exercises');
      return;
    }

    const openActive = event.target.closest('[data-open-active]');
    if (openActive) {
      ctx.navigate('/workout/active');
      return;
    }

    const startButton = event.target.closest('[data-start-routine]');
    if (startButton) {
      startRoutine(startButton, Number(startButton.dataset.startRoutine));
      return;
    }

    const openRoutine = event.target.closest('[data-open-routine]');
    if (openRoutine) {
      ctx.navigate(`/routines/${openRoutine.dataset.openRoutine}`);
      return;
    }

    const menuButton = event.target.closest('[data-routine-menu]');
    if (menuButton) {
      const routine = data.routines.find(
        (item) => item.id === Number(menuButton.dataset.routineMenu)
      );
      if (routine) openMenu(routine);
      return;
    }

    const folderToggle = event.target.closest('[data-folder-toggle]');
    if (folderToggle) {
      const name = folderToggle.dataset.folderToggle;
      const folder = folderToggle.closest('.folder');
      const collapsedSet = getCollapsed();
      if (collapsedSet.has(name)) {
        collapsedSet.delete(name);
        folder.classList.remove('closed');
      } else {
        collapsedSet.add(name);
        folder.classList.add('closed');
      }
      haptic(8);
      setCollapsed(collapsedSet);
    }
  };
  container.addEventListener('click', onClick);

  const elapsed = container.querySelector('[data-active-elapsed]');
  const timer = active && elapsed
    ? setInterval(() => {
        const seconds = Math.max(0, (Date.now() - new Date(active.startedAt).getTime()) / 1000);
        elapsed.textContent = `${formatDuration(seconds)} · ${active.name}`;
      }, 30000)
    : null;

  const detachPull = attachPullToRefresh({ onRefresh: () => ctx.refresh() });

  return () => {
    container.removeEventListener('click', onClick);
    if (timer) clearInterval(timer);
    detachPull();
  };
}
