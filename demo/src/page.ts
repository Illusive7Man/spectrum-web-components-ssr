import {html, type TemplateResult} from 'lit';
import type {CatalogEntry} from './catalog/types.js';

/**
 * The page content shared by the server (SSR), the client (hydration) and the CSR reference route.
 * Server and client MUST build the same template from the same entries, otherwise hydration breaks.
 *
 *   <sp-theme system="spectrum" color="light" scale="medium">
 *     <section class="demo" data-component="NAME"><h2>NAME</h2> ...entry.render()... </section>
 *     ...
 *   </sp-theme>
 */
export function pageTemplate(entries: CatalogEntry[]): TemplateResult {
  return html`<sp-theme system="spectrum" color="light" scale="medium">${entries.map(
    (entry) =>
      html`<section class="demo" data-component=${entry.name}><h2>${entry.name}</h2>${entry.render()}</section>`,
  )}</sp-theme>`;
}

/**
 * Layout-only CSS for the page shell (inlined into a <style> by the server). Deliberately small: no fonts, no
 * colours beyond neutral borders; everything visual comes from the Spectrum theme.
 * The same CSS is used for the SSR routes and the CSR reference routes so both lay out identically.
 */
export const layoutCss = `
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; }
#app { min-height: 100vh; }
#app > sp-theme {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  align-items: start;
}
section.demo {
  box-sizing: border-box;
  min-width: 0;
  padding: 16px 20px 24px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  margin: -1px 0 0 -1px;
  overflow-x: auto;
}
section.demo > h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.02em;
}
`;
