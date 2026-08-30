import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const fixtures=path.join(root,'qa','fixtures','financial-statements');
const targets={
 'healthy-income-2024-2025.pdf': {2024:{revenue:180,cogs:108,gross_profit:72,operating_income:27,ebitda:36,interest_expense:6,net_income:18},2025:{revenue:210,cogs:126,gross_profit:84,operating_income:34,ebitda:44,interest_expense:5.5,net_income:23}},
 'healthy-balance-2024-2025.pdf': {2024:{cash:32,current_assets:78,receivables:26,inventory:20,assets:220,current_liabilities:52,payables:21,liabilities:118,debt:60},2025:{cash:45,current_assets:96,receivables:30,inventory:22,assets:248,current_liabilities:55,payables:24,liabilities:121,debt:58}},
 'healthy-cashflow-2024-2025.pdf': {2024:{operating_cash_flow:29,capex:12},2025:{operating_cash_flow:36,capex:14}}
};
const run=(script,file,out)=>spawnSync(process.platform==='win32'?'py':'python3',process.platform==='win32'?['-3',script,'--input',file,'--output',out]:[script,'--input',file,'--output',out],{cwd:root,encoding:'utf8',timeout:120000});
const rows=[]; const tmp=path.join(root,'qa','.comparative-period-test');fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true});
for(const [name,expected] of Object.entries(targets)){
  const input=path.join(fixtures,name); const out=path.join(tmp,name+'.json'); const assetOut=path.join(tmp,name+'.assets.json'); const assetDir=path.join(tmp,name+'.assets');fs.mkdirSync(assetDir,{recursive:true});
  const ens=path.join(root,'scripts','extraction','document_ensemble.py'); const asset=path.join(root,'scripts','pdf','extract_pdf_assets.py');
  const r1=run(ens,input,out); const r2=spawnSync(process.platform==='win32'?'py':'python3',process.platform==='win32'?['-3',asset,'--input',input,'--output',assetOut,'--assets',assetDir]:[asset,'--input',input,'--output',assetOut,'--assets',assetDir],{cwd:root,encoding:'utf8',timeout:120000});
  let a={},b={};try{a=JSON.parse(fs.readFileSync(out,'utf8'))}catch{}try{b=JSON.parse(fs.readFileSync(assetOut,'utf8'))}catch{}
  const sourceEquivalent=(f)=>{const raw=Number(String(f.rawValue ?? f.value ?? '').replace(/[,₹$€£]/g,''));if(Number.isFinite(raw))return raw;const normalized=Number(f.normalizedValue);return Number.isFinite(normalized)?normalized:Number(f.value);};
  const check=(facts)=>Object.entries(expected).every(([yr,concepts])=>Object.entries(concepts).every(([c,v])=>facts.some(f=>String(f.fiscalYear)===yr&&f.concept===c&&Math.abs(sourceEquivalent(f)-v)<1e-9)));
  rows.push({file:name,ensembleExit:r1.status,assetExit:r2.status,ensembleFacts:a.structuredFacts?.length||0,assetFacts:b.structuredFacts?.length||0,ensembleCorrect:check(a.structuredFacts||[]),assetCorrect:check(b.structuredFacts||[])});
}
fs.rmSync(tmp,{recursive:true,force:true});
const pass=rows.length===3&&rows.every(r=>r.ensembleExit===0&&r.assetExit===0&&r.ensembleCorrect&&r.assetCorrect);
console.log(JSON.stringify({schemaVersion:'1.0',test:'COMPARATIVE_PERIOD_EXTRACTION_REGRESSION',pass,rows},null,2));
process.exitCode=pass?0:2;
