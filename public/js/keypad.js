// On-screen numeric keypad for the Kg / Reps inputs of the active workout.
//
// The iOS decimal keyboard has no return key, so there is no way to go from Kg
// to Reps or to confirm a set without tapping the screen. This keypad replaces
// it on touch devices. The inputs stay real <input> elements (focusable, with a
// caret and selection, still usable with a hardware keyboard); they just get
// `inputmode="none"` so the system keyboard stays hidden. Every key press
// writes the value and dispatches a normal `input` event, so the view's
// existing handlers (stats, records, debounced save) run unchanged.

import { icon } from './ui.js';
import { applyKey } from './keypad-logic.js';

/** Touch-first devices only; desktop keeps the native keyboard. */
export function isTouchKeypad() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

const KEYS = [
  ['1', '2', '3', 'hide'],
  ['4', '5', '6', 'inc'],
  ['7', '8', '9', 'dec'],
  ['.', '0', 'backspace', 'action'],
];

const LABELS = {
  hide: 'Ocultar teclado',
  inc: 'Aumentar',
  dec: 'Disminuir',
  backspace: 'Borrar',
};

function keyMarkup(key) {
  if (key === 'hide') return icon('chevronDown', 22, 2);
  if (key === 'inc') return icon('plus', 22, 2);
  if (key === 'dec') return icon('minus', 22, 2);
  if (key === 'backspace') return icon('backspace', 24, 1.8);
  if (key === 'action') return '';
  if (key === '.') return '.';
  return key;
}

/**
 * @param {object} options
 * @param {HTMLElement} options.scope  Element holding the `[data-field]` inputs.
 * @param {(input: HTMLInputElement) => void} options.onAction
 *        The big action key was pressed on `input`: the view decides what comes
 *        next (focus another field, complete the set, hide the keypad).
 * @param {string} [options.keepOpenOn]  CSS selector of other UI that works
 *        together with the keypad (e.g. the rest timer docked above it). Taps
 *        on it neither close the keypad nor take the focus away from the field.
 *        Without this the keypad would close on pointerdown, the docked element
 *        would drop back to its normal place and the click would land on
 *        whatever is underneath.
 * @returns {{ hide(): void, destroy(): void, focusField(el: HTMLElement): void }}
 */
