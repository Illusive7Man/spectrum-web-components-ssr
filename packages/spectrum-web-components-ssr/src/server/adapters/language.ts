/**
 * Locale of components that format numbers / labels: `reactive-controllers/src/LanguageResolution.js`
 * (`LanguageResolutionController`, used by `number-field`, `slider` (`SliderHandle.js`), `meter`, `progress-bar`,
 * `progress-circle`, `color-area` / `color-slider` / `color-wheel`) resolves the language from the closest
 * `<sp-theme>` (`theme/src/Theme.js` answers the `sp-language-context` request with
 * `this.lang || document.documentElement.lang || navigator.language`), or from `document.documentElement.lang` /
 * `navigator.language` when no theme answers.
 *
 * On the server `navigator.language` is the shim's 'en-US', which is not necessarily what the visitor's browser
 * resolves, so the server markup can show e.g. `1,234.5` where the hydrated page shows `1.234,5`. This inspector
 * warns about every element with such a controller when no language is set: neither `renderSpectrum({lang})`, nor
 * the server document's language, nor a `lang` attribute on the closest `<sp-theme>` ancestor.
 */
import type {ElementInspector} from './registry.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Duck type of `LanguageResolutionController` (class names are minified in production builds). */
function isLanguageResolver(controller: any): boolean {
  return (
    !!controller &&
    typeof controller.resolveLanguage === 'function' &&
    typeof controller.getDocumentLanguage === 'function' &&
    'language' in controller
  );
}

/** Parent across shadow boundaries (a shadow root's parent is its host). */
function composedParent(node: any): any {
  const parent = node?.parentNode;
  if (parent && parent.nodeType === 11 && parent.host) {
    return parent.host;
  }
  return parent ?? null;
}

export const LANGUAGE_WARNING =
  'locale: no language is set (neither <sp-theme lang> nor renderSpectrum({lang})); it resolves to ' +
  'navigator.language on the server, which may differ from the browser (number formatting, labels)';

export const languageInspector: ElementInspector = (element, {report, options, controllers}) => {
  const resolver: any = controllers.find(isLanguageResolver);
  if (!resolver || options.lang) {
    return;
  }
  if ((globalThis as any).document?.documentElement?.getAttribute?.('lang')) {
    return;
  }
  let theme: any = null;
  for (let node = composedParent(element), depth = 0; node && depth < 10_000; node = composedParent(node), depth++) {
    if (node.localName === 'sp-theme') {
      theme = node;
      break;
    }
  }
  if (theme) {
    // The closest theme answers the language request (it stops the event), with its own `lang` if it has one.
    if (!theme.getAttribute?.('lang')) {
      report.warnings.push(LANGUAGE_WARNING);
    }
    return;
  }
  // No theme among the known ancestors. If a theme answered the request anyway (the element has no structure
  // information in this pass), the language source is unknown: no warning.
  if (!resolver.unsubscribe) {
    report.warnings.push(LANGUAGE_WARNING);
  }
};
