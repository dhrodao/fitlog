// Swipe-to-delete for a row element, iOS/Hevy style. Wires horizontal drag on
// `handle` (the visible content) which slides over a revealed delete action.
//
// Behaviour:
//   - Only horizontal drags start a swipe; vertical intent is yielded to the
//     page scroll (the row uses touch-action: pan-y so the browser still
//     scrolls vertically).
//   - Dragging left past OPEN_AT snaps the row open, revealing "Eliminar".
//   - Dragging left past COMMIT_AT (or tapping the revealed button) deletes.
//   - A drag that does not pass OPEN_AT springs back closed.
//   - Dragging/taping elsewhere, or a new swipe on another row, closes it.
//
// `onDelete()` is called when the user commits; it should perform the async
// removal. If it rejects, the row springs back. `getActionWidth` returns the
// width (px) of the revealed action so the open position matches the button.
export function attachSwipeToDelete(handle, { onDelete, actionWidth = 76 } = {}) {
  const OPEN_AT = actionWidth * 0.5; // past this → snap open
  const COMMIT_AT = actionWidth * 1.6; // past this → delete outright
  const DIR_LOCK = 8; // px before we decide horizontal vs vertical

  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let locked = null; // 'x' | 'y' | null
  let open = false;
  let pointerId = null;
  let committing = false; // true while an async delete is in flight

  const setX = (x, animate) => {
    const offset = Math.min(0, x);
    handle.style.transition = animate ? 'transform 0.18s ease' : 'none';
    handle.style.transform = `translateX(${offset}px)`;
    // Reveal the red delete background only while the row is pulled aside.
    // When closing (animating back to 0) keep it visible until the transition
    // settles (handled in close()), so the row slides back over it instead of
    // the red vanishing instantly.
    if (offset < -0.5) {
      handle.parentElement?.classList.add('swiping');
    } else if (!animate) {
      handle.parentElement?.classList.remove('swiping');
    }
  };

  // Release any active pointer capture and clear per-gesture state so the next
  // gesture (possibly on a freshly rendered row) starts clean.
  const endGesture = () => {
    if (pointerId != null) {
      try {
        handle.releasePointerCapture?.(pointerId);
      } catch {}
    }
    pointerId = null;
    dragging = false;
    locked = null;
    dx = 0;
  };

  const close = () => {
    open = false;
    setX(0, true);
    // Hide the background once the slide-back animation has finished.
    window.setTimeout(() => {
      if (handle.style.transform === 'translateX(0px)') {
        handle.parentElement?.classList.remove('swiping');
      }
    }, 200);
  };
  const openRow = () => {
    open = true;
    setX(-actionWidth, true);
  };

  const onDown = (event) => {
    if (committing) return; // row is being removed; ignore new gestures
    // Ignore drags that begin on interactive controls (inputs, buttons).
    if (event.target.closest('input, button, select, textarea, a')) {
      if (open) close();
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    dragging = true;
    locked = null;
  };

  const onMove = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    const mx = event.clientX - startX;
    const my = event.clientY - startY;

    if (!locked) {
      if (Math.abs(mx) < DIR_LOCK && Math.abs(my) < DIR_LOCK) return;
      locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (locked === 'y') {
        dragging = false; // let the page scroll
        return;
      }
      try {
        handle.setPointerCapture?.(pointerId);
      } catch {}
    }
    if (locked !== 'x') return;

    // Base offset from the open state so an open row drags smoothly.
    const base = open ? -actionWidth : 0;
    dx = base + mx;
    // Allow a small rubber-band past the action width, clamp right at 0.
    const clamped = Math.max(-actionWidth * 1.9, Math.min(0, dx));
    setX(clamped, false);
  };

  const onUp = (event) => {
    if (event && event.pointerId != null && pointerId != null && event.pointerId !== pointerId) {
      return;
    }
    const wasHorizontal = locked === 'x';
    const settledDx = dx;
    endGesture();
    if (!wasHorizontal) return; // vertical scroll or a plain tap; nothing to settle

    if (-settledDx >= COMMIT_AT) {
      commitDelete();
    } else if (-settledDx >= OPEN_AT) {
      openRow();
    } else {
      close();
    }
  };

  async function commitDelete() {
    if (committing) return;
    committing = true;
    setX(-(handle.offsetWidth || 400), true);
    try {
      await onDelete();
      // Caller re-renders the list; this controller is discarded afterwards.
    } catch {
      close(); // spring back on failure
    } finally {
      committing = false;
    }
  }

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);

  // Expose a close() so the list can collapse other rows.
  return { close, isOpen: () => open, _test: { onDown, onMove, onUp } };
}
