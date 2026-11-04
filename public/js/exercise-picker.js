import { api, errorMessage } from './api.js';
import { debounce, esc, icon, openModal } from './ui.js';

// Groups the catalog categories the way Hevy splits muscles, so the muscle
// sheet feels familiar. Any category not listed falls back to "Otros".
const CATEGORY_GROUPS = [
  { label: 'Tren superior', categories: ['Abdominales', 'Brazos', 'Espalda', 'Hombros', 'Pecho'] },
  { label: 'Tren inferior', categories: ['Piernas', 'Gemelos'] },
  { label: 'Otros', categories: ['Cardio'] },
];

const CATEGORY_ICON = {
  Abdominales: 'target',
  Brazos: 'dumbbell',
  Cardio: 'activity',
  Espalda: 'layers',
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
 * @param {(item: {catalogId?: number, exerciseId?: number, name: string, category: string, imageUrl: string|null}) => void} options.onPick
 *   Called with the chosen exercise. The sheet closes automatically afterwards.
 */
export function openExercisePicker({ onPick } = {}) {
  let categories = [];
  let tab = 'catalog';
  let category = ''; // '' == all muscle groups

  const modal = openModal({
    title: 'Añadir ejercicio',
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

  const renderResults = (items) => {
    resultsEl.innerHTML = items.length
      ? items
          .map(
            (item) => `
        <button type="button" class="picker-item" data-pick='${esc(JSON.stringify(item))}'>
          <span class="exercise-thumb ${item.imageUrl ? '' : 'gray'}" style="width:44px;height:44px;border-radius:11px">
            ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : icon('dumbbell', 18)}
          </span>
          <span class="grow" style="min-width:0">
            <span class="n">${esc(item.name)}</span>
            <span class="c">${esc(item.category || '')}</span>
          </span>
          ${icon('plus', 18)}
        </button>`
          )
          .join('')
      : `<div class="empty" style="padding:24px 8px">
          <div class="empty-icon">${icon('search', 20)}</div>
          <p>Sin resultados</p>
        </div>`;
  };

  const load = async () => {
    resultsEl.innerHTML = `<div class="empty" style="padding:24px 8px"><div class="spinner"></div></div>`;
    const query = searchEl.value.trim();
    try {
      if (tab === 'catalog') {
        const { exercises } = await api.exercises.search(query, category);
        renderResults(
          exercises.map((row) => ({
            catalogId: row.id,
            name: row.name,
            category: row.category,
            imageUrl: row.thumbnailUrl || row.imageUrl,
          }))
        );
      } else {
        const { exercises } = await api.exercises.mine(query);
        renderResults(
          exercises.map((row) => ({
            exerciseId: row.id,
            name: row.name,
            category: row.category,
            imageUrl: row.imageUrl,
          }))
        );
      }
    } catch (error) {
      resultsEl.innerHTML = `<div class="notice danger">${icon('info', 16)} ${esc(errorMessage(error))}</div>`;
    }
  };

  const debouncedLoad = debounce(load, 280);
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
    load();
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
        const response = await api.exercises.categories();
        categories = response.categories || [];
      } catch (error) {
        sheet.body.innerHTML = `<div class="notice danger">${icon('info', 16)} ${esc(errorMessage(error))}</div>`;
        return;
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
      load();
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

  updateMuscleButton();
  load();

  return modal;
}
