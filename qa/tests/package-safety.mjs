import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const banned=['app/data/state.json','app/.myai-cfo/audit/acceptance.jsonl','qa/results/source-workflow-sanity-latest.json'];
const failures=[];
for(const rel of banned){if(fs.existsSync(path.join(root,rel))) failures.push(rel);}
const badResults=fs.existsSync(path.join(root,'qa/results'))?fs.readdirSync(path.join(root,'qa/results')).filter(n=>n!=='README.md'):[];
if(badResults.length) failures.push(...badResults.map(x=>`qa/results/${x}`));
const uniqueFailures=[...new Set(failures)];
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim();
for(const rel of ['app/backend/package.json','app/frontend/package.json']){
  const d=JSON.parse(fs.readFileSync(path.join(root,rel),'utf8')); if(d.version!==version) failures.push(`${rel}:version=${d.version}`);
}
console.log(JSON.stringify({suite:'PACKAGE_SAFETY',version,status:uniqueFailures.length?'FAIL':'PASS',failures:uniqueFailures},null,2));
process.exitCode=uniqueFailures.length?2:0;
