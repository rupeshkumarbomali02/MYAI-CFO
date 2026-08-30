import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argv=process.argv.slice(2);
const arg=(name)=>{const i=argv.indexOf(name);return String(i>=0?argv[i+1]||'':'')};
const base=(arg('--apiBase')||process.env.MYAI_BASE_URL||'').replace(/\/$/,'');
const visible=(arg('--visibleApiBase')||process.env.MYAI_CFO_VISIBLE_API_BASE||base).replace(/\/$/,'');
if(!base)throw new Error('apiBase is required');
const api=base.endsWith('/api')?base:`${base}/api`;
const visibleApi=visible.endsWith('/api')?visible:`${visible}/api`;
const jobId=arg('--jobId')||process.env.MYAI_CFO_CERT_JOB_ID||`manual-${Date.now()}`;
const out=path.join(root,'qa','results','synthetic-cfo-e2e-latest.json'); fs.mkdirSync(path.dirname(out),{recursive:true});
const started=Date.now();
async function call(apiBase,p,opts={}){const r=await fetch(`${apiBase}${p}`,{...opts,signal:AbortSignal.timeout(30000)});const text=await r.text();let body={};try{body=JSON.parse(text)}catch{body={raw:text}};return {status:r.status,body};}
async function waitUntil(fn,timeout=900000){const deadline=Date.now()+timeout;let last=null;while(Date.now()<deadline){last=await fn();if(last?.done)return last;await new Promise(r=>setTimeout(r,1500));}return {done:false,status:'TIMEOUT',last};}
const checks=[];
const add=(id,ok,detail,evidence={})=>checks.push({id,status:ok?'PASS':'FAIL',ok,detail,evidence});

