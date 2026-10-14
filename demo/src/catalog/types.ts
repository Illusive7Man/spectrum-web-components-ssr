import type {TemplateResult} from 'lit';

/** One showcase per Spectrum Web Components (1st-gen) package. See docs/API.md. */
export interface CatalogEntry {
  /** kebab-case package name, e.g. 'action-button'; used in URLs and `data-component`. */
  name: string;
  /** `@spectrum-web-components/*` package names this entry needs. */
  packages: string[];
  /** Dynamic bare-specifier imports of the registration modules (`sp-*.js`) and any icons used. */
  load(): Promise<void>;
  /** The showcase template: several variants with realistic slotted content. */
  render(): TemplateResult;
  /** Known SSR caveats. */
  notes?: string;
  /** True if the e2e interaction smoke test should click the first focusable control. */
  interactive?: boolean;
}
