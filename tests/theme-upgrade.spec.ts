/**
 * `<sp-theme>`'s upgrade must not restart the CSS animations of the page (client/theme-upgrade.ts).
 *
 * Spectrum's Theme constructor calls `attachShadow()`, which empties a declarative shadow root and so unslots the whole
 * page for a moment; the client keeps the root instead. Checked on the pages with running animations (an indeterminate
 * progress circle and bar, the coach indicator's rings): with `?late=sp-theme` the page is loaded with every definition
 * but the theme's, the animations are recorded (target node, start time), then `sp-theme` is defined and the page
 * hydrates. Afterwards every animation runs on the same node with the same start time, the theme's shadow root holds
 * exactly one `<slot>` (the server's; the constructor's duplicate was dropped) and, on a `full` page, no server
 * `<style>` any more (the theme adopted its sheets).
 */
import {expect, test} from '@playwright/test';

interface Snapshot {
  id: string;
  host: string;
  name: string;
  startTime: number | null;
}

const snapshot = `(() => {
  const found = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      for (const a of el.getAnimations()) found.push(a);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return found.map((a) => {
    const target = a.effect?.target;
    if (!target) return null;
    if (!target.__swcAnimationId) target.__swcAnimationId = Math.random().toString(36).slice(2, 10);
    const root = target.getRootNode();
    return {
      id: target.__swcAnimationId,
      host: root instanceof ShadowRoot ? root.host.localName : '(document)',
      name: a.animationName ?? '?',
      startTime: a.startTime === null ? null : Math.round(a.startTime),
    };
  }).filter(Boolean);
})()`;

for (const [entry, minimum] of [
  ['progress-circle', 3],
  ['progress-bar', 1],
  ['coachmark', 9],
] as const) {
  for (const variant of ['', '&styles=trimmed&dedupe=link']) {
    test(`${entry}${variant}: animations survive the sp-theme upgrade`, async ({page}) => {
      await page.goto(`/component/${entry}?late=sp-theme${variant}`);
      await page.waitForFunction(() => (window as unknown as {__swcSsrDefined?: boolean}).__swcSsrDefined === true);
      // Animations have a start time once the page painted.
      await page.waitForFunction(
        () => document.querySelector('sp-theme')?.shadowRoot?.querySelector('slot') !== null && performance.now() > 300,
      );
      const before = (await page.evaluate(snapshot)) as Snapshot[];
      expect(before.length, 'the page has running animations before the theme upgrades').toBeGreaterThanOrEqual(minimum);
      expect(before.every((a) => a.startTime !== null)).toBe(true);

      await page.evaluate(() => (window as unknown as {__swcSsrDefineLate: () => Promise<number>}).__swcSsrDefineLate());
      const report = await page.evaluate(() => (window as unknown as {__swcSsrHydration: Promise<{errors: string[]}>}).__swcSsrHydration);
      expect(report.errors).toEqual([]);
      await page.waitForTimeout(300);

      const after = (await page.evaluate(snapshot)) as Snapshot[];
      const byId = new Map(before.map((a) => [a.id, a]));
      const restarted = after.filter((a) => byId.get(a.id)?.startTime !== a.startTime).map((a) => `${a.host} ${a.name}`);
      expect(restarted, 'animations that restarted (new node or new start time)').toEqual([]);
      expect(after.length).toBe(before.length);

      const theme = await page.evaluate(() => {
        const root = document.querySelector('sp-theme')!.shadowRoot!;
        return {
          children: Array.from(root.children).map((child) => child.localName + (child.getAttribute('data-swc-styles') ? `[${child.getAttribute('data-swc-styles')}]` : '')),
          adopted: root.adoptedStyleSheets.length,
        };
      });
      expect(theme.adopted, 'the upgraded theme adopted its sheets').toBeGreaterThan(0);
      expect(theme.children.filter((name) => name === 'slot')).toHaveLength(1);
      if (variant === '') expect(theme.children, 'full mode: the server theme CSS is released after adoption').toEqual(['slot']);
    });
  }
}
