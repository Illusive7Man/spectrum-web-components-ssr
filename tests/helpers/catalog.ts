// Plain TS import of the demo catalog. Catalog entries do not import Spectrum at module level
// (they only do so inside `load()`), so this is safe to evaluate in the Playwright runner process.
import * as catalogModule from '../../demo/src/catalog/index.ts';

export interface TestEntry {
  /** kebab-case package name, used in URLs (`/component/:name`) and `section[data-component]`. */
  name: string;
  /** Whether the interaction smoke test applies. */
  interactive: boolean;
  /** Known SSR caveats from the catalog (shown in the summary's Notes column). */
  notes?: string;
}

/** Used only when the catalog module does not export a `smokeSet`. */
const FALLBACK_SMOKE_SET = [
  'theme',
  'button',
  'action-button',
  'checkbox',
  'switch',
  'radio',
  'textfield',
  'picker',
  'menu',
  'tabs',
  'accordion',
  'progress-circle',
  'icon',
];

interface CatalogLike {
  name: string;
  interactive?: boolean;
  notes?: string;
}

const exported = catalogModule as unknown as {catalog?: CatalogLike[]; smokeSet?: Iterable<string>};

export const allEntries: TestEntry[] = (exported.catalog ?? []).map((e) => ({
  name: e.name,
  interactive: e.interactive === true,
  ...(e.notes ? {notes: e.notes} : {}),
}));

const allNames = allEntries.map((e) => e.name);

export const smokeNames: string[] = (() => {
  const fromCatalog = exported.smokeSet ? Array.from(exported.smokeSet) : FALLBACK_SMOKE_SET;
  return fromCatalog.filter((n) => allNames.includes(n));
})();

function listFromEnv(name: string): string[] | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveSelection(): TestEntry[] {
  if (allEntries.length === 0) {
    throw new Error(
      "The demo catalog is empty or '../../demo/src/catalog/index.ts' does not export `catalog`: nothing to test.",
    );
  }
  let selected = allEntries;

  const requested = listFromEnv('SWC_SSR_COMPONENTS');
  if (requested) {
    const unknown = requested.filter((n) => !allNames.includes(n));
    if (unknown.length > 0) {
      throw new Error(
        `SWC_SSR_COMPONENTS names unknown catalog entries: ${unknown.join(', ')}. ` +
          `Known: ${allNames.slice(0, 15).join(', ')}${allNames.length > 15 ? ', ...' : ''}`,
      );
    }
    selected = selected.filter((e) => requested.includes(e.name));
  }

  const smoke = process.env.SWC_SSR_SMOKE;
  if (smoke !== undefined && smoke !== '' && smoke !== '0' && smoke.toLowerCase() !== 'false') {
    selected = selected.filter((e) => smokeNames.includes(e.name));
  }

  if (selected.length === 0) {
    throw new Error('The SWC_SSR_COMPONENTS / SWC_SSR_SMOKE filters selected no catalog entries.');
  }
  return selected;
}

/** Catalog entries to test, after applying SWC_SSR_COMPONENTS and SWC_SSR_SMOKE. */
export const selectedEntries: TestEntry[] = resolveSelection();

/** Convenience: `catalog.map(e => e.name)` for the selected entries. */
export const componentNames: string[] = selectedEntries.map((e) => e.name);
