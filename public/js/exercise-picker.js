import { api, errorMessage } from './api.js';
import { debounce, esc, icon, openModal } from './ui.js';
import {
  searchCatalogLocal,
  categoriesLocal,
  mineLocal,
} from './offline/catalog-cache.js';

// Groups the catalog categories the way Hevy splits muscles, so the muscle
// sheet feels familiar. Any category not listed falls back to "Otros".
const CATEGORY_GROUPS = [
  { label: 'Tren superior', categories: ['Abdominales', 'Brazos', 'Espalda', 'Cuello', 'Hombros', 'Pecho'] },
  { label: 'Tren inferior', categories: ['Piernas', 'Gemelos'] },
  { label: 'Otros', categories: ['Cardio', 'Estiramientos'] },
];

const CATEGORY_ICON = {
  Abdominales: 'target',
  Brazos: 'dumbbell',
  Cardio: 'activity',
  Cuello: 'user',
  Espalda: 'layers',
  Estiramientos: 'activity',
  Gemelos: 'arrowDown',
  Hombros: 'user',
  Pecho: 'target',
  Piernas: 'dumbbell',
};

function groupCategories(categories) {
  const byName = new Map(categories.map((cat) => [cat.category, cat]));
  const used = new Set();
  const groups = [];

  for (const group of CATEGORY_GROUPS) {
    const items = group.categories
      .filter((name) => byName.has(name))
      .map((name) => {
        used.add(name);
        return byName.get(name);
      });
    if (items.length) groups.push({ label: group.label, items });
  }

  const rest = categories.filter((cat) => !used.has(cat.category));
  if (rest.length) groups.push({ label: 'Otros', items: rest });
  return groups;
}

/**
 * Opens the "add exercise" sheet with text search, Catalog / My exercises
 * tabs and a muscle-group (category) filter.
 *
 * @param {object} options
 * @param {(item: {catalogId?: string, exerciseId?: number, name: string, category: string, imageUrl: string|null}) => void} options.onPick
 *   Called with the chosen exercise. The sheet closes automatically afterwards.
 */