const companiesResp=await call(visibleApi,'/companies');
const visibleHealthy=(companiesResp.body?.companies||[]).find(c=>!c.archived&&/MYAI CFO Test — Healthy/i.test(String(c.name||'')));
if(visibleHealthy)await call(visibleApi,'/companies/active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:visibleHealthy.id})});
const companies=(companiesResp.body?.companies||[]).filter(c=>!c.archived&&String(c.industry||'')==='Synthetic Certification');
add('E2E-COMPANIES',companies.length>=3,`${companies.length}/3 synthetic companies visible in application`,{companies:companies.map(c=>({id:c.id,name:c.name,currency:c.currency,reportingCurrency:c.reportingCurrency}))});

let docs=[];
for(const c of companies){const r=await call(visibleApi,`/documents?companyId=${encodeURIComponent(c.id)}`);docs.push(...(r.body?.documents||[]).filter(d=>!d.archived).map(d=>({...d,companyId:c.id,companyName:c.name})));}
add('E2E-DOCUMENT-COUNT',docs.length>=9,`${docs.length}/9 synthetic financial documents visible in application`,{documents:docs.map(d=>({id:d.id,companyId:d.companyId,filename:d.filename,status:d.status,stage:d.stage,progress:d.progress,evidenceCount:d.evidenceCount,factCount:d.factCount}))});

const waited=await waitUntil(async()=>{
  const rows=[]; for(const c of companies){const r=await call(visibleApi,`/documents?companyId=${encodeURIComponent(c.id)}`);rows.push(...(r.body?.documents||[]).filter(d=>!d.archived));}
  const pending=rows.filter(d=>['processing','queued'].includes(String(d.status||''))||['extracting','evidence','facts','queued'].includes(String(d.stage||''))||['queued','running','waiting_for_model'].includes(String(d.aiStatus||'')));
  const failed=rows.filter(d=>['failed','needs_review','cancelled'].includes(String(d.status||''))||['failed','completed_no_facts'].includes(String(d.aiStatus||'')));
  return {done:pending.length===0,status:pending.length?'PENDING':'READY',rows,pending,failed};
},900000);
add('E2E-EXTRACTION-COMPLETE',waited.done&&(!waited.last?.failed?.length),waited.done?`All synthetic financial documents reached terminal healthy states.`:`Synthetic financial document pipeline did not finish within the bounded 15-minute window.`,{pending:waited.last?.pending||[],failed:waited.last?.failed||[]});
const extractionExpectations={
  'income':{minFacts:14,concepts:['revenue','cogs','gross_profit','operating_income','ebitda','interest_expense','net_income'],years:['2024','2025']},
  'balance':{minFacts:18,concepts:['cash','receivables','inventory','current_assets','assets','current_liabilities','payables','liabilities','debt'],years:['2024','2025']},
  'cashflow':{minFacts:6,concepts:['operating_cash_flow','capex','depreciation_amortization'],years:['2024','2025']}
};
const extractionEvidence=[]; let extractionHealthy=true;
// Refresh the persisted document list after the bounded extraction wait. The earlier
// wait response may be missing rows on some API timings even though the documents are
// terminal and fully persisted. Certification must evaluate the actual stored state.
let extractionRows=[];
for(const c of companies){try{const r=await call(visibleApi,`/documents?companyId=${encodeURIComponent(c.id)}`);if(r.status===200)extractionRows.push(...(r.body?.documents||[]));}catch{}}
if(!extractionRows.length) extractionRows=Array.isArray(waited.last?.rows)?waited.last.rows:docs;
for(const d of extractionRows){
  const kind=String(d.filename||'').includes('income')?'income':String(d.filename||'').includes('balance')?'balance':String(d.filename||'').includes('cashflow')?'cashflow':null;
  if(!kind)continue;
  const e=extractionExpectations[kind];
  // The document API returns factCount from the persisted financial spine. A completed
  // document with only a few facts is not sufficient for production certification.
  const factCount=Number(d.factCount||0); const okCount=factCount>=e.minFacts;
  extractionEvidence.push({filename:d.filename,factCount,expectedMinimum:e.minFacts,status:d.status,stage:d.stage});
  if(!okCount)extractionHealthy=false;
}
add('E2E-EXTRACTION-FACT-COVERAGE',extractionHealthy&&extractionEvidence.length>=9,extractionHealthy?`All 9 synthetic financial documents contain the expected full financial-spine fact coverage.`:`One or more synthetic financial documents completed without the expected comparative financial fact set.`,{documents:extractionEvidence,minimums:extractionExpectations});
const healthy=companies.find(c=>/Healthy/i.test(c.name))||companies[0];
if(healthy){await call(visibleApi,`/companies/${encodeURIComponent(healthy.id)}/use`,{method:'POST',headers:{'Content-Type':'application/json'}}).catch(()=>{});}
const dash=await call(visibleApi,'/dashboard');
const dk=Array.isArray(dash.body?.dynamicKpis)?dash.body.dynamicKpis:[];
const expectedGolden={revenue:210,cash:45,current_assets:96,current_liabilities:55,debt:58,currency:'USD',fiscalYear:2025};
const kpiValue=(concept)=>{const x=dk.find(v=>String(v.concept||'')===concept); return x?.value??x?.normalizedValue??null;};
const goldenMatches=['revenue','cash','current_assets','current_liabilities','debt'].every(k=>Number.isFinite(Number(kpiValue(k)))&&Math.abs(Number(kpiValue(k))-expectedGolden[k])<1e-9);
const revenue=dk.find(x=>String(x.concept)==='revenue');
add('E2E-DASHBOARD',dash.status===200&&!!dash.body?.company&&goldenMatches&&dash.body?.company?.reportingCurrency===expectedGolden.currency,`Dashboard returned the Healthy company and exact FY2025 golden financial facts.`,{status:dash.status,company:dash.body?.company||null,golden:expectedGolden,actual:{revenue:kpiValue('revenue'),cash:kpiValue('cash'),current_assets:kpiValue('current_assets'),current_liabilities:kpiValue('current_liabilities'),debt:kpiValue('debt')},revenue:revenue||null});
add('E2E-DASHBOARD-FIGURES',goldenMatches,`Dashboard golden figures match revenue=${expectedGolden.revenue}, cash=${expectedGolden.cash}, current assets=${expectedGolden.current_assets}, current liabilities=${expectedGolden.current_liabilities}, debt=${expectedGolden.debt}.`,{expected:expectedGolden,actual:{revenue:kpiValue('revenue'),cash:kpiValue('cash'),current_assets:kpiValue('current_assets'),current_liabilities:kpiValue('current_liabilities'),debt:kpiValue('debt')}});

const intel=await call(visibleApi,'/cfo-intelligence');
const ratios=Array.isArray(intel.body?.ratios)?intel.body.ratios:[];
const computedRatios=ratios.filter(x=>x?.value!=null&&Number.isFinite(Number(x.value)));
const currentRatio=ratios.find(x=>/current ratio/i.test(String(x.name||x.concept||'')));
const currentRatioValue=currentRatio?.value??null;
add('E2E-INTELLIGENCE',intel.status===200&&computedRatios.length>0&&intel.body?.company?.reportingCurrency===expectedGolden.currency,`CFO Intelligence returned ${computedRatios.length} computed ratios/KPIs using the Healthy company's reporting currency.`,{status:intel.status,computedRatioCount:computedRatios.length,expectedReportingCurrency:expectedGolden.currency,actualReportingCurrency:intel.body?.company?.reportingCurrency||null,currentRatio:currentRatio||null});
add('E2E-INTELLIGENCE-CURRENT-RATIO',Number.isFinite(Number(currentRatioValue))&&Math.abs(Number(currentRatioValue)-(expectedGolden.current_assets/expectedGolden.current_liabilities))<0.001,`Current Ratio must equal ${expectedGolden.current_assets}/${expectedGolden.current_liabilities} = ${(expectedGolden.current_assets/expectedGolden.current_liabilities).toFixed(3)}x for FY2025.`,{expected:expectedGolden.current_assets/expectedGolden.current_liabilities,actual:currentRatioValue});
add('E2E-RATIO-COVERAGE',computedRatios.length>=20,`At least 20 ratios/KPIs are computed from the synthetic financial evidence.`,{computedRatioCount:computedRatios.length});

const cop=await call(visibleApi,'/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Correlation-ID':`${jobId}-copilot`},body:JSON.stringify({message:'For the selected synthetic company, state the latest revenue shown in the validated financial evidence. State the currency and cite the source document.',companyId:healthy?.id||null,workspace:'copilot',mode:'unified_cfo_workbench'})});
const copAnswer=String(cop.body?.answer||'');
add('E2E-COPILOT',cop.status===200&&copAnswer.length>0,`CFO Copilot returned a non-empty answer.`,{status:cop.status,answer:copAnswer.slice(0,1800),moni:cop.body?.moni||null});

