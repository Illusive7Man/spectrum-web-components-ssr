process.env.PORT = '3009';
await import('../../../demo/src/server.ts');
await new Promise((r) => setTimeout(r, 1500));
const {chromium} = await import('playwright');
const browser = await chromium.launch();
const X = Number(process.env.X ?? 378), Y = Number(process.env.Y ?? 692);
for (const mode of ['full', 'minified']) {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f;');
  await page.goto(`http://localhost:3009/component/slider?styles=${mode}`, {waitUntil: 'networkidle'});
  await page.evaluate(async () => { await (window as any).__swcSsrHydration; });
  await page.waitForTimeout(500);
  const info = await page.evaluate(([x, y]) => {
    let el: Element | null = document.elementFromPoint(x, y);
    const chain: string[] = [];
    while (el) { chain.push(el.localName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '')); const sr = (el as Element).shadowRoot; const inner = sr?.elementFromPoint(x, y); if (inner && inner !== el) { el = inner; } else break; }
    const leaf = el as HTMLElement | null;
    const cs = leaf ? getComputedStyle(leaf) : null;
    return {chain, inline: leaf?.getAttribute('style'), bg: cs?.backgroundColor, bgImage: cs?.backgroundImage.slice(0, 200), color: cs?.color, opacity: cs?.opacity, filter: cs?.filter, boxShadow: cs?.boxShadow?.slice(0, 160), rect: leaf && JSON.stringify(leaf.getBoundingClientRect())};
  }, [X, Y]);
  console.log(mode, JSON.stringify(info));
  await ctx.close();
}
await browser.close(); process.exit(0);
