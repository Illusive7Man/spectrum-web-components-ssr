/**
 * A small, slice-preserving structural parser for stylesheet text (`StyleOptions.mode: 'trimmed'`).
 *
 * The trimmer only needs the structure of a stylesheet - style rules (selector text + block), conditional group
 * at-rules (`@media`, `@supports`, `@container`, `@layer` blocks, `@starting-style`) with their nested rules,
 * `@keyframes`, and everything else as opaque statements - plus the declarations of a block. Every node keeps the
 * offsets of its source text, so kept rules are emitted verbatim (byte-for-byte slices of the original text), and
 * only blocks that are actually rewritten (theme pruning, `undefinedPrefixes`) are re-joined.
 *
 * It is not a validating parser: it follows CSS Syntax's block / string / comment / `url()` tokenization closely
 * enough to find the boundaries, and anything it does not understand is kept as is. Native CSS nesting (the theme's
 * `:host{...;&:lang(ar){...}}`) is handled: a nested rule is an opaque item of its parent's block.
 */

/* Character codes. */
const BACKSLASH = 92;
const SLASH = 47;
const STAR = 42;
const QUOTE = 34;
const APOSTROPHE = 39;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const SEMICOLON = 59;
const COLON = 58;
const AT = 64;

export interface StyleRuleNode {
  kind: 'style';
  /** Start of the prelude (selector text, leading whitespace skipped). */
  start: number;
  /** Index after the closing `}`. */
  end: number;
  /** The selector text (trimmed). */
  prelude: string;
  /** Index after the opening `{`. */
  bodyStart: number;
  /** Index of the closing `}` (or the end of the text when unterminated). */
  bodyEnd: number;
}

export interface GroupNode {
  kind: 'group';
  /** Lowercased at-rule name without `@` (`media`, `supports`, `container`, `layer`, `starting-style`). */
  name: string;
  start: number;
  end: number;
  /** Index after the opening `{`. */
  bodyStart: number;
  bodyEnd: number;
  children: CssNode[];
}

export interface KeyframesNode {
  kind: 'keyframes';
  /** The keyframes name (unquoted). */
  name: string;
  start: number;
  end: number;
}

/** Statements (`@import ...;`, `@layer a, b;`) and blocks that are always kept whole (`@font-face`, unknown). */
export interface OtherNode {
  kind: 'other';
  name: string;
  start: number;
  end: number;
}

export type CssNode = StyleRuleNode | GroupNode | KeyframesNode | OtherNode;

/** At-rules whose block contains rules that are filtered recursively. */
const GROUP_RULES = new Set(['media', 'supports', 'container', 'layer', 'starting-style']);

function isNameCode(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    (code >= 48 && code <= 57) || // 0-9
    code === 45 || // -
    code === 95 || // _
    code >= 0x80
  );
}

/** Index after the comment starting at `i` (`/*`). */
function skipComment(text: string, i: number): number {
  const end = text.indexOf('*/', i + 2);
  return end === -1 ? text.length : end + 2;
}

/** Index after the string starting at `i` (a quote). Unterminated strings end at a newline or the end. */
function skipString(text: string, i: number): number {
  const quote = text.charCodeAt(i);
  let j = i + 1;
  while (j < text.length) {
    const code = text.charCodeAt(j);
    if (code === BACKSLASH) {
      j += 2;
      continue;
    }
    if (code === quote) {
      return j + 1;
    }
    if (code === 10) {
      return j;
    }
    j++;
  }
  return text.length;
}

/**
 * At `i` an unquoted `url(` starts (i points at the `(`): index after its `)`. Quoted urls are ordinary function
 * tokens (strings inside are skipped by the caller).
 */
function skipUnquotedUrl(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && /\s/.test(text[j])) {
    j++;
  }
  const code = text.charCodeAt(j);
  if (code === QUOTE || code === APOSTROPHE) {
    return -1;
  }
  while (j < text.length) {
    const c = text.charCodeAt(j);
    if (c === BACKSLASH) {
      j += 2;
      continue;
    }
    if (c === CLOSE_PAREN) {
      return j + 1;
    }
    j++;
  }
  return text.length;
}

