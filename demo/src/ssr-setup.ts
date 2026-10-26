/**
 * Side-effect module: installs the Spectrum DOM shim + Lit SSR globals.
 * It must be the FIRST import of the server entry (demo/src/server.ts), before anything touches a
 * `@spectrum-web-components/*` module (their registration modules read DOM globals at import time).
 */
import {installSpectrumSsr} from 'spectrum-web-components-ssr/server';

installSpectrumSsr();
