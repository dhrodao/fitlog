import { api, errorMessage } from '../api.js';
import {
  avatar,
  esc,
  formatDate,
  formatDuration,
  formatVolume,
  icon,
  setLoading,
  toast,
} from '../ui.js';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return 'Buenas noches';
  if (hour < 13) return 'Buenos días';
  if (hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function weekBars(weekly = []) {
  const recent = weekly.slice(-8);
  const max = Math.max(1, ...recent.map((week) => week.durationSeconds || 0));
  return recent
    .map((week, index) => {
      const value = week.durationSeconds || 0;
      const ratio = value / max;
      const isLast = index === recent.length - 1;
      return `
        <div class="week-bar ${value > 0 ? 'has' : ''} ${isLast ? 'today' : ''}">
          <div class="bar" style="height:${Math.max(3, Math.round(ratio * 100))}%"></div>
          <span class="d">${esc(weekLabel(week.weekStart))}</span>
        </div>
      `;
    })
    .join('');
}

// Bars represent weeks (weekStart = Monday of each week), so we label them
// with the week's start day/month instead of the weekday name.
function weekLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

export async function render(container, ctx) {
  let data;
  try {
    const [overview] = await Promise.all([
      api.stats.overview('3m'),
      ctx.refreshActive(),
    ]);
    data = overview;
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
  const active = ctx.activeWorkout;
  const now = Date.now();
  const totals = data.totals || {};
  const recent = data.recent || [];

  container.innerHTML = `
    <div class="view stagger">
      <div class="home-head">
        <div>
          <div class="hello">${esc(greeting())}</div>
          <h1>${esc((user?.name || 'Atleta').split(' ')[0])}</h1>
        </div>
        <div class="home-actions">
          <a class="icon-btn surface" href="#/profile" data-link="/profile" aria-label="Perfil">
            ${avatar(user, 'sm')}
          </a>
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
      ` : `
        <button type="button" class="quick-start" data-start>
          <span class="qs-icon">${icon('play', 20)}</span>
          <span class="grow">
            <span class="t">Empezar a entrenar</span>
            <span class="s">Elige una rutina o entrena libre</span>
          </span>
          ${icon('chevronRight', 18)}
        </button>
      `}

      <section class="card-hero hero-week">
        <div class="hero-week-top">
          <div>
            <div class="label">Esta semana</div>
            <div class="big">${esc(formatDuration(data.thisWeekSeconds || 0))}</div>
          </div>
          <a class="chip" href="#/profile" data-link="/profile">Ver estadísticas</a>
        </div>
        <div class="week-bars">${weekBars(data.weekly)}</div>
        <div class="hero-stats">
          <div class="hero-stat">
            <span class="v">${esc(String(totals.workouts || 0))}</span>
            <span class="l">Entrenos (3m)</span>
          </div>
          <div class="hero-stat">
            <span class="v">${esc(formatVolume(totals.volume))} kg</span>
            <span class="l">Volumen</span>
          </div>
          <div class="hero-stat">
            <span class="v">${esc(String(data.allTimeWorkouts || 0))}</span>
            <span class="l">Total</span>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>Historial reciente</h2>
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
                   <h3>Sin entrenamientos aún</h3>
                   <p>Empieza tu primer entreno para ver tu progreso aquí.</p>
                   <a class="btn btn-primary btn-sm" href="#/routines" data-link="/routines">${icon('play', 15)} Empezar</a>
                 </div></div>`
          }
        </div>
      </section>
    </div>
  `;

  const startEmpty = async (button) => {
    setLoading(button, true, 'Empezando...');
    try {
      await api.workouts.create({ name: 'Entreno' });
      ctx.navigate('/workout/active');
    } catch (error) {
      setLoading(button, false);
      if (error.status === 409) ctx.navigate('/workout/active');
      else if (error.status === 401) ctx.handleUnauthorized();
      else toast(errorMessage(error), 'error');
    }
  };

  container.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-active]')) {
      ctx.navigate('/workout/active');
      return;
    }
    const start = event.target.closest('[data-start]');
    if (start) {
      ctx.navigate('/routines');
    }
  });

  const elapsed = container.querySelector('[data-active-elapsed]');
  const timer = active && elapsed
    ? setInterval(() => {
        const seconds = Math.max(0, (Date.now() - new Date(active.startedAt).getTime()) / 1000);
        elapsed.textContent = `${formatDuration(seconds)} · ${active.name}`;
      }, 30000)
    : null;

  return () => {
    if (timer) clearInterval(timer);
  };
}
