// 1.24.26 regression: model autoload sequencing and resourceProfile propagation.
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const s = fs.readFileSync(new URL('../../app/backend/server.mjs', import.meta.url), 'utf8');
const required = [
  "resourceProfile:launched.resourceProfile||null",
  "return {child,backend:backend.kind,path:backend.path,profile,resourceProfile,apiKey};",
  "const preloadPromises=[];",
  "if(preloadPromises.length) await Promise.allSettled(preloadPromises);",
  "ensureFirstRunPreload().then(()=>ensureAutomaticModelRuntime({reason:'startup',maxAttempts:5,waitMs:2500}))"
];
for (const needle of required) {
  if (!s.includes(needle)) throw new Error(`Missing regression guard: ${needle}`);
}
if (s.includes(".finally(()=>ensureAutomaticModelRuntime({reason:'startup'")) {
  throw new Error('Startup still runs runtime ensure in finally before preload completion.');
}
console.log('1.24.26 autoload regression: PASS');
