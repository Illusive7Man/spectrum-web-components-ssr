// Verification scratch: where are the sp-color-area handles after hydration on the catalog page, per load, mode and server variant?
//   VARIANT=new|baseline MODES=full,minified RUNS=4 npx tsx tests/results/rerun-perf/handles.ts
const variant = process.env.VARIANT === 'baseline' ? 'baseline' : 'new';
process.env.PORT = '3109';
await import(variant === 'baseline' ? '../../../.probe/demo/baseline/server.ts' : '../../../demo/src/server.ts');
await new Promise((r) => setTimeout(r, 1500));
const {chromium} = await import('playwright');
const browser = await chromium.launch();
const modes = (process.env.MODES ?? 'full,minified').split(',');
const runs = Number(process.env.RUNS ?? 4);
const probe = () => {
  const section = document.querySelector('#app section.demo[data-component="color-area"]');
  if (!section) return 'no section';
  return [...section.querySelectorAll('sp-color-area')]
    .map((area) => {
      const handle = area.shadowRoot?.querySelector('sp-color-handle') as HTMLElement | null;
      if (!handle) return 'no-handle';
      const a = area.getBoundingClientRect();
      const h = handle.getBoundingClientRect();
      return `${Math.round(h.left - a.left)},${Math.round(h.top - a.top)}`;
    })
    .join(' ');
};
for (let i = 1; i <= runs; i++) {
  for (const mode of modes) {
    const ctx = await browser.newContext({viewport: {width: 1280, height: 800}, deviceScaleFactor: 1});
    const page = await ctx.newPage();
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto(`http://localhost:3109/${process.env.PATHNAME ?? ""}?styles=${mode}`, {timeout: 180000});
    await page.waitForFunction(() => (window as any).__swcSsrHydration !== undefined, undefined, {timeout: 120000});
    await page.evaluate(() => (window as any).__swcSsrHydration);
    const t0 = await page.evaluate(probe);
    await page.waitForTimeout(500);
    const t1 = await page.evaluate(probe);
    await page.waitForTimeout(3000);
    const t2 = await page.evaluate(probe);
    await page.waitForTimeout(8000);
    const t3 = await page.evaluate(probe);
    await page.waitForTimeout(15000);
    const t4 = await page.evaluate(probe);
    console.log(`${variant} run ${i} ${mode.padEnd(8)} at hydration: [${t0}] +0.5s: [${t1}] +3.5s: [${t2}] +11.5s: [${t3}] +26.5s: [${t4}]`);
    await ctx.close();
  }
}
await browser.close();
process.exit(0);