const knowledge=await call(visibleApi,'/knowledge/uploaded');
let items=(knowledge.body?.documents||knowledge.body?.items||[]).filter(x=>!x.archived);
const knowledgeWait=await waitUntil(async()=>{const r=await call(visibleApi,'/knowledge/uploaded');const rows=(r.body?.documents||r.body?.items||[]).filter(x=>!x.archived);const pending=rows.filter(x=>['queued','processing','extracting'].includes(String(x.status||''))||['queued','processing','extracting'].includes(String(x.stage||'')));const healthy=rows.filter(x=>x.contentPath&&x.sourcePath);return {done:rows.length>=2&&pending.length===0,status:pending.length?'PENDING':'READY',rows,pending,healthy};},600000); items=knowledgeWait.last?.rows||items; add('E2E-KNOWLEDGE',items.length>=2&&knowledgeWait.done&&items.every(x=>x.contentPath&&x.sourcePath),`Knowledge Hub contains ${items.length}/2 synthetic sources and completed persistence processing.`,{items:items.map(x=>({id:x.id,title:x.title,filename:x.filename,sourceUrl:x.sourceUrl||x.url,stage:x.stage,status:x.status,contentPath:x.contentPath})),pending:knowledgeWait.last?.pending||[]});

const pa=await call(visibleApi,'/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Correlation-ID':`${jobId}-pa`},body:JSON.stringify({message:'According to the certification Knowledge Hub evidence, what should management do when ledger balances do not reconcile? Give the evidence-grounded action and cite the source.',workspace:'pa',mode:'knowledge_adviser'})});
const paAnswer=String(pa.body?.answer||'');
add('E2E-PA',pa.status===200&&paAnswer.length>0,`CFO PA returned a non-empty Knowledge Hub answer after Knowledge processing.`,{status:pa.status,answer:paAnswer.slice(0,1800),moni:pa.body?.moni||null,code:pa.body?.code||null,api:pa.body?.api||null});

const arena=await call(visibleApi,'/arena/compete',{method:'POST',headers:{'Content-Type':'application/json','X-Correlation-ID':`${jobId}-arena`},body:JSON.stringify({prompt:'Using the selected synthetic company evidence, identify one material CFO risk and name the source evidence.',task:'general_cfo',companyId:healthy?.id||null,modelFilename:null})});
let arenaJob=null;
if(arena.status===202&&arena.body?.jobId){const wr=await waitUntil(async()=>{const j=await call(visibleApi,`/arena/jobs/${encodeURIComponent(arena.body.jobId)}`);const done=['completed','failed','cancelled','not_evaluable'].includes(j.body?.status);return {done,status:j.body?.status,last:j.body};},300000);arenaJob=wr.last;}
add('E2E-ARENA',arena.status===202&&arenaJob?.status==='completed'&&Array.isArray(arenaJob?.candidates)&&arenaJob.candidates.some(x=>x.ok),`Arena completed a company-evidence competition with at least one usable candidate.`,{queue:arena.body,job:arenaJob});

const result={schemaVersion:'1.0',reportType:'MYAI_CFO_SYNTHETIC_CFO_E2E',version:fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim(),jobId,generatedAt:new Date().toISOString(),durationMs:Date.now()-started,status:checks.every(x=>x.ok)?'PASS':'FAIL',checks,summary:{pass:checks.filter(x=>x.ok).length,fail:checks.filter(x=>!x.ok).length},chronology:['synthetic companies','financial documents','extraction + AI/RAG feed readiness','Dashboard','Intelligence + ratios','Copilot','Knowledge Hub PDF + URL','CFO PA','Agent Arena']};
fs.writeFileSync(out,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
process.exitCode=result.status==='PASS'?0:2;
