// Pull-to-refresh for document-scrolled views (the app scrolls the body, not
// an inner container). Attaches touch listeners at the window level and only
// engages when the user starts a downward drag while already at the very top
// (scrollY <= 0). Pulling past a threshold and releasing calls `onRefresh()`.
//
// Design notes:
//   - A fixed indicator lives on <body> (survives the view's innerHTML remount
//     that a refresh triggers). The module creates and removes it.
//   - touchmove is NON-passive so we can preventDefault() while pulling, which
//     stops the browser from scrolling/overscrolling under the indicator. We
//     only preventDefault once a pull is actually engaged, so normal vertical
//     scrolling is never blocked.
//   - Touch only. Mouse/desktop keeps the normal reload affordances.
//
// Returns a cleanup function that removes listeners and the indicator.
export function attachPullToRefresh({ onRefresh, threshold = 72, max = 120 } = {}) {
  if (typeof window === 'undefined' || !('ontouchstart' in window)) {
    return () => {};
  }

  const indicator = document.createElement('div');
  indicator.className = 'ptr-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.innerHTML = '<div class="ptr-spinner"></div>';
  document.body.appendChild(indicator);

  let startY = 0;
  let pulling = false;
  let refreshing = false;
  let distance = 0;

  const setPull = (d) => {
    distance = d;
    const clamped = Math.min(max, d);
    indicator.style.transform = `translateX(-50%) translateY(${clamped}px)`;
    indicator.style.opacity = String(Math.min(1, d / threshold));
    indicator.classList.toggle('ptr-ready', d >= threshold);
  };

  const reset = (animate) => {
    indicator.style.transition = animate ? 'transform 0.2s ease, opacity 0.2s ease' : 'none';
    indicator.style.transform = 'translateX(-50%) translateY(0)';
    indicator.style.opacity = '0';
    indicator.classList.remove('ptr-ready', 'ptr-spinning');
    pulling = false;
    distance = 0;
  };

  const onTouchStart = (event) => {
    if (refreshing || event.touches.length !== 1) return;
    // Only arm at the very top of the page.
    if (window.scrollY > 0) return;
    startY = event.touches[0].clientY;
    pulling = true;
    indicator.style.transition = 'none';
  };

  const onTouchMove = (event) => {
    if (!pulling || refreshing) return;
    const dy = event.touches[0].clientY - startY;
    if (dy <= 0) {
      // Upward (or no) movement: yield to normal scrolling.
      if (distance > 0) reset(false);
      pulling = window.scrollY <= 0; // stay armed only while still at top
      return;
    }
    // Downward drag from the top: engage. Dampen with a simple rubber-band.
    event.preventDefault();
    setPull(dy * 0.5);
  };

  const onTouchEnd = async () => {
    if (!pulling || refreshing) {
      if (!refreshing) reset(true);
      return;
    }
    const trigger = distance >= threshold;
    if (!trigger) {
      reset(true);
      return;
    }
    // Trigger refresh: lock the indicator at the threshold and spin.
    refreshing = true;
    pulling = false;
    indicator.style.transition = 'transform 0.2s ease';
    indicator.style.transform = `translateX(-50%) translateY(${threshold}px)`;
    indicator.style.opacity = '1';
    indicator.classList.add('ptr-spinning');
    indicator.classList.remove('ptr-ready');
    try {
      await onRefresh();
    } catch {
      // ignore; the view handles its own error state
    } finally {
      // The view usually remounts (destroying its DOM) but the indicator lives
      // on <body>, so hide it either way.
      refreshing = false;
      reset(true);
    }
  };

  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return () => {
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
    indicator.remove();
  };
}
