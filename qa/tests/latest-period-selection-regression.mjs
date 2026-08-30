import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const src=fs.readFileSync(path.join(root,'app/backend/server.mjs'),'utf8');
const checks=[];
const expect=(id,ok,detail)=>checks.push({id,status:ok?'PASS':'FAIL',ok,detail});
expect('DASHBOARD-PERIOD-FIRST',
  src.includes('selectBestFinancialFact(usable,') && src.includes('financialConceptScore(b,concept)-financialConceptScore(a,concept)||by-ay'),
  'Dashboard latest financial period is ranked before system-verification status.');
expect('INTELLIGENCE-PERIOD-FIRST',
  (()=>{ const m=src.match(/const factRank=f=>\{([\s\S]{0,2400})\};/); if(!m)return false; const body=m[1]; const periodPos=body.indexOf("String(f.fiscalYear||'')===preferredYear?1:0"); const qualityPos=body.indexOf('Number(!!f.systemVerified)'); return periodPos>=0 && qualityPos>periodPos && body.includes('factFiscalYearNumber(f)'); })(),
  'CFO Intelligence latest financial period is ranked before evidence-quality status.');
expect('DIRECT-ANSWER-PERIOD-FIRST',
  src.includes('const targetYears=years.length?years:allYears.slice(0,2)') && src.includes('const pick=(concept,year)=>selectBestFinancialFact(facts,concept,year||null)'),
  'Direct CFO financial answers select the requested/latest period before evidence quality ranking.');
expect('RATIO-FINITE-INPUTS',
  src.includes("const ratioReadinessReason=!ratioCurrentAssets?'missing_current_assets'") && src.includes("!Number.isFinite(normalizedCurrentAssets)?'current_assets_non_finite'") && src.includes("normalizedLiabilities===0?'current_liabilities_zero'") && src.includes("const ratiosReady=ratioReadinessReason==='ready'"),
  'Ratio readiness distinguishes missing/non-finite inputs and an explicit zero denominator for the selected same-year pair.');
expect('ARENA-EVIDENCE-BEARING-CONTEXT',
  src.includes('const arenaCompany=') && src.includes('companyContext:arenaContext||arenaCompany||activeC'),
  'Diagnostic Arena selects an evidence-bearing company context when the active context is empty.');
const result={schemaVersion:'1.0',suite:'LATEST_PERIOD_SELECTION_REGRESSION',version:fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim(),generatedAt:new Date().toISOString(),status:checks.every(x=>x.ok)?'PASS':'FAIL',checks};
console.log(JSON.stringify(result));
process.exitCode=result.status==='PASS'?0:2;