export function openExercisePicker({ onPick, title = 'Añadir ejercicio', userId = null } = {}) {
  let categories = [];
  let tab = 'catalog';
  let category = ''; // '' == all muscle groups

  const offline = () =>
    typeof navigator !== 'undefined' && navigator.onLine === false;
  const isNetworkError = (err) => err && err.status === 0;

  const modal = openModal({
    title,
    sheet: true,
    content: `
      <div class="stack-sm">
        <div class="search-box">
          ${icon('search', 18)}
          <input class="input" type="search" data-search placeholder="Buscar ejercicio..." autocomplete="off" />
        </div>
        <div class="row" style="gap:8px">
          <button type="button" class="chip" data-muscle-filter style="flex:1;justify-content:space-between">
            <span><span data-muscle-label>Todos los músculos</span></span>
            ${icon('chevronDown', 15)}
          </button>
        </div>
        <div class="segmented" data-tabs>
          <button type="button" class="active" data-tab="catalog">Catálogo</button>
          <button type="button" data-tab="mine">Mis ejercicios</button>
        </div>
        <div class="picker-results" data-results>
          <div class="empty" style="padding:24px 8px"><div class="spinner"></div></div>
        </div>
      </div>
    `,
  });

  const resultsEl = modal.body.querySelector('[data-results]');
  const searchEl = modal.body.querySelector('[data-search]');
  const muscleFilterBtn = modal.body.querySelector('[data-muscle-filter]');
  const muscleLabelEl = modal.body.querySelector('[data-muscle-label]');

  const updateMuscleButton = () => {
    muscleLabelEl.textContent = category || 'Todos los músculos';
    muscleFilterBtn.classList.toggle('active', Boolean(category));
  };

  const PAGE_SIZE = 40;
  // Paging state for the current query/category/tab, mirroring the browse view
  // (public/js/views/exercises.js): loadMore(reset) handles both the first page
  // and subsequent ones, and an IntersectionObserver on a sentinel at the end
  // of the list triggers the next page. This lets the user reach every exercise
  // instead of being capped at a single response.
  let offset = 0;
  let hasMore = true;
  let loading = false;
  let loadToken = 0; // invalidates in-flight loads when filters change
  let observer = null;

  const mapCatalogRow = (row) => ({
    catalogId: row.id,
    name: row.name,
    category: row.category,
    imageUrl: row.thumbnailUrl || row.imageUrl || null,
  });
  const mapMineRow = (row) => ({
    exerciseId: row.id,
    name: row.name,
    category: row.category,
    imageUrl: row.imageUrl || null,
  });

  const itemHtml = (item) => `
    <button type="button" class="picker-item" data-pick='${esc(JSON.stringify(item))}'>
      <span class="exercise-thumb ${item.imageUrl ? '' : 'gray'}" style="width:44px;height:44px;border-radius:11px">
        ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : icon('dumbbell', 18)}
      </span>
      <span class="grow" style="min-width:0">
        <span class="n">${esc(item.name)}</span>
        <span class="c">${esc(item.category || '')}</span>
      </span>
      ${icon('plus', 18)}
    </button>`;

  const emptyHtml = `<div class="empty" style="padding:24px 8px">
      <div class="empty-icon">${icon('search', 20)}</div>
      <p>Sin resultados</p>
    </div>`;

  const sentinelMarkup = () =>
    `<div data-sentinel style="padding:16px 8px;display:flex;justify-content:center">
      <div class="spinner"></div>
    </div>`;

  /**
   * Fetch one page of results for the current tab/query/category at `offset`.
   * Mirrors the online/offline fallback logic for both tabs.
   */
  const fetchPage = async (query, pageOffset) => {
    if (tab === 'catalog') {
      const exercises = offline()
        ? await searchCatalogLocal(userId, query, category, { limit: PAGE_SIZE, offset: pageOffset })
        : await api.exercises
            .search(query, category, { limit: PAGE_SIZE, offset: pageOffset })
            .then((r) => r.exercises);
      return exercises.map(mapCatalogRow);
    }
    // "Mis ejercicios" has no server paging (one full response); slice it here
    // so the same offset/PAGE_SIZE contract applies and paging terminates.
    const exercises = offline()
      ? await mineLocal(userId, query, { limit: PAGE_SIZE, offset: pageOffset })
      : await api.exercises
          .mine(query)
          .then((r) => (r.exercises || []).slice(pageOffset, pageOffset + PAGE_SIZE));
    return exercises.map(mapMineRow);
  };

  // Load the next page. `reset` restarts from offset 0 (new query/category/tab).
  const load = async (reset = false) => {
    if (loading) return;
    if (!reset && !hasMore) return;
    loading = true;

    if (reset) {
      offset = 0;
      hasMore = true;
      loadToken += 1;
      resultsEl.innerHTML = `<div class="empty" style="padding:24px 8px"><div class="spinner"></div></div>`;
    }

    const token = loadToken;
    const query = searchEl.value.trim();

    try {
      let items;
      try {
        items = await fetchPage(query, offset);
      } catch (error) {
        // A network failure while "online" (flaky link): fall back to cache.
        if (!isNetworkError(error)) throw error;
        items =
          tab === 'catalog'
            ? (await searchCatalogLocal(userId, query, category, { limit: PAGE_SIZE, offset })).map(mapCatalogRow)
            : (await mineLocal(userId, query, { limit: PAGE_SIZE, offset })).map(mapMineRow);
      }
      // A newer load started while this request was in flight: drop it.
      if (token !== loadToken) return;

      if (reset) resultsEl.innerHTML = '';
      // Remove the previous sentinel before appending the new page.
      resultsEl.querySelector('[data-sentinel]')?.remove();

      offset += items.length;
      hasMore = items.length === PAGE_SIZE;

      if (!resultsEl.children.length && !items.length) {
        resultsEl.innerHTML = emptyHtml;
        return;
      }

      for (const item of items) resultsEl.insertAdjacentHTML('beforeend', itemHtml(item));
      if (hasMore) {
        resultsEl.insertAdjacentHTML('beforeend', sentinelMarkup());
        observer?.observe(resultsEl.querySelector('[data-sentinel]'));
      }
    } catch (error) {
      if (token !== loadToken) return;
      // Only replace the whole area with an error on the first page.
      if (offset === 0) {
        resultsEl.innerHTML = `<div class="notice danger">${icon('info', 16)} ${esc(errorMessage(error))}</div>`;
      }
    } finally {
      if (token === loadToken) loading = false;
    }
  };

  // Infinite scroll via a sentinel at the end of the list, same as the browse
  // view. rootMargin preloads the next page shortly before it is visible.
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load(false);
    },
    { root: modal.body, rootMargin: '300px' }
  );

  const debouncedLoad = debounce(() => load(true), 280);
  searchEl.addEventListener('input', () => debouncedLoad());

  modal.body.querySelector('[data-tabs]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    tab = button.dataset.tab;
    modal.body.querySelectorAll('[data-tab]').forEach((item) => {
      item.classList.toggle('active', item.dataset.tab === tab);
    });
    // The muscle filter only applies to the shared catalog.
    muscleFilterBtn.style.display = tab === 'catalog' ? '' : 'none';
    load(true);
  });

  // --- muscle-group sheet ---
  const openMuscleSheet = async () => {
    const sheet = openModal({
      title: 'Grupo muscular',
      sheet: true,
      content: `<div class="empty" style="padding:24px 8px"><div class="spinner"></div></div>`,
    });

    if (!categories.length) {
      try {
        categories = offline()
          ? await categoriesLocal(userId)
          : (await api.exercises.categories()).categories || [];
      } catch (error) {
        if (isNetworkError(error)) {
          categories = await categoriesLocal(userId);
        } else {
          sheet.body.innerHTML = `<div class="notice danger">${icon('info', 16)} ${esc(errorMessage(error))}</div>`;
          return;
        }
      }
    }

    const groups = groupCategories(categories);
    const total = categories.reduce((sum, cat) => sum + (cat.count || 0), 0);

    sheet.body.innerHTML = `
      <div class="stack">
        <button type="button" class="list-card ${category ? '' : 'picker-item'}" data-pick-category="" style="${category ? '' : 'border-color:var(--accent)'}">
          <span class="exercise-thumb gray" style="width:40px;height:40px;border-radius:11px">${icon('layers', 18)}</span>
          <span class="grow">
            <span class="title">Todos los músculos</span>
            <span class="subtitle">${total} ejercicios</span>
          </span>
          ${category ? '' : icon('check', 18)}
        </button>
        ${groups
          .map(
            (group) => `
          <div class="stack-sm">
            <div class="history-month-title" style="padding:4px 2px 0">${esc(group.label)}</div>
            ${group.items
              .map(
                (cat) => `
              <button type="button" class="list-card" data-pick-category="${esc(cat.category)}" style="${category === cat.category ? 'border-color:var(--accent)' : ''}">
                <span class="exercise-thumb gray" style="width:40px;height:40px;border-radius:11px">${icon(CATEGORY_ICON[cat.category] || 'dumbbell', 18)}</span>
                <span class="grow">
                  <span class="title">${esc(cat.category)}</span>
                  <span class="subtitle">${cat.count} ejercicios</span>
                </span>
                ${category === cat.category ? icon('check', 18) : ''}
              </button>`
              )
              .join('')}
          </div>`
          )
          .join('')}
      </div>
    `;

    sheet.body.addEventListener('click', (event) => {
      const pick = event.target.closest('[data-pick-category]');
      if (!pick) return;
      category = pick.dataset.pickCategory;
      updateMuscleButton();
      sheet.close();
      load(true);
    });
  };

  muscleFilterBtn.addEventListener('click', openMuscleSheet);

  // --- selection ---
  resultsEl.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-pick]');
    if (!pick) return;
    const item = JSON.parse(pick.dataset.pick);
    modal.close();
    onPick?.(item);
  });

  // Stop observing the sentinel once the sheet is dismissed.
  modal.el.addEventListener('close', () => observer?.disconnect());

  updateMuscleButton();
  load(true);

  return modal;
}