export function createKeypad({ scope, onAction, keepOpenOn = null }) {
  const root = document.documentElement;
  const el = document.createElement('div');
  el.className = 'keypad';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Teclado numérico');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = KEYS.flat()
    .map((key) => {
      const label = LABELS[key] ? ` aria-label="${LABELS[key]}"` : '';
      const extra = key === 'action' ? ' keypad-action' : '';
      return `<button type="button" class="keypad-key${extra}" data-key="${key}" tabindex="-1"${label}>${keyMarkup(key)}</button>`;
    })
    .join('');
  document.body.append(el);

  const actionKey = el.querySelector('[data-key="action"]');
  let active = null;
  let fresh = false;
  // True once a key changed the value of `active`. Screens that save on the
  // native `change` event (the workout editor) need it, because assigning
  // input.value from script never fires `change` on its own.
  let dirty = false;

  function commit() {
    if (!active || !dirty) return;
    dirty = false;
    if (active.isConnected) active.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function paintAction() {
    const isReps = active?.dataset.field === 'reps';
    actionKey.classList.toggle('is-done', isReps);
    actionKey.innerHTML = icon(isReps ? 'check' : 'arrowRight', 26, 2.2);
    actionKey.setAttribute('aria-label', isReps ? 'Completar serie' : 'Siguiente: repeticiones');
    el.dataset.field = active?.dataset.field ?? '';
  }

  // Scroll just enough that the edited row sits between the sticky header and
  // whatever covers the bottom of the screen: the keypad and, when running, the
  // rest timer docked above it.
  function ensureVisible(input) {
    const row = input.closest('.set-row') || input;
    const rect = row.getBoundingClientRect();
    const rest = document.querySelector('.rest-timer:not([hidden])');
    const covered = el.offsetHeight + (rest ? rest.offsetHeight + 10 : 0);
    const keypadTop = window.innerHeight - covered;
    const headBottom = document.querySelector('.active-head')?.getBoundingClientRect().bottom ?? 0;
    if (rect.bottom > keypadTop - 12) {
      window.scrollBy({ top: rect.bottom - keypadTop + 12, behavior: 'smooth' });
    } else if (rect.top < headBottom + 8) {
      window.scrollBy({ top: rect.top - headBottom - 8, behavior: 'smooth' });
    }
  }

  function selectAll(input) {
    try {
      input.select();
    } catch {
      /* some input types do not support selection */
    }
  }

  function show(input) {
    if (active && active !== input) commit();
    active = input;
    fresh = true;
    dirty = false;
    paintAction();
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    root.classList.add('keypad-open');
    root.style.setProperty('--keypad-h', `${el.offsetHeight}px`);
    // The tap that focused the field places a caret right after the focus
    // event; select on the next frame so "typing replaces the value" holds.
    requestAnimationFrame(() => {
      if (active === input) selectAll(input);
      ensureVisible(input);
    });
  }

  function hide() {
    commit();
    const input = active;
    active = null;
    fresh = false;
    dirty = false;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    root.classList.remove('keypad-open');
    root.style.removeProperty('--keypad-h');
    if (input && document.activeElement === input) input.blur();
  }

  function press(key) {
    if (!active || !active.isConnected) {
      hide();
      return;
    }
    if (key === 'hide') {
      hide();
      return;
    }
    if (key === 'action') {
      onAction(active);
      return;
    }
    const next = applyKey(active.value, key, { field: active.dataset.field, fresh });
    fresh = next.fresh;
    if (next.value !== active.value) {
      active.value = next.value;
      dirty = true;
      active.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (fresh) selectAll(active);
  }

  // Keep the focus (and the selection) in the input while keys are tapped.
  const keepFocus = (event) => event.preventDefault();
  el.addEventListener('pointerdown', keepFocus);
  el.addEventListener('mousedown', keepFocus);
  el.addEventListener('click', (event) => {
    const key = event.target.closest('[data-key]')?.dataset.key;
    if (key) press(key);
  });

  const onFocusIn = (event) => {
    const input = event.target.closest?.('[data-field]');
    if (input) show(input);
  };
  scope.addEventListener('focusin', onFocusIn);

  // A tap anywhere that is neither the keypad nor a field closes it.
  const isKept = (target) => Boolean(keepOpenOn && target.closest?.(keepOpenOn));
  const onOutside = (event) => {
    if (!active) return;
    if (el.contains(event.target) || event.target.closest?.('[data-field]') || isKept(event.target)) return;
    hide();
  };
  document.addEventListener('pointerdown', onOutside, true);
  // Keep the field focused while the companion UI is tapped (a mousedown on a
  // button would otherwise move the focus to it).
  const onMouseDown = (event) => {
    if (active && isKept(event.target)) event.preventDefault();
  };
  document.addEventListener('mousedown', onMouseDown, true);

  return {
    hide,
    /** Fire `change` for the field being edited if a key changed it. */
    commit,
    focusField(input) {
      if (!input) {
        hide();
        return;
      }
      input.focus({ preventScroll: true });
      // focusin already opened the keypad; make sure it is in sync if this
      // field was already the focused one.
      if (active !== input) show(input);
    },
    destroy() {
      scope.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      hide();
      el.remove();
    },
  };
}

/**
 * Keypad wired for a list of set rows. Both set editors (the live workout and
 * the finished-workout editor) share the same row markup: `[data-set-id]` rows
 * with `[data-field="weightKg"]`, `[data-field="reps"]` and a `[data-toggle]`
 * check button.
 *
 * Action key on Kg: go to Reps of the same set. On Reps: complete the set (via
 * its own check button, so each screen keeps its own completion logic) and go
 * to Kg of the next set in DOM order, i.e. the next set of the exercise or the
 * first set of the next exercise. After the very last set the keypad closes.
 *
 * @param {object} options
 * @param {HTMLElement} options.scope  Element holding every set row.
 */
export function createSetKeypad({ scope }) {
  const keypad = createKeypad({
    scope,
    // The rest timer docks above the keypad and must stay tappable.
    keepOpenOn: '.rest-timer',
    onAction(input) {
      const row = input.closest('[data-set-id]');
      if (!row) {
        keypad.hide();
        return;
      }
      if (input.dataset.field === 'weightKg') {
        keypad.focusField(row.querySelector('[data-field="reps"]'));
        return;
      }
      // Persist the typed reps before completing, so the completion request
      // carries them (screens that save on `change` would otherwise send the
      // old value).
      keypad.commit();
      const toggle = row.querySelector('[data-toggle]');
      // Never un-complete a finished set from the keypad.
      if (toggle && !toggle.classList.contains('checked')) toggle.click();
      const weights = [...scope.querySelectorAll('[data-field="weightKg"]')];
      const next = weights[weights.indexOf(row.querySelector('[data-field="weightKg"]')) + 1];
      keypad.focusField(next ?? null);
    },
  });
  return keypad;
}
