/**
 * Adapter registry. Spectrum-specific behaviour lives ONLY in adapters (one file per tag or family in this
 * folder); the generic renderer looks adapters up by tag. The last registered adapter matching a tag wins, so
 * applications can override the built-in ones with `registerAdapter()`.
 */
import type {ElementAdapter} from '../types.js';

const adapters: ElementAdapter[] = [];
const cache = new Map<string, ElementAdapter | null>();

export function registerAdapter(adapter: ElementAdapter): void {
  adapters.push(adapter);
  cache.clear();
}

export function findAdapter(tag: string): ElementAdapter | undefined {
  const cached = cache.get(tag);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  let found: ElementAdapter | undefined;
  for (let i = adapters.length - 1; i >= 0 && !found; i--) {
    const {tag: matcher} = adapters[i];
    if (typeof matcher === 'string') {
      if (matcher === tag) found = adapters[i];
    } else {
      matcher.lastIndex = 0;
      if (matcher.test(tag)) found = adapters[i];
    }
  }
  cache.set(tag, found ?? null);
  return found;
}