/** True if the `(` at `i` belongs to a `url(` function name. */
function isUrlOpen(text: string, i: number): boolean {
  if (i < 3) {
    return false;
  }
  const name = text.slice(i - 3, i).toLowerCase();
  return name === 'url' && (i === 3 || !isNameCode(text.charCodeAt(i - 4)));
}

/**
 * Scans from `i` until one of the stop characters is found at nesting depth 0 (parentheses, brackets and braces
 * opened inside count; strings, comments, escapes and unquoted urls are skipped). Returns the index of the stop
 * character, or `end` when none was found.
 */
function scanUntil(text: string, i: number, end: number, stops: (code: number) => boolean): number {
  let depth = 0;
  while (i < end) {
    const code = text.charCodeAt(i);
    if (code === BACKSLASH) {
      i += 2;
      continue;
    }
    if (code === SLASH && text.charCodeAt(i + 1) === STAR) {
      i = skipComment(text, i);
      continue;
    }
    if (code === QUOTE || code === APOSTROPHE) {
      i = skipString(text, i);
      continue;
    }
    if (depth === 0 && stops(code)) {
      return i;
    }
    if (code === OPEN_PAREN) {
      if (isUrlOpen(text, i)) {
        const after = skipUnquotedUrl(text, i);
        if (after !== -1) {
          i = after;
          continue;
        }
      }
      depth++;
    } else if (code === OPEN_BRACKET || code === OPEN_BRACE) {
      depth++;
    } else if (code === CLOSE_PAREN || code === CLOSE_BRACKET || code === CLOSE_BRACE) {
      if (depth === 0) {
        // An unbalanced closer at depth 0 (`}` ends the enclosing block): let the caller see it.
        if (stops(code)) {
          return i;
        }
        if (code === CLOSE_BRACE) {
          return i;
        }
      } else {
        depth--;
      }
    }
    i++;
  }
  return end;
}

/** Index of the `}` matching the `{` at `open` (or `end` when unterminated). */
export function blockEnd(text: string, open: number, end = text.length): number {
  return scanUntil(text, open + 1, end, (code) => code === CLOSE_BRACE);
}

function skipWhitespaceAndComments(text: string, i: number, end: number): number {
  while (i < end) {
    const code = text.charCodeAt(i);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12) {
      i++;
      continue;
    }
    if (code === SLASH && text.charCodeAt(i + 1) === STAR) {
      i = skipComment(text, i);
      continue;
    }
    // CDO / CDC tokens are ignored at the top level of a stylesheet.
    if (text.startsWith('<!--', i)) {
      i += 4;
      continue;
    }
    if (text.startsWith('-->', i)) {
      i += 3;
      continue;
    }
    break;
  }
  return i;
}

