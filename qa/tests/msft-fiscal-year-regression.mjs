import assert from 'node:assert/strict';
import fs from 'node:fs';
const py=fs.readFileSync(new URL('../../scripts/extraction/document_ensemble.py',import.meta.url),'utf8');
assert.match(py,/def filename_document_year/); assert.match(py,/return year/); 
const fn='msft-20250630.htm'; const m=fn.match(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/); assert.equal(Number(m[1]),2025);
console.log(JSON.stringify({status:'PASS',filename:fn,documentFiscalYear:2025}));
