// A tiny reverse proxy used by the service-worker update spec. Playwright
// cannot route a service worker's own main-script update request
// (https://github.com/microsoft/playwright/issues/14711), so the browser is
// pointed at this proxy instead: every request is forwarded to the real test
// server, except /sw.js once a replacement script has been staged.

import http from 'node:http';

/**
 * Starts the proxy on a random loopback port.
 *
 * @param {string} target absolute origin of the real test server.
 * @returns {Promise<{ origin: string, setWorkerScript(body: string): void, close(): Promise<void> }>}
 */
export async function startVersionedProxy(target) {
  const upstream = new URL(target);
  let workerScript = null;

  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/sw.js' && workerScript) {
      response.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(workerScript);
      return;
    }

    const forwarded = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: upstream.host },
      },
      (proxied) => {
        response.writeHead(proxied.statusCode || 502, proxied.headers);
        proxied.pipe(response);
      }
    );

    forwarded.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });

    request.pipe(forwarded);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    setWorkerScript(body) {
      workerScript = body;
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
