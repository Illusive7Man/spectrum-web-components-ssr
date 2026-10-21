// Vercel entry. Vercel detects an Express app from a root server.{js,mjs,ts} that imports express and default-exports
// the app (https://vercel.com/docs/frameworks/backend/express). The app is demo/src/server.ts, bundled by
// "npm run build:vercel" (scripts/build-vercel.mjs, the build command in vercel.json) into .vercel-server/.
//
// The DOM shim is loaded first and on its own: the server bundle's external imports (Spectrum modules among them) are
// evaluated before any code inside that bundle runs, and they need the browser globals to exist.
//
// Locally: npm run build:vercel && node server.mjs
import 'express';

await import('./.vercel-server/shim.mjs');
const {default: app} = await import('./.vercel-server/server.mjs');

export default app;
