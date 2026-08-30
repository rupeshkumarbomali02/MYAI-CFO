import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const p=path.resolve('scripts/extraction/document_ensemble.py');
const s=fs.readFileSync(p,'utf8');
assert.match(s,/Bare currency codes in narrative text are not document-level currency evidence/);
assert.match(s,/\(\?P<ccy>INR\|USD[^)]*\)\\s\+\(\?P<scale>/);
console.log('Currency detection regression PASS');
