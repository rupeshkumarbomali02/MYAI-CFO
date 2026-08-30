import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argv=process.argv.slice(2); const arg=(n)=>{const i=argv.indexOf(n);return i>=0?String(argv[i+1]||''):''};
const base=(arg('--apiBase')||process.env.MYAI_BASE_URL||'').replace(/\/$/,'');
if(!base)throw new Error('Certification API base required.');
const api=base.endsWith('/api')?base:`${base}/api`;
const checks=[]; const expect=(id,ok,detail,evidence={})=>checks.push({id,status:ok?'PASS':'FAIL',ok,detail,evidence});
async function call(p,opts={}){const r=await fetch(api+p,opts);const text=await r.text();let body={};try{body=JSON.parse(text)}catch{body={raw:text}};return {status:r.status,body};}
const cr=await call('/companies');
const comp=(cr.body?.companies||[]).find(c=>!c.archived&&c.name==='MYAI CFO Test — Comprehensive');
expect('COMPANY_PRESENT',!!comp,'Production certification-created comprehensive company must exist and not be seeded in normal state.',{company:comp||null});
if(!comp){fs.mkdirSync(path.join(root,'qa','results'),{recursive:true});const out={suite:'COMPREHENSIVE_FINANCIAL_CERTIFICATION',version:fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim(),status:'FAIL',checks};fs.writeFileSync(path.join(root,'qa','results','comprehensive-financial-certification-latest.json'),JSON.stringify(out,null,2));process.exit(2);}
await call('/companies/active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:comp.id})});
const workbookPath=path.join(root,'qa','fixtures','financial-statements','comprehensive-all-85-kpis.xlsx');
const workbookManifestPath=path.join(root,'qa','fixtures','financial-statements','comprehensive-all-85-kpis.manifest.json');
const workbookManifest=fs.existsSync(workbookManifestPath)?JSON.parse(fs.readFileSync(workbookManifestPath,'utf8')):null;
expect('KPI_WORKBOOK_PRESENT',fs.existsSync(workbookPath)&&!!workbookManifest&&workbookManifest.kpiCount===85&&workbookManifest.inputFieldCount===85&&Array.isArray(workbookManifest.fiscalYears)&&workbookManifest.fiscalYears.join(',')==='2023,2024,2025','Comprehensive 85-KPI workbook is packaged with complete 2023/2024/2025 coverage.');

const dr=await call(`/documents?companyId=${encodeURIComponent(comp.id)}`); const docs=(dr.body?.documents||[]).filter(d=>!d.archived);
const statementDocs=docs.filter(d=>/\.pdf$/i.test(String(d.filename||'')));
const workbookDoc=docs.find(d=>d.filename==='comprehensive-all-85-kpis.xlsx' || d.documentType==='KPI Certification Workbook');
expect('KPI_WORKBOOK_INGESTED',!!workbookDoc && Number(workbookDoc.factCount||0)>=85 && String(workbookDoc.documentFiscalYear||workbookDoc.fiscalYear||'')==='2025','Comprehensive 85-KPI workbook is actually ingested into the Comprehensive company with 2025 document period and at least 85 structured input facts.',{document:workbookDoc?{id:workbookDoc.id,filename:workbookDoc.filename,status:workbookDoc.status,documentFiscalYear:workbookDoc.documentFiscalYear,fiscalYear:workbookDoc.fiscalYear,factCount:workbookDoc.factCount,extractionQuality:workbookDoc.extractionQuality}:null});
expect('THREE_STATEMENTS',statementDocs.length===3,'Comprehensive company has exactly three certification financial statements.',{documents:docs.map(d=>({filename:d.filename,documentType:d.documentType,fiscalYear:d.fiscalYear,documentFiscalYear:d.documentFiscalYear,factCount:d.factCount,evidenceCount:d.evidenceCount}))});
const years=[...new Set(docs.flatMap(d=>(d.structuredFacts||[]).map(f=>String(f.fiscalYear||'')) .filter(Boolean)))].sort();
expect('THREE_YEARS',years.join(',')==='2023,2024,2025','All three comparative fiscal years are present in structured facts.',{years});
const requiredByFile={
  'comprehensive-income-2023-2025.pdf':['revenue','cogs','gross_profit','ebitda','operating_income','interest_expense','net_income'],
  'comprehensive-balance-2023-2025.pdf':['cash','receivables','inventory','current_assets','current_liabilities','assets','liabilities','equity','debt'],
  'comprehensive-cashflow-2023-2025.pdf':['operating_cash_flow','capex']
};
for(const d of statementDocs){const facts=d.structuredFacts||[];const concepts=[...new Set(facts.map(f=>f.concept))];const req=requiredByFile[d.filename]||[];expect(`FACT_COVERAGE_${d.filename}`,req.every(k=>concepts.includes(k)),`Required core concepts are extracted for ${d.filename}.`,{missing:req.filter(k=>!concepts.includes(k)),concepts});}
const dash=await call('/dashboard'); const dk=dash.body?.dynamicKpis||[]; const val=k=>{const f=dk.find(x=>x.concept===k); return f?.value??null};
expect('DASHBOARD_LATEST_REVENUE',Math.abs(Number(val('revenue'))-120000)<1e-9,'Dashboard latest revenue uses FY2025 rather than a comparative-year value.',{actual:val('revenue'),expected:120000,items:dk.filter(x=>['revenue','cash','current_assets','current_liabilities','debt','assets','liabilities'].includes(x.concept))});
expect('DASHBOARD_CA_CL',Math.abs(Number(val('current_assets'))-55000)<1e-9&&Math.abs(Number(val('current_liabilities'))-30000)<1e-9,'Dashboard exposes the reported FY2025 Current Assets and Current Liabilities.',{actual:{current_assets:val('current_assets'),current_liabilities:val('current_liabilities')}});
const intel=await call('/cfo-intelligence'); const ratios=Array.isArray(intel.body?.ratios)?intel.body.ratios:[];
const ratio=(id)=>ratios.find(x=>x.id===id)||null;
expect('INTELLIGENCE_POPULATED',intel.status===200&&ratios.length>=20,'CFO Intelligence returns a populated KPI/ratio library for the comprehensive company.',{status:intel.status,ratioCount:ratios.length});
const computedRatios=ratios.filter(x=>x.status==='computed'&&Number.isFinite(Number(x.value))); const missingRatios=ratios.filter(x=>x.status==='missing-evidence'||x.status==='data-inconsistency');
expect('KPI_85_COMPUTED',intel.status===200&&computedRatios.length>=85,'All 85 comprehensive KPI definitions compute from canonical evidence.',{computedCount:computedRatios.length,totalRatios:ratios.length});
expect('KPI_NO_MISSING_INPUTS',missingRatios.length===0,'No comprehensive KPI remains in missing-evidence or data-inconsistency state.',{missingOrInconsistent:missingRatios.map(x=>({id:x.id,name:x.name,status:x.status,inputs:x.inputs}))});
expect('INTELLIGENCE_CURRENT_RATIO',Math.abs(Number(ratio('current-ratio')?.value)-(55000/30000))<0.001,'Current Ratio is correct for FY2025.',{actual:ratio('current-ratio'),expected:55000/30000});
expect('INTELLIGENCE_DEBT_RATIO',Math.abs(Number(ratio('debt-ratio')?.value)-(81000/140000))<0.001,'Debt Ratio uses Total Liabilities / Total Assets.',{actual:ratio('debt-ratio'),expected:81000/140000});
const trends=Array.isArray(intel.body?.trendMetrics)?intel.body.trendMetrics:[];
for(const label of ['Revenue','Cash','Debt','Net Income']){const t=trends.find(x=>x.label===label);expect(`TREND_${label.toUpperCase()}`,!!t&&t.points?.filter(p=>p.value!=null).length>=3,`Financial Trends contains three comparative points for ${label}.`,{metric:t||null});}
const q=`What was revenue in FY2025, FY2024 and FY2023 for ${comp.name}? Give the three values separately.`;
const chat=await call('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:q,companyId:comp.id,companyIds:[comp.id],workspace:'copilot',mode:'unified_cfo_workbench',history:[],attachments:[]})});
const ans=String(chat.body?.answer||'');
expect('COPILOT_THREE_YEAR_REVENUE',chat.status===200&&/120,000|120000/.test(ans)&&/105,000|105000/.test(ans)&&/90,000|90000/.test(ans),'Copilot returns separate FY2025/FY2024/FY2023 revenue values from company evidence.',{status:chat.status,answer:ans.slice(0,2200)});
const out={schemaVersion:'1.0',suite:'COMPREHENSIVE_FINANCIAL_CERTIFICATION',version:fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim(),generatedAt:new Date().toISOString(),status:checks.every(x=>x.ok)?'PASS':'FAIL',checks,summary:{passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length}};
fs.mkdirSync(path.join(root,'qa','results'),{recursive:true});fs.writeFileSync(path.join(root,'qa','results','comprehensive-financial-certification-latest.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out));process.exitCode=out.status==='PASS'?0:2;