function unquote(name: string): string {
  const trimmed = name.trim();
  const first = trimmed.charCodeAt(0);
  if ((first === QUOTE || first === APOSTROPHE) && trimmed.charCodeAt(trimmed.length - 1) === first) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parses the rules of `text` between `start` and `end`. */
export function parseRules(text: string, start = 0, end = text.length): CssNode[] {
  const nodes: CssNode[] = [];
  let i = start;
  while (i < end) {
    i = skipWhitespaceAndComments(text, i, end);
    if (i >= end) {
      break;
    }
    const code = text.charCodeAt(i);
    if (code === CLOSE_BRACE || code === SEMICOLON) {
      // Stray token: the browser ignores it at this level.
      i++;
      continue;
    }
    if (code === AT) {
      let j = i + 1;
      while (j < end && isNameCode(text.charCodeAt(j))) {
        j++;
      }
      const name = text.slice(i + 1, j).toLowerCase();
      const stop = scanUntil(text, j, end, (c) => c === OPEN_BRACE || c === SEMICOLON);
      if (stop >= end || text.charCodeAt(stop) !== OPEN_BRACE) {
        // A statement (`@import ...;`, `@layer a, b;`) or an unterminated at-rule (a `}` ends the enclosing block).
        const after = stop >= end ? end : text.charCodeAt(stop) === SEMICOLON ? stop + 1 : stop;
        nodes.push({kind: 'other', name, start: i, end: after});
        i = after;
        continue;
      }
      const close = blockEnd(text, stop, end);
      const after = Math.min(end, close + 1);
      const bare = name.replace(/^-[a-z]+-/, '');
      if (bare === 'keyframes') {
        nodes.push({kind: 'keyframes', name: unquote(text.slice(j, stop)), start: i, end: after});
      } else if (GROUP_RULES.has(name)) {
        nodes.push({
          kind: 'group',
          name,
          start: i,
          end: after,
          bodyStart: stop + 1,
          bodyEnd: close,
          children: parseRules(text, stop + 1, close),
        });
      } else {
        nodes.push({kind: 'other', name, start: i, end: after});
      }
      i = after;
      continue;
    }
    const open = scanUntil(text, i, end, (c) => c === OPEN_BRACE);
    if (open >= end) {
      // Trailing garbage without a block: ignored by browsers.
      break;
    }
    if (text.charCodeAt(open) !== OPEN_BRACE) {
      // A prelude cut off by a stray `}`: dropped, as browsers do.
      i = open + 1;
      continue;
    }
    const close = blockEnd(text, open, end);
    const after = Math.min(end, close + 1);
    nodes.push({
      kind: 'style',
      start: i,
      end: after,
      prelude: text.slice(i, open).trim(),
      bodyStart: open + 1,
      bodyEnd: close,
    });
    i = after;
  }
  return nodes;
}

export interface DeclarationItem {
  kind: 'decl';
  /** Start of the declaration (property name). */
  start: number;
  /** End of the declaration (before its `;`, trailing whitespace excluded). */
  end: number;
  /** Property name as written (custom properties are case-sensitive). */
  name: string;
  /** Start of the value (after the colon). */
  valueStart: number;
}

export interface NestedItem {
  kind: 'nested';
  start: number;
  /** Index after the nested block's `}` (or after the at-rule statement's `;`). */
  end: number;
}

export type BlockItem = DeclarationItem | NestedItem;

/**
 * Splits a declaration block (`text[start, end)`, the content between `{` and `}`) into declarations and nested
 * rules (native CSS nesting, nested at-rules). Custom properties may hold `{}` blocks in their value; a `{` after
 * `--name:` therefore belongs to the value.
 */
export function splitBlock(text: string, start: number, end: number): BlockItem[] {
  const items: BlockItem[] = [];
  let i = start;
  while (i < end) {
    i = skipWhitespaceAndComments(text, i, end);
    if (i >= end) {
      break;
    }
    const code = text.charCodeAt(i);
    if (code === SEMICOLON) {
      i++;
      continue;
    }
    // A declaration starts with an identifier followed by `:`; anything else (`&`, `.`, `:`, `@`, ...) is nested.
    let j = i;
    while (j < end && isNameCode(text.charCodeAt(j))) {
      j++;
    }
    let k = j;
    while (k < end && /\s/.test(text[k])) {
      k++;
    }
    const isCustom = text.startsWith('--', i);
    const looksLikeDeclaration = j > i && text.charCodeAt(k) === COLON && code !== AT;
    if (looksLikeDeclaration) {
      if (isCustom) {
        // Custom property values may contain `{}` blocks: the declaration ends at `;` (or the block end).
        const stop = scanUntil(text, k + 1, end, (c) => c === SEMICOLON);
        items.push({kind: 'decl', start: i, end: trimEnd(text, i, stop), name: text.slice(i, j), valueStart: k + 1});
        i = stop + 1;
        continue;
      }
      // A regular declaration ends at `;`; when a `{` comes first at depth 0, it is a nested rule whose selector
      // starts like a declaration (`a:hover{...}`).
      const stop = scanUntil(text, k + 1, end, (c) => c === SEMICOLON || c === OPEN_BRACE);
      if (stop >= end || text.charCodeAt(stop) === SEMICOLON) {
        items.push({kind: 'decl', start: i, end: trimEnd(text, i, stop), name: text.slice(i, j), valueStart: k + 1});
        i = stop + 1;
        continue;
      }
      const close = blockEnd(text, stop, end);
      items.push({kind: 'nested', start: i, end: Math.min(end, close + 1)});
      i = close + 1;
      continue;
    }
    const stop = scanUntil(text, i, end, (c) => c === SEMICOLON || c === OPEN_BRACE);
    if (stop >= end || text.charCodeAt(stop) === SEMICOLON) {
      // A nested statement (`@apply ...;`) or garbage: kept as an opaque item.
      items.push({kind: 'nested', start: i, end: Math.min(end, stop + 1)});
      i = stop + 1;
      continue;
    }
    const close = blockEnd(text, stop, end);
    items.push({kind: 'nested', start: i, end: Math.min(end, close + 1)});
    i = close + 1;
  }
  return items;
}

function trimEnd(text: string, start: number, end: number): number {
  while (end > start && /\s/.test(text[end - 1])) {
    end--;
  }
  return end;
}

const VAR_RE = /\bvar\(\s*(--[A-Za-z0-9_\u0080-￿-]*(?:\\.[A-Za-z0-9_\u0080-￿-]*)*)/gi;

/**
 * Every custom-property name used through `var(--name ...)` in a CSS (or JavaScript) text, fallbacks included, in
 * order of first appearance. For `StyleOptions.references`: pass the application's own stylesheets / bundles.
 */
export function scanCustomPropertyReferences(text: string): string[] {
  const names = new Set<string>();
  addVarReferences(String(text ?? ''), names);
  return [...names];
}

/** Adds the `var()` names of `text` to `into`. */
export function addVarReferences(text: string, into: Set<string>): void {
  if (!text.includes('var(') && !/var\(/i.test(text)) {
    return;
  }
  VAR_RE.lastIndex = 0;
  for (let match = VAR_RE.exec(text); match !== null; match = VAR_RE.exec(text)) {
    into.add(match[1]);
  }
}

const DEFINITION_RE = /(?:^|[{;\s])(--[A-Za-z0-9_\u0080-￿-]+)\s*:/g;

/** Adds every custom property a CSS text (or a `style` attribute) defines (`--name:`) to `into`. */
export function addDefinitions(text: string, into: Set<string>): void {
  if (!text.includes('--')) {
    return;
  }
  DEFINITION_RE.lastIndex = 0;
  for (let match = DEFINITION_RE.exec(text); match !== null; match = DEFINITION_RE.exec(text)) {
    into.add(match[1]);
  }
}

/**
 * Replaces `var(--name, fallback)` by its fallback for every `--name` with `collapse(name) === true`, recursively
 * (fallbacks may contain further `var()`s). `var()`s without a fallback, or with an empty one, are left alone (an
 * empty substitution would turn the declaration into a parse error, which is not the same as invalid at
 * computed-value time). Returns the input unchanged (same string) when nothing was collapsed.
 */
export function collapseVars(value: string, collapse: (name: string) => boolean): string {
  if (!/var\(/i.test(value)) {
    return value;
  }
  let out = '';
  let last = 0;
  let changed = false;
  const re = /\bvar\(/gi;
  for (let match = re.exec(value); match !== null; match = re.exec(value)) {
    const open = match.index + match[0].length - 1;
    const close = scanUntil(value, open + 1, value.length, (c) => c === CLOSE_PAREN);
    if (close >= value.length) {
      break;
    }
    const inner = value.slice(open + 1, close);
    const comma = scanUntil(inner, 0, inner.length, (c) => c === 44);
    const name = inner.slice(0, comma).trim();
    if (comma < inner.length) {
      const fallback = inner.slice(comma + 1);
      if (collapse(name) && fallback.trim() !== '') {
        out += value.slice(last, match.index) + collapseVars(fallback.trim(), collapse);
        last = close + 1;
        re.lastIndex = close + 1;
        changed = true;
        continue;
      }
      const collapsed = collapseVars(fallback, collapse);
      if (collapsed !== fallback) {
        out += value.slice(last, open + 1) + inner.slice(0, comma + 1) + collapsed + ')';
        last = close + 1;
        re.lastIndex = close + 1;
        changed = true;
        continue;
      }
    }
    re.lastIndex = close + 1;
  }
  return changed ? out + value.slice(last) : value;
}

/** Identifier-like tokens of a text (for `@keyframes` references in `animation` values, custom properties, ...). */
export function addIdentifiers(text: string, into: Set<string>): void {
  const re = /-?[A-Za-z_\u0080-￿][\w\u0080-￿-]*/g;
  for (let match = re.exec(text); match !== null; match = re.exec(text)) {
    into.add(match[0]);
  }
}
