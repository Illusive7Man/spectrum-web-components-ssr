// Verification probe: where is the 1px slider(minified) difference, and do ALL computed styles of the hydrated page match full?
process.env.PORT = '3008';
await import('../../../demo/src/server.ts');
await new Promise((r) => setTimeout(r, 1500));
const {chromium} = await import('playwright');
const pixelmatch = (await import('pixelmatch')).default;
const {PNG} = await import('pngjs');
const browser = await chromium.launch();
const name = process.env.NAME ?? 'slider';
async function grab(mode: string) {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f;');
  await page.goto(`http://localhost:3008/component/${name}?styles=${mode}`, {waitUntil: 'networkidle'});
  await page.evaluate(async () => { await (window as any).__swcSsrHydration; });
  await page.waitForTimeout(800);
  const png = PNG.sync.read(await page.screenshot({clip: {x: 0, y: 0, width: 1280, height: 900}, animations: 'disabled', caret: 'hide'}));
  const sig = await page.evaluate(() => {
    const out: Record<string, string> = {};
    let n = 0;
    const path = (el: Element) => { const p: string[] = []; for (let e: Element | null = el; e; ) { const par: ParentNode | null = e.parentNode; const idx = par ? Array.from((par as ParentNode).children ?? []).filter((c) => c.localName !== 'style').indexOf(e) : 0; p.unshift(e.localName + ':' + idx); e = e.parentElement ?? ((par as ShadowRoot)?.host ?? null); } return p.join('>'); };
    const walk = (root: ParentNode) => {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (['style', 'script'].includes(el.localName)) continue;
        const cs = getComputedStyle(el);
        const props: string[] = [];
        for (let i = 0; i < cs.length; i++) {
          const k = cs[i];
          if (k.startsWith('--')) continue; // custom properties are renamed in minified mode on purpose
          props.push(k + ':' + cs.getPropertyValue(k));
        }
        out[path(el)] = props.join(';');
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return out;
  });
  const rect = await page.evaluate(() => { const s = document.querySelector('sp-slider') as HTMLElement | null; const r = s?.getBoundingClientRect(); return r ? {x: r.x, y: r.y, w: r.width, h: r.height} : null; });
  await ctx.close();
  return {png, sig, rect};
}
const full = await grab('full');
const min = await grab('minified');
const tr = await grab('trimmed');
for (const [label, other] of [['trimmed', tr], ['minified', min]] as const) {
  const a = full.png, b = other.png;
  const out = new PNG({width: a.width, height: a.height});
  const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, {threshold: 0});
  const pts: string[] = [];
  for (let y = 0; y < a.height && pts.length < 10; y++) for (let x = 0; x < a.width && pts.length < 10; x++) { const i = (y * a.width + x) * 4; if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) pts.push(`(${x},${y}) full=${a.data.slice(i, i + 4).join(',')} ${label}=${b.data.slice(i, i + 4).join(',')}`); }
  console.log(`${label} vs full pixels: ${n} ${pts.join(' | ')}`);
  const keys = new Set([...Object.keys(full.sig), ...Object.keys(other.sig)]);
  let differing = 0; const examples: string[] = [];
  for (const k of keys) {
    if (full.sig[k] === other.sig[k]) continue;
    differing++;
    if (examples.length < 12) {
      const fa = (full.sig[k] ?? '').split(';'), fb = (other.sig[k] ?? '').split(';');
      const d = fa.map((x, i) => (x !== fb[i] ? x + ' -> ' + fb[i] : '')).filter(Boolean).slice(0, 5);
      examples.push(`${k}: ${d.join(' | ')}`);
    }
  }
  console.log(`${label}: ${keys.size} elements, ${differing} with a differing computed style (non-custom props)`);
  for (const e of examples) console.log('   ' + e.slice(0, 300));
}
console.log('slider rect', JSON.stringify(full.rect), JSON.stringify(min.rect));
await browser.close();
process.exit(0);
