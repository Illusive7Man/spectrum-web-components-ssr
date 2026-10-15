// Verification probe (not part of the project): the user's report was "server output was fine, hydration ignored all
// styling". This loads pages the way a visitor does (client.js is NOT aborted: it loads and hydrates on its own),
// in full / trimmed / minified mode, and compares the hydrated page with the hydrated full page, pixel for pixel.
// It also compares the pure-SSR paint (JS disabled) with the hydrated paint, and checks computed styles of the theme.
// Starts the demo in-process on port 3007 (exits via process.exit).
process.env.PORT = '3007';
await import('../../../demo/src/server.ts');
await new Promise((r) => setTimeout(r, 1500));
const {chromium} = await import('playwright');
const pixelmatch = (await import('pixelmatch')).default;
const {PNG} = await import('pngjs');
const browser = await chromium.launch();
const names = (process.env.NAMES ?? 'button,picker,tabs,dialog,textfield,checkbox,slider,menu,card,table,accordion,action-menu,swatch,toast,tooltip').split(',');
const MODES = ['full', 'trimmed', 'minified'] as const;
const diff = (a: any, b: any) => (a.width !== b.width || a.height !== b.height ? -1 : pixelmatch(a.data, b.data, null, a.width, a.height, {threshold: 0}));

async function capture(name: string, mode: string, js: boolean) {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 900}, javaScriptEnabled: js});
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f;');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  const res = await page.goto(`http://localhost:3007/component/${name}?styles=${mode}`, {waitUntil: 'networkidle'});
  if (js) {
    await page.waitForFunction(() => (window as any).__swcSsrHydration, null, {timeout: 30000}).catch(() => {});
    await page.evaluate(async () => { (window as any).__swcSsrHydrationResult = await (window as any).__swcSsrHydration; });
  }
  await page.waitForTimeout(800);
  const height = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 2400));
  const png = PNG.sync.read(await page.screenshot({clip: {x: 0, y: 0, width: 1280, height}, animations: "disabled", caret: "hide"}));
  const info = js
    ? await page.evaluate(() => {
        const hy: any = (window as any).__swcSsrHydrationResult;
        let marked = 0, styleEls = 0, adopted = 0, lit = 0;
        const walk = (root: ParentNode) => {
          for (const el of Array.from(root.querySelectorAll('*'))) {
            const sr = (el as Element).shadowRoot;
            if (!sr) continue;
            marked += sr.querySelectorAll('style[data-swc-styles]').length;
            styleEls += sr.querySelectorAll('style').length;
            adopted += sr.adoptedStyleSheets.length;
            if ((el as Element).localName.startsWith('sp-')) lit++;
            walk(sr);
          }
        };
        walk(document);
        const theme = document.querySelector('sp-theme');
        return {
          hydration: hy && {errors: hy.errors?.length, deferred: hy.deferred?.length, count: hy.hydratedCount},
          marked, styleEls, adopted, spElements: lit,
          themeAdopted: theme?.shadowRoot?.adoptedStyleSheets.length ?? -1,
          themeVar: theme ? getComputedStyle(theme).getPropertyValue('--spectrum-gray-800').trim() : null,
          bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 24),
        };
      })
    : null;
  await ctx.close();
  return {png, errors, info, status: res?.status()};
}

let bad = 0;
for (const name of names) {
  const rows: Record<string, any> = {};
  for (const mode of MODES) rows[mode] = await capture(name, mode, true);
  const nojs = await capture(name, 'full', false);
  const nojsTrimmed = await capture(name, 'trimmed', false);
  const nojsMin = await capture(name, 'minified', false);
  const out: string[] = [];
  for (const mode of MODES) {
    let r = rows[mode];
    let vsFull = diff(rows.full.png, r.png);
    // Like the e2e suite (matchesAnywhere): a differing capture is repeated (2 more page loads of this mode).
    // Raster noise (a single anti-aliased pixel) differs between page loads of the SAME css: fail only when no capture of
    // this mode equals any capture of the full-CSS page.
    if (vsFull !== 0 && mode !== 'full') {
      const fulls = [rows.full], modes = [r];
      for (let attempt = 0; attempt < 2; attempt++) { fulls.push(await capture(name, 'full', true)); modes.push(await capture(name, mode, true)); }
      let best = vsFull, bestR = r;
      for (const f of fulls) for (const m of modes) { const d = diff(f.png, m.png); if (d < best) { best = d; bestR = m; } }
      const selfNoise = diff(fulls[0].png, fulls[1].png);
      vsFull = best; r = bestR;
      out.push('     (retried: best pair ' + best + ' px; full-vs-full recapture noise ' + selfNoise + ' px)');
    }
    const pre = diff({full: nojs, trimmed: nojsTrimmed, minified: nojsMin}[mode].png, r.png);
    const ok = vsFull === 0 && r.info?.hydration?.errors === 0 && r.info?.hydration?.deferred === 0 && r.errors.length === 0 && (mode === 'full' || r.info.marked === 0);
    if (!ok) bad++;
    out.push(`  ${mode.padEnd(8)} ${ok ? 'OK ' : 'BAD'} vs-full-hydrated ${vsFull}px, ssr-vs-hydrated ${pre}px, errors ${r.errors.length}${r.errors.length ? ' [' + r.errors.slice(0, 2).join(' | ') + ']' : ''}, ${JSON.stringify(r.info)}`);
  }
  console.log(`== ${name} (page ${rows.full.png.width}x${rows.full.png.height}); no-JS trimmed vs no-JS full ${diff(nojs.png, nojsTrimmed.png)}px, minified ${diff(nojs.png, nojsMin.png)}px`);
  console.log(out.join('\n'));
}
console.log(bad === 0 ? '\nALL OK' : `\n${bad} BAD rows`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
