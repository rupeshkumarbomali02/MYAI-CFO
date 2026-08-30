import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const server=fs.readFileSync(path.join(root,'app','backend','server.mjs'),'utf8');
const cert=fs.readFileSync(path.join(root,'qa','run-production-assurance.mjs'),'utf8');
const checks={
  expectedEvidenceIdsInput:/evidenceIds:\[c\.id\]/.test(cert),
  citationRecords:/const citationRecords=/.test(server),
  evidenceBoundFlag:/citationEvidenceBound=/.test(server),
  sourceHash:/sourceTextHash:/.test(server),
  qaOnlyBoundary:/qaModeEnabled\(req\) && u\.pathname==='\/api\/qa\/rag\/generate'/.test(server)
};
const ok=Object.values(checks).every(Boolean);
console.log(JSON.stringify({status:ok?'PASS':'FAIL',checks},null,2));
process.exit(ok?0:1);
