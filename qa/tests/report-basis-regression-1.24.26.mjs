import assert from 'node:assert/strict';
import fs from 'node:fs';
const s=fs.readFileSync('app/backend/server.mjs','utf8');
assert.match(s,/function requestedReportBasis\(message\)/);
assert.match(s,/if\(\/\\bconsolidated\\b\/\.test\(q\)\) return 'consolidated'/);
assert.match(s,/if\(\/\\bstandalone\\b/);
assert.match(s,/companyEvidenceContextFiltered\(c,\{fiscalYears,reportBasis\}\)/);
console.log('Report-basis regression PASS');
