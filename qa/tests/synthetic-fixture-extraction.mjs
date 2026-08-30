import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'qa/fixtures/synthetic-financial-statements-manifest.json'),'utf8'));
const pythonCandidates=process.platform==='win32'?['python.exe','python','py']:['python3','python'];
const requiredByType={
  'Income Statement':['revenue','gross_profit','operating_income','ebitda','net_income'],
  'Balance Sheet':['cash','current_assets','assets','receivables','inventory','current_liabilities','payables','debt','liabilities'],
  'Cash Flow Statement':['operating_cash_flow','capex','depreciation_amortization']
};
function findPython(){
  for(const c of pythonCandidates){const r=spawnSync(c,['--version'],{cwd:root,encoding:'utf8',windowsHide:true});if(r.status===0)return c;}
  return null;
}
const python=findPython();
const checks=[]; const failures=[];
const add=(id,ok,detail)=>{const x={id,status:ok?'PASS':'FAIL',ok:Boolean(ok),detail};checks.push(x);if(!ok)failures.push(x);};
add('PYTHON-AVAILABLE',!!python,python||'Python 3 was not found.');
if(python){
  for(const entry of manifest.manifest){
    const fp=path.join(root,'qa','fixtures','financial-statements',entry.filename);
    const resultsRoot=process.env.MYAI_CFO_TEST_RESULTS_DIR || path.join(root,'qa','results');
    fs.mkdirSync(resultsRoot,{recursive:true});
    const out=path.join(resultsRoot,`.fixture-${process.pid}-${entry.filename}.json`);
    const r=spawnSync(python,['scripts/extraction/document_ensemble.py','--input',fp,'--output',out],{cwd:root,encoding:'utf8',timeout:60000,windowsHide:true});
    let j=null; try{j=JSON.parse(fs.readFileSync(out,'utf8'));}catch{}
    try{fs.rmSync(out,{force:true});}catch{}
    const facts=Array.isArray(j?.structuredFacts)?j.structuredFacts:[];
    const years=[...new Set(facts.map(f=>Number(f.fiscalYear)).filter(Boolean))];
    const concepts=new Set(facts.map(f=>String(f.concept||'')));
    const needed=requiredByType[entry.statementType]||[];
    const missing=needed.filter(x=>!concepts.has(x));
    const systemVerifiedFacts=facts.filter(f=>f?.systemVerified);
    const systemVerifiedConcepts=new Set(systemVerifiedFacts.map(f=>String(f.concept||'')));
    const missingSystemVerified=needed.filter(x=>!systemVerifiedConcepts.has(x));
    // Derived debt is intentionally not systemVerified; its source components
    // (Current Debt + Long-Term Debt) must be systemVerified and the derived
    // aggregate itself remains provenance-bearing but not independently sourced.
    const debtDerivedOk = entry.statementType==='Balance Sheet' && needed.includes('debt') && systemVerifiedConcepts.has('current_debt') && systemVerifiedConcepts.has('long_term_debt') && concepts.has('debt');
    const adjustedMissingSystemVerified = missingSystemVerified.filter(x=>!(x==='debt' && debtDerivedOk));
    const expectedYears=[...new Set((entry.fiscalYears||['2024','2025']).map(Number))];
    const ok=r.status===0&&j?.extractionQuality?.grade==='ensemble'&&facts.length>0&&systemVerifiedFacts.length>0&&Number(j?.documentFiscalYear)===2025&&expectedYears.every(y=>years.includes(y))&&missing.length===0&&adjustedMissingSystemVerified.length===0;
    add(`FIXTURE-${entry.companyKey}-${entry.statementType.replace(/\W+/g,'-')}`,ok,JSON.stringify({file:entry.filename,exit:r.status,factCount:facts.length,systemVerifiedFactCount:systemVerifiedFacts.length,years,documentFiscalYear:j?.documentFiscalYear,missing,missingSystemVerified,adjustedMissingSystemVerified,grade:j?.extractionQuality?.grade||null,stderr:String(r.stderr||'').slice(-500)}));
  }
}
const out={schemaVersion:'1.0',suite:'SYNTHETIC_FIXTURE_EXTRACTION_REGRESSION',generatedAt:new Date().toISOString(),status:failures.length?'FAIL':'PASS',checks,failures};
console.log(JSON.stringify(out,null,2));
process.exitCode=failures.length?2:0;
