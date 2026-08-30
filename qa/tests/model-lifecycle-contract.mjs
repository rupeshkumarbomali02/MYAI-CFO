import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.join(root, 'qa/tests/model-lifecycle-live.mjs');
const src = fs.readFileSync(file, 'utf8');
const checks = [
  ['live test requires explicit MYAI_BASE_URL', /MYAI_BASE_URL/.test(src)],
  ['no hard-coded certification host fallback', /refusing to use a hard-coded fallback/.test(src)],
  ['runtime inventory endpoint', /\/models\/runtime/.test(src)],
  ['two-model lifecycle requirement', /models\.length<2/.test(src)],
  ['load endpoint', /\/models\/runtime\/load/.test(src)],
  ['live inference test endpoint', /\/models\/runtime\/test/.test(src)],
  ['unload endpoint', /\/models\/runtime\/unload/.test(src)],
  ['reload is verified', /const reload=await call/.test(src)],
  ['live lifecycle remains target-gated', /NOT_PROVEN/.test(src)],
];
const failures = checks.filter(([,ok]) => !ok);
if (failures.length) {
  console.error(JSON.stringify({status:'FAIL', failures:failures.map(([name])=>name)}, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({status:'PASS', checks:Object.fromEntries(checks)}, null, 2));
