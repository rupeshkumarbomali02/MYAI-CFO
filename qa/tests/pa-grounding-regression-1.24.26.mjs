import assert from 'node:assert/strict';
import fs from 'node:fs';
const s=fs.readFileSync('app/backend/server.mjs','utf8');
assert.match(s,/function directKnowledgeStandardAnswer\(message,retrieved=\[\]\)/);
assert.match(s,/I used only retrieved Knowledge Hub material/);
assert.match(s,/IAS 2.*Inventories/);
assert.match(s,/IAS 19.*Employee Benefits/);
assert.match(s,/IFRS 19.*Subsidiaries without Public Accountability/);
console.log('PA grounding regression PASS');
