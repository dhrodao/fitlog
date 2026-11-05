import { api, errorMessage } from '../api.js';
import { debounce, esc, icon, openModal, toast } from '../ui.js';

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
        <input class="input" type="search" data-search placeholder="Buscar ejercicio..." autocomplete="off" />
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

  const renderResults = (exercises) => {
    resultsEl.innerHTML = exercises.length
      ? exercises.map(catalogCard).join('')
      : `<div class="empty" style="grid-column:1/-1;padding:28px 8px">
          <div class="empty-icon">${icon('search', 22)}</div>
          <h3>Sin resultados</h3>
          <p>Prueba con otro término o categoría.</p>
        </div>`;
  };

  let catalogCache = [];

  const load = async () => {
    resultsEl.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:24px 8px"><div class="spinner"></div></div>`;
    try {
      const { exercises } = await api.exercises.search(query, category);
      catalogCache = exercises;
      renderResults(exercises);
    } catch (error) {
      if (error.status === 401) {
        ctx.handleUnauthorized();
        return;
      }
      resultsEl.innerHTML = `<div class="notice danger" style="grid-column:1/-1">${icon('info', 16)} ${esc(errorMessage(error))}</div>`;
    }
  };

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
}
