/**
 * Registers the page theme (see page-theme.ts). The import ORDER is the point: ES modules are evaluated in the order of
 * their imports, so the theme fragments register with `Theme` BEFORE `<sp-theme>` is defined.
 *
 * `<sp-theme>` is a plain custom element (not a LitElement, no `defer-hydration`). Its constructor calls
 * `attachShadow()`, which empties the server's declarative shadow root (and with it the `<style>` that themes the page),
 * and adopts the styles of the fragments that are registered in the microtask after that. In one bundle all three modules
 * evaluate in the same task, so the order did not matter. Once they are separate chunks that arrive one after the other,
 * `<sp-theme>` defined first gives a painted frame with an unthemed page (sizes collapse, then jump back when the
 * fragments register: a layout shift of up to 0.03 on the badge page). Importing the fragments first in one module keeps
 * the order independent of how the bundler splits the modules and of the order the chunks arrive in.
 */
import '@spectrum-web-components/theme/theme-light.js';
import '@spectrum-web-components/theme/scale-medium.js';
import '@spectrum-web-components/theme/sp-theme.js';
