/**
 * Touch input helpers for the mobile project. Playwright's touchscreen API can
 * only tap, so drags go through the Chromium DevTools Protocol, which is what
 * a real finger emits: touch events plus the pointer events the app listens
 * for (swipe-to-delete and pull-to-refresh).
 */

/**
 * Drags from one point to another with a single finger.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {{steps?: number}} [options]
 */
export async function touchDrag(page, from, to, { steps = 12 } = {}) {
  const session = await page.context().newCDPSession(page);
  const point = (x, y) => ({
    x,
    y,
    radiusX: 1,
    radiusY: 1,
    force: 1,
    id: 0,
  });

  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(from.x, from.y)],
    });
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          point(
            from.x + (to.x - from.x) * ratio,
            from.y + (to.y - from.y) * ratio
          ),
        ],
      });
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

/**
 * Drags a locator by a pixel offset, starting at a fraction of its box.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {{dx: number, dy?: number, start?: {x: number, y: number}}} options
 */
export async function dragLocator(page, locator, { dx, dy = 0, start = { x: 0.5, y: 0.5 } }) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('cannot drag an element without a bounding box');

  const from = {
    x: box.x + box.width * start.x,
    y: box.y + box.height * start.y,
  };
  await touchDrag(page, from, { x: from.x + dx, y: from.y + dy });
}
