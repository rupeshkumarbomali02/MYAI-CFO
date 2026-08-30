import assert from 'node:assert/strict';
import fs from 'node:fs';
const s=fs.readFileSync('app/backend/server.mjs','utf8');
assert.match(s,/function comparableBaseValue\(f\)/);
assert.doesNotMatch(s,/baseValue:comparableBaseValue\(latest\)[\s\S]{0,20}\/\/ comparable/);
assert.match(s,/dashboardCacheKey/);
console.log('Dashboard regression PASS');
