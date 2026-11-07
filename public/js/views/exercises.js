import { api, errorMessage } from '../api.js';
import { connectionNeeded, debounce, esc, icon, openModal, toast } from '../ui.js';

function catalogCard(exercise) {
  return `
    <button type="button" class="catalog-card" data-exercise="${exercise.id}">
      <span class="thumb">
        ${exercise.thumbnailUrl || exercise.imageUrl
          ? `<img src="${esc(exercise.thumbnailUrl || exercise.imageUrl)}" alt="" referrerpolicy="no-referrer" />`
          : icon('dumbbell', 26)}
      </span>
      <span class="n">${esc(exercise.name)}</span>
      <span class="c">${esc(exercise.category || '')}</span>
    </button>
  `;
}

export async function render(container, ctx) {
  let categories = [];
  try {
    const response = await api.exercises.categories();
    categories = response.categories || [];
  } catch (error) {
    if (error.status === 401) {
      ctx.handleUnauthorized();
      return;
    }
  }

  let query = '';
  let category = '';

  container.innerHTML = `
    <div class="view">
      <div class="topbar">
        <button type="button" class="icon-btn surface" data-link="/profile" aria-label="Volver">
          ${icon('arrowLeft', 19)}
        </button>
        <div class="topbar-title">Ejercicios</div>
        <span style="width:40px"></span>
      </div>

      <div class="search-box">
        ${icon('search', 18)}
        <input class="input" type="search" data-search placeholder="Buscar ejercicio..." autocomplete="off" enterkeyhint="search" />
      </div>

      <div class="chip-row" data-categories>
        <button type="button" class="chip active" data-category="">Todos</button>
        ${categories
          .map(
            (cat) =>
              `<button type="button" class="chip" data-category="${esc(cat.category)}">${esc(cat.category)} <span class="text-muted">${cat.count}</span></button>`
          )
          .join('')}
      </div>

      <div class="library-grid" data-results>
        <div class="empty" style="grid-column:1/-1;padding:24px 8px"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  const resultsEl = container.querySelector('[data-results]');

  const PAGE_SIZE = 40;
  let catalogCache = [];
  let offset = 0;
  let hasMore = true;
  let loading = false;
  let loadToken = 0;
  let observer = null;

  const renderCards = (exercises) => exercises.map(catalogCard).join('');

  const showEmpty = () => {
    resultsEl.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:28px 8px">
        <div class="empty-icon">${icon('search', 22)}</div>
        <h3>Sin resultados</h3>
        <p>Prueba con otro término o categoría.</p>
      </div>`;
  };

  const sentinelMarkup = () =>
    `<div data-sentinel style="grid-column:1/-1;padding:16px 8px;display:flex;justify-content:center">
      <div class="spinner"></div>
    </div>`;

  // Load the next page. `reset` restarts from offset 0 (new query/category).
  const loadMore = async (reset = false) => {
    if (loading) return;
    if (!reset && !hasMore) return;
    loading = true;

    if (reset) {
      offset = 0;
      hasMore = true;
      catalogCache = [];
      loadToken += 1;
      resultsEl.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:24px 8px"><div class="spinner"></div></div>`;
    }

    const token = loadToken;

    try {
      const { exercises } = await api.exercises.search(query, category, {
        limit: PAGE_SIZE,
        offset,
      });
      // A newer search started while this request was in flight: drop it.
      if (token !== loadToken) return;

      if (reset) resultsEl.innerHTML = '';
      // Remove the previous sentinel before appending the new page.
      resultsEl.querySelector('[data-sentinel]')?.remove();

      catalogCache = catalogCache.concat(exercises);
      offset += exercises.length;
      hasMore = exercises.length === PAGE_SIZE;

      if (!catalogCache.length) {
        showEmpty();
        return;
      }

      resultsEl.insertAdjacentHTML('beforeend', renderCards(exercises));
      if (hasMore) {
        resultsEl.insertAdjacentHTML('beforeend', sentinelMarkup());
        observer?.observe(resultsEl.querySelector('[data-sentinel]'));
      }
    } catch (error) {
      if (token !== loadToken) return;
      if (error.status === 401) {
        ctx.handleUnauthorized();
        return;
      }
      if (error.status === 0) {
        // Offline: the catalog of this browse view is not cached (the exercise
        // picker keeps its own cache). Keep the header/search/chips and show a
        // "needs connection" block in the results area.
        resultsEl.innerHTML = `<div style="grid-column:1/-1">${connectionNeeded(
          'El catálogo de ejercicios aparecerá cuando vuelvas a estar en línea.',
          'data-retry'
        )}</div>`;
        resultsEl.querySelector('[data-retry]')?.addEventListener('click', () => loadMore(true));
        return;
      }
      resultsEl.innerHTML = `<div class="notice danger" style="grid-column:1/-1">${icon('info', 16)} ${esc(errorMessage(error))}</div>`;
    } finally {
      if (token === loadToken) loading = false;
    }
  };

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore(false);
    },
    { root: null, rootMargin: '300px' }
  );

  const load = () => loadMore(true);

  const debouncedLoad = debounce(load, 280);

  container.querySelector('[data-search]').addEventListener('input', (event) => {
    query = event.target.value.trim();
    debouncedLoad();
  });

  container.querySelector('[data-categories]').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category]');
    if (!chip) return;
    category = chip.dataset.category;
    container.querySelectorAll('[data-category]').forEach((item) => {
      item.classList.toggle('active', item.dataset.category === category);
    });
    load();
  });

  const openDetail = async (exerciseId) => {
    let exercise = catalogCache.find((item) => item.id === exerciseId);
    const modal = openModal({
      title: exercise?.name || 'Ejercicio',
      content: `<div class="empty" style="padding:24px 8px"><div class="spinner"></div></div>`,
    });

    try {
      if (!exercise || !exercise.description) {
        const response = await api.exercises.catalog(exerciseId);
        exercise = response.exercise;
      }
    } catch (error) {
      modal.body.innerHTML = `<div class="notice danger">${icon('info', 16)} ${esc(errorMessage(error))}</div>`;
      return;
    }

    modal.body.innerHTML = `
      <div class="stack-sm">
        <div class="catalog-detail-hero">
          <span class="img">
            ${exercise.imageUrl || exercise.thumbnailUrl
              ? `<img src="${esc(exercise.imageUrl || exercise.thumbnailUrl)}" alt="" referrerpolicy="no-referrer" />`
              : `<span style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)">${icon('dumbbell', 32)}</span>`}
          </span>
          <div class="grow" style="min-width:0">
            <div class="text-lg font-bold">${esc(exercise.name)}</div>
            <div class="text-sm text-muted">${esc(exercise.category || '')}</div>
            ${exercise.equipment?.length ? `<div class="tag-list" style="margin-top:8px">${exercise.equipment.map((eq) => `<span class="mini-chip">${esc(eq)}</span>`).join('')}</div>` : ''}
          </div>
        </div>
        ${exercise.muscles?.length ? `<div class="tag-list">${exercise.muscles.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}</div>` : ''}
        ${exercise.description ? `<p class="text-sm text-muted" style="line-height:1.5;white-space:pre-line">${esc(exercise.description)}</p>` : '<p class="text-sm text-muted">Sin descripción disponible.</p>'}
        <button type="button" class="btn btn-primary btn-block" data-add-mine>${icon('plus', 16)} Añadir a mis ejercicios</button>
      </div>
    `;

    modal.body.querySelector('[data-add-mine]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api.exercises.fromCatalog(exercise.id);
        toast(`${exercise.name} añadido a tus ejercicios`, 'success');
        modal.close();
      } catch (error) {
        button.disabled = false;
        toast(errorMessage(error), 'error');
      }
    });
  };

  resultsEl.addEventListener('click', (event) => {
    const card = event.target.closest('[data-exercise]');
    if (!card) return;
    openDetail(card.dataset.exercise);
  });

  await load();

  return () => {
    observer?.disconnect();
    observer = null;
  };
}
