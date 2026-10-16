/**
 * The demo page shell wraps every entry in `<sp-theme system="spectrum" color="light" scale="medium">`
 * (demo/src/page.ts). `/component/:name` and the client only call `entry.load()` for the entries on the
 * page, so the theme element and the fragments it needs must be registered by those loads as well.
 *
 * index.ts prepends this to every entry's load(). Like the entries, this module has no top-level
 * Spectrum import: registration happens only when the function is called. Re-importing is a no-op
 * (ES module cache), so it is safe to call many times.
 */
export async function loadPageTheme(): Promise<void> {
  // One module that imports the fragments before <sp-theme>: the evaluation order is fixed (see page-theme-register.ts).
  await import('./page-theme-register.ts');
}
