import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const server=fs.readFileSync(path.join(root,'app','backend','server.mjs'),'utf8');
const requiredSourceGuards=[
  "const CURRENT_FINANCIAL_SPINE_VERSION='production-financial-spine-v4-semantic-financial-tables';",
  'DOCUMENT_FINANCIAL_SPINE_REBUILD_FAILED_PRESERVED',
  'DOCUMENT_EXTRACTION_MIGRATED_METADATA_ONLY',
  'existing structured evidence preserved; no refresh required',
  'const usableCandidate=candidateFacts.length>0||candidateText.trim().length>0||candidateEvidence.length>0;',
  'Commit only after the candidate is proven usable.'
];
const missing=requiredSourceGuards.filter(x=>!server.includes(x));
if(missing.length){console.error(JSON.stringify({ok:false,missing}));process.exit(2);}
const fixtures=fs.readdirSync(path.join(root,'qa','fixtures','financial-statements')).filter(x=>x.toLowerCase().endsWith('.pdf'));
const outDir=path.join(root,'qa','results','spine-safety');fs.mkdirSync(outDir,{recursive:true});
const rows=[];
for(const f of fixtures){
  const out=path.join(outDir,`${f}.json`);
  const r=spawnSync(process.platform==='win32'?'py':'python3',process.platform==='win32'?['-3',path.join(root,'scripts','extraction','document_ensemble.py'),'--input',path.join(root,'qa','fixtures','financial-statements',f),'--output',out]:[path.join(root,'scripts','extraction','document_ensemble.py'),'--input',path.join(root,'qa','fixtures','financial-statements',f),'--output',out],{cwd:root,encoding:'utf8'});
  let j={}; try{j=JSON.parse(fs.readFileSync(out,'utf8'));}catch{}
  rows.push({file:f,exitCode:r.status,structuredFactCount:j.structuredFacts?.length||0,documentFiscalYear:j.documentFiscalYear||null,documentCurrency:j.documentCurrency||null});
}
const pass=rows.length===12 && rows.every(x=>x.exitCode===0&&x.structuredFactCount>0&&x.documentFiscalYear===2025);
const report={schemaVersion:'1.0',reportType:'MYAI_CFO_FINANCIAL_SPINE_SAFETY',generatedAt:new Date().toISOString(),sourceGuardsPassed:missing.length===0,fixtures:rows,pass};
fs.writeFileSync(path.join(root,'qa','results','financial-spine-safety.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));process.exitCode=pass?0:2;
