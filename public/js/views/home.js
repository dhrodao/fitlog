import { api, errorMessage } from '../api.js';
import { attachPullToRefresh } from '../pull-refresh.js';
import { workoutCard, weekRangeLabel, loadView } from '../view-helpers.js';
import {
  avatar,
  connectionNeeded,
  esc,
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
  // Keep the first visible index aligned with the full `weekly` array so the
  // tap handler can read the right bucket.
  const offset = weekly.length - recent.length;
  return recent
    .map((week, index) => {
      const value = week.durationSeconds || 0;
      const ratio = value / max;
      const isLast = index === recent.length - 1;
      return `
        <button type="button" class="week-bar ${value > 0 ? 'has' : ''} ${isLast ? 'today' : ''}" data-week="${offset + index}" aria-label="${esc(weekLabel(week.weekStart))}">
          <div class="bar" style="height:${Math.max(3, Math.round(ratio * 100))}%"></div>
          <span class="d">${esc(weekLabel(week.weekStart))}</span>
        </button>
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
  let offline = false;
  const result = await loadView(container, ctx, async () => {
    const [overview] = await Promise.all([
      api.stats.overview('3m'),
      ctx.refreshActive(),
    ]);
    return overview;
  });
  if (!result.ok) return;
  if (result.offline) {
    // Offline: render the view structure with empty stats and show a
    // "needs connection" block where the server data would go. refreshActive()
    // already fell back to the local snapshot, so the active banner still works.
    offline = true;
    await ctx.refreshActive();
    data = { totals: {}, recent: [], weekly: [], thisWeekSeconds: 0, allTimeWorkouts: 0 };
  } else {
    data = result.data;
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

      ${offline ? connectionNeeded('Tus estadísticas e historial aparecerán cuando vuelvas a estar en línea.', 'data-retry') : `
      <section class="card-hero hero-week">
        <div class="hero-week-top">
          <div>
            <div class="label" data-week-label>Esta semana</div>
            <div class="big" data-week-big>${esc(formatDuration(data.thisWeekSeconds || 0))}</div>
          </div>
          <a class="chip" href="#/profile" data-link="/profile">Ver estadísticas</a>
        </div>
        <div class="week-bars">${weekBars(data.weekly)}</div>
        <div class="hero-stats" data-week-stats>
          <div class="hero-stat">
            <span class="v" data-stat="a">${esc(String(totals.workouts || 0))}</span>
            <span class="l" data-stat-l="a">Entrenos (3m)</span>
          </div>
          <div class="hero-stat">
            <span class="v" data-stat="b">${esc(formatVolume(totals.volume))} kg</span>
            <span class="l" data-stat-l="b">Volumen</span>
          </div>
          <div class="hero-stat">
            <span class="v" data-stat="c">${esc(String(data.allTimeWorkouts || 0))}</span>
            <span class="l" data-stat-l="c">Total</span>
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
              ? recent.map((workout) => workoutCard(workout)).join('')
              : `<div class="card"><div class="empty" style="padding:18px 8px">
                   <div class="empty-icon">${icon('history', 22)}</div>
                   <h3>Sin entrenamientos aún</h3>
                   <p>Empieza tu primer entreno para ver tu progreso aquí.</p>
                   <a class="btn btn-primary btn-sm" href="#/routines" data-link="/routines">${icon('play', 15)} Empezar</a>
                 </div></div>`
          }
        </div>
      </section>
      `}
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

  const weekly = data.weekly || [];
  const defaultWeekState = {
    label: 'Esta semana',
    big: formatDuration(data.thisWeekSeconds || 0),
    a: [String(totals.workouts || 0), 'Entrenos (3m)'],
    b: [`${formatVolume(totals.volume)} kg`, 'Volumen'],
    c: [String(data.allTimeWorkouts || 0), 'Total'],
  };

  const applyWeekState = (state) => {
    const set = (sel, text) => {
      const el = container.querySelector(sel);
      if (el) el.textContent = text;
    };
    set('[data-week-label]', state.label);
    set('[data-week-big]', state.big);
    set('[data-stat="a"]', state.a[0]);
    set('[data-stat-l="a"]', state.a[1]);
    set('[data-stat="b"]', state.b[0]);
    set('[data-stat-l="b"]', state.b[1]);
    set('[data-stat="c"]', state.c[0]);
    set('[data-stat-l="c"]', state.c[1]);
  };

  const selectWeek = (index) => {
    const week = weekly[index];
    if (!week) return;
    applyWeekState({
      label: weekRangeLabel(week.weekStart),
      big: formatDuration(week.durationSeconds || 0),
      a: [String(week.workouts || 0), 'Entrenos'],
      b: [`${formatVolume(week.volume || 0)} kg`, 'Volumen'],
      c: [String(week.sets || 0), 'Series'],
    });
  };

  const onClick = (event) => {
    if (event.target.closest('[data-open-active]')) {
      ctx.navigate('/workout/active');
      return;
    }
    const start = event.target.closest('[data-start]');
    if (start) {
      ctx.navigate('/routines');
      return;
    }
    const bar = event.target.closest('[data-week]');
    if (bar) {
      const index = Number(bar.dataset.week);
      const bars = container.querySelectorAll('[data-week]');
      if (bar.classList.contains('selected')) {
        bar.classList.remove('selected');
        applyWeekState(defaultWeekState);
      } else {
        bars.forEach((b) => b.classList.remove('selected'));
        bar.classList.add('selected');
        selectWeek(index);
      }
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
