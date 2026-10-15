import {expect, test} from '@playwright/test';

/**
 * Demo server behaviour that is not about rendering (demo/src/server.ts, docs/API.md "Demo server routes"):
 *  - HEAD on an SSR route is a health check: 200, empty body, no render;
 *  - HEAD on a bundle file (`/dist/*`) is answered by the static file handler, with the file's Content-Type (review
 *    finding: it used to get the empty health-check answer without one).
 */
test.describe('demo server', () => {
  test('HEAD on a bundle file carries its Content-Type', async ({request}) => {
    const head = await request.head('/dist/client.js');
    expect(head.status()).toBe(200);
    expect(head.headers()['content-type']).toMatch(/javascript/);
    const get = await request.get('/dist/client.js');
    expect(head.headers()['content-type']).toBe(get.headers()['content-type']);
    expect(head.headers()['content-length']).toBe(get.headers()['content-length']);
  });

  test('HEAD on a missing bundle file is a 404', async ({request}) => {
    const head = await request.head('/dist/does-not-exist.js');
    expect(head.status()).toBe(404);
  });

  test('HEAD on an SSR route is a health check: 200 with an empty body', async ({request}) => {
    const head = await request.head('/component/button');
    expect(head.status()).toBe(200);
    expect((await head.body()).length).toBe(0);
    expect(head.headers()['cache-control']).toBe('no-store');
  });
});
