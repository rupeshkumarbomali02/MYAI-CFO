import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argv=process.argv.slice(2);
const argValue=(name)=>{const i=argv.indexOf(name);return i>=0?String(argv[i+1]||''):''};
const baseArg=argValue('--apiBase')||process.env.MYAI_BASE_URL||'';
const visibleBaseArg=argValue('--visibleApiBase')||process.env.MYAI_CFO_VISIBLE_API_BASE||'';
if(!baseArg)throw new Error('Certification API base URL is required; refusing to use a hard-coded fallback.');
if(!visibleBaseArg)throw new Error('Visible application API base URL is required; refusing to use a hard-coded fallback.');
const base=baseArg.replace(/\/$/,'');
const api=base.endsWith('/api')?base:`${base}/api`;
const apiFor=(baseUrl)=>{const clean=String(baseUrl||'').replace(/\/$/,'');return clean.endsWith('/api')?clean:`${clean}/api`};
const visibleBase=visibleBaseArg.replace(/\/$/,'');
const visibleApi=visibleBase.endsWith('/api')?visibleBase:`${visibleBase}/api`;
const visibleRequired=String(process.env.MYAI_CFO_VISIBLE_CERTIFICATION||'1')==='1';
const visibleOnly=argv.includes('--visibleOnly');
const seedOnly=argv.includes('--seedOnly');
const jobId=argValue('--jobId')||process.env.MYAI_CFO_CERT_JOB_ID||`manual-${Date.now()}`;
const resultPath=path.join(root,'qa','results','synthetic-evidence-latest.json');
const fixtureDir=path.join(root,'qa','fixtures');
const statementDir=path.join(fixtureDir,'financial-statements');
const comprehensiveKpiWorkbook=path.join(statementDir,'comprehensive-all-85-kpis.xlsx');
const comprehensiveKpiManifest=path.join(statementDir,'comprehensive-all-85-kpis.manifest.json');
const manifest=JSON.parse(fs.readFileSync(path.join(fixtureDir,'synthetic-financial-statements-manifest.json'),'utf8'));

async function callAt(apiBase,p,opts={}){
  const method=String(opts.method||'GET').toUpperCase();
  const timeoutMs=Number(opts.timeoutMs||60000);
  const fetchOpts={...opts}; delete fetchOpts.timeoutMs;
  try{
    const r=await fetch(`${apiBase}${p}`,{...fetchOpts,signal:fetchOpts.signal||AbortSignal.timeout(timeoutMs)});
    const text=await r.text(); let body={}; try{body=JSON.parse(text)}catch{body={raw:text}};
    return {status:r.status,body};
  }catch(e){
    return {status:0,body:{error:'REQUEST_FAILED',method,path:p,timeoutMs,message:String(e?.message||e),name:String(e?.name||''),code:String(e?.code||'')}};
  }
}
async function requireCompanyVisible(apiBase,companyId,expectedName){
  const list=await callAt(apiBase,'/companies',{timeoutMs:60000});
  const company=(list.body?.companies||[]).find(c=>c.id===companyId && !c.archived);
  if(!company)throw new Error(`Company was not visible after creation: ${expectedName} (${companyId})`);
  if(company.name!==expectedName)throw new Error(`Company identity changed after creation: ${company.name} vs ${expectedName}`);
  return company;
}
function b64(file){return fs.readFileSync(file).toString('base64');}
async function waitJobAt(apiBase,jobId,endpoint,maxSeconds=1200){
  if(!jobId)return {status:'NOT_PROVEN',error:'No job id returned.'};
  const started=Date.now();
  while(Date.now()-started<maxSeconds*1000){
    const r=await callAt(apiBase,`${endpoint}/${encodeURIComponent(jobId)}`); const j=r.body||{};
    if(['completed','completed_with_fallback','failed','cancelled','waiting_for_model'].includes(j.status))return j;
    await new Promise(r=>setTimeout(r,1000));
  }
  return {status:'timeout',error:`Job did not complete within ${maxSeconds}s.`};
}
async function waitJobsAt(apiBase,jobs,globalSeconds=1200){
  const deadline=Date.now()+globalSeconds*1000;
  const pending=new Map(jobs.filter(x=>x.jobId).map(x=>[x.jobId,{...x}]));
  const done=[];
  while(pending.size && Date.now()<deadline){
    const batch=await Promise.all([...pending.values()].map(async x=>{
      const r=await callAt(apiBase,`/documents/jobs/${encodeURIComponent(x.jobId)}`);
      const j=r.body||{};
      if(['completed','completed_with_fallback','failed','cancelled','waiting_for_model'].includes(j.status)) return {...x,result:j};
      return null;
    }));
    for(const result of batch.filter(Boolean)){pending.delete(result.jobId);done.push(result);}
    if(pending.size) await new Promise(r=>setTimeout(r,1000));
  }
  for(const x of pending.values()) done.push({...x,result:{status:'timeout',error:`Document AI suite exceeded ${globalSeconds}s global deadline.`}});
  return done;
}
async function upsertCompany(apiBase,spec){
  let cr=await callAt(apiBase,'/companies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:spec.name,country:spec.country,currency:spec.currency,reportingCurrency:spec.currency,reportingFramework:spec.framework,industry:'Synthetic Certification',fiscalYearEnd:'12-31',timezone:spec.timezone||'UTC'})});
  if(cr.status===409){
    const list=await callAt(apiBase,'/companies');
    const existing=(list.body?.companies||[]).find(c=>c.name===spec.name);
    if(!existing?.id)throw new Error(`Company ${spec.name} exists but could not be resolved.`);
    cr={status:200,body:existing};
  } else if(cr.status!==201) throw new Error(`Company creation HTTP ${cr.status}: ${cr.body?.error||''}`);
  let company=cr.body;
  if(cr.status===0){
    // A POST may commit server-side before a client timeout. Reconcile by exact
    // company name instead of treating a timeout as proof that creation failed.
    const list=await callAt(apiBase,'/companies',{timeoutMs:60000});
    company=(list.body?.companies||[]).find(c=>c.name===spec.name&&!c.archived)||null;
    if(!company) throw new Error(`Company creation timed out and no committed company could be reconciled: ${spec.name}`);
  }
  if(company?.industry && company.industry!=='Synthetic Certification') throw new Error(`Existing company ${spec.name} is not marked as Synthetic Certification; refusing to reuse it.`);
  if(company?.currency && company.currency!==spec.currency) throw new Error(`Existing company ${spec.name} currency mismatch: ${company.currency} vs ${spec.currency}.`);
  company=await requireCompanyVisible(apiBase,company.id,spec.name);
  return company;
}
async function uploadStatements(apiBase,company,spec){
  const inv=await callAt(apiBase,`/documents?companyId=${encodeURIComponent(company.id)}`);
  const docs=Array.isArray(inv.body?.documents)?inv.body.documents:[];
  const uploaded=[];
  for(const stmt of spec.statements){
    const existing=docs.find(d=>!d.archived && d.filename===stmt.filename);
    if(existing){
      const extractedFacts=Array.isArray(existing.structuredFacts)?existing.structuredFacts.length:Number(existing.factCount||0);
      const evidenceCount=Number(existing.evidenceCount||0);
      const healthy=String(existing.status)==='completed' && extractedFacts>0 && evidenceCount>0 && String(existing.documentFiscalYear||existing.fiscalYear)==='2025';
      if(healthy){uploaded.push({document:existing,jobId:null,reused:true});continue;}
      const rp=await callAt(apiBase,`/documents/${encodeURIComponent(existing.id)}/reprocess`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'CERTIFICATION_SYNTHETIC_EVIDENCE_REFRESH'})});
      if(rp.status!==200)throw new Error(`Existing synthetic document ${stmt.filename} is incomplete and reprocessing failed: HTTP ${rp.status} ${rp.body?.error||rp.body?.detail||''}`);
      const refreshed=rp.body?.document||rp.body;
      const refreshedJob=rp.body?.extractionJobId||rp.body?.aiJobId||refreshed?.extractionJobId||refreshed?.aiJobId||null;
      if(refreshedJob){const ej=await waitJobAt(apiBase,refreshedJob,'/documents/jobs',1200); if(!['completed','completed_with_fallback'].includes(ej.status))throw new Error(`Synthetic document ${stmt.filename} reprocess extraction ${ej.status}: ${ej.error||''}`);}
      uploaded.push({document:refreshed,jobId:rp.body?.aiJobId||refreshed?.aiJobId||null,reused:true,reprocessed:true});
      continue;
    }
    const preCompany=await requireCompanyVisible(apiBase,company.id,spec.name);
    if(preCompany.id!==company.id)throw new Error(`Company identity changed before document upload for ${stmt.filename}.`);
    const fp=path.join(statementDir,stmt.filename); if(!fs.existsSync(fp))throw new Error(`Missing financial statement fixture ${fp}`);
    const up=await callAt(apiBase,'/documents/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:company.id,filename:stmt.filename,documentType:stmt.statementType,category:'Certification Synthetic Financial Statements',fiscalYear:'2025',contentBase64:b64(fp),notes:'Visible synthetic certification financial statement. Intended for extraction, canonical facts, RAG, Dashboard, Intelligence, Copilot and KPI validation.'}),timeoutMs:600000});
    if(up.status===201){
      const created=up.body?.document||up.body;
      const extractionJobId=up.body?.extractionJobId||up.body?.aiJobId||created?.extractionJobId||created?.aiJobId||null;
      if(extractionJobId){const ej=await waitJobAt(apiBase,extractionJobId,'/documents/jobs',1200); if(!['completed','completed_with_fallback'].includes(ej.status))throw new Error(`Synthetic document ${stmt.filename} extraction ${ej.status}: ${ej.error||''}`);}
      const inv3=await callAt(apiBase,`/documents?companyId=${encodeURIComponent(company.id)}`,{timeoutMs:60000});
      const committed=(inv3.body?.documents||[]).find(d=>!d.archived&&d.filename===stmt.filename);
      if(!committed)throw new Error(`Synthetic document ${stmt.filename} was not visible after extraction completion.`);
      uploaded.push({document:committed,jobId:committed.aiJobId||null,reused:false});
      continue;
    }
    if(up.status===0){
      const inv2=await callAt(apiBase,`/documents?companyId=${encodeURIComponent(company.id)}`,{timeoutMs:60000});
      const committed=(inv2.body?.documents||[]).find(d=>!d.archived&&d.filename===stmt.filename);
      if(committed){
        uploaded.push({document:committed,jobId:committed.extractionJobId||committed.aiJobId||null,reused:true,requestTimedOut:true,committedAfterClientTimeout:true});
        continue;
      }
    }
    throw new Error(`Statement upload HTTP ${up.status} for ${stmt.filename}: ${up.body?.error||up.body?.detail||up.body?.message||''}`);
  }
  return uploaded;
}
async function upsertKnowledgePdf(apiBase){
  const fp=path.join(fixtureDir,manifest.knowledgePdf); if(!fs.existsSync(fp))throw new Error(`Missing Knowledge Hub fixture ${fp}`);
  const existing=await callAt(apiBase,'/knowledge/uploaded'); const items=existing.body?.documents||existing.body?.items||[];
  const hit=items.find(x=>!x.archived && (x.filename===manifest.knowledgePdf || x.title==='MYAI CFO Certification Knowledge Evidence'));
  if(hit)return {status:200,body:hit,reused:true};
  const r=await callAt(apiBase,'/knowledge/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:manifest.knowledgePdf,title:'MYAI CFO Certification Knowledge Evidence',category:'Accounting Controls',jurisdiction:'International',contentBase64:b64(fp)}),timeoutMs:600000});
  if(r.status!==202)throw new Error(`Knowledge PDF upload HTTP ${r.status}: ${r.body?.error||''}`);
  return {status:r.status,body:r.body,reused:false};
}
async function upsertKnowledgeUrl(apiBase){
  const url=manifest.knowledgeUrl;
  const existing=await callAt(apiBase,'/knowledge/uploaded');
  const items=existing.body?.documents||existing.body?.items||[];
  const hit=items.find(x=>!x.archived && String(x.sourceUrl||x.url||'')===url);
  if(hit)return {status:200,body:hit,reused:true,url};
  const r=await callAt(apiBase,'/knowledge/url',{method:'POST',headers:{'Content-Type':'application/json','X-MYAI-QA-Mode':'1'},body:JSON.stringify({url,title:'MYAI CFO Certification Synthetic URL Evidence',category:'Accounting Standards',jurisdiction:'International'})});
  if(r.status===409){
    const verify=await callAt(apiBase,'/knowledge/uploaded');
    const found=(verify.body?.documents||verify.body?.items||[]).find(x=>!x.archived && String(x.sourceUrl||x.url||'')===url);
    if(!found)throw new Error(`Knowledge URL returned HTTP 409 but the requested URL was not found afterward.`);
    return {status:200,body:found,reused:true,url};
  }
  if(![200,201,202].includes(r.status))throw new Error(`Knowledge URL ingestion HTTP ${r.status}: ${r.body?.error||r.body?.detail||''}`);
  return {status:r.status,body:r.body||{},url,reused:false};
}
async function upsertComprehensiveKpiWorkbook(apiBase,company){
  if(!fs.existsSync(comprehensiveKpiWorkbook))throw new Error(`Missing comprehensive KPI workbook ${comprehensiveKpiWorkbook}`);
  const inv=await callAt(apiBase,`/documents?companyId=${encodeURIComponent(company.id)}`);
  const docs=Array.isArray(inv.body?.documents)?inv.body.documents:[];
  const hit=docs.find(d=>!d.archived && d.filename==='comprehensive-all-85-kpis.xlsx');
  if(hit)return {status:200,body:hit,reused:true};
  const r=await callAt(apiBase,'/documents/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:company.id,filename:'comprehensive-all-85-kpis.xlsx',documentType:'KPI Certification Workbook',category:'Certification Synthetic KPI Dataset',fiscalYear:'2025',contentBase64:b64(comprehensiveKpiWorkbook),notes:'Comprehensive 85-KPI certification workbook: 85 populated source inputs, 2023/2024/2025 values, formula-driven KPI results and coverage matrix. Used to validate every KPI column and calculation.'}),timeoutMs:600000});
  if(![201,202].includes(r.status))throw new Error(`Comprehensive KPI workbook upload HTTP ${r.status}: ${r.body?.error||r.body?.detail||''}`);
  const jobId=r.body?.extractionJobId||r.body?.aiJobId||r.body?.document?.extractionJobId||r.body?.document?.aiJobId||null;
  if(jobId){const ej=await waitJobAt(apiBase,jobId,'/documents/jobs',1200); if(!['completed','completed_with_fallback'].includes(ej.status))throw new Error(`Comprehensive KPI workbook extraction ${ej.status}: ${ej.error||''}`);}
  const inv2=await callAt(apiBase,`/documents?companyId=${encodeURIComponent(company.id)}`);
  const committed=(inv2.body?.documents||[]).find(d=>!d.archived&&d.filename==='comprehensive-all-85-kpis.xlsx');
  if(!committed)throw new Error('Comprehensive KPI workbook was not visible after upload.');
  return {status:r.status,body:committed,reused:false};
}
async function verifyState(apiBase,specs){
  const companiesResp=await callAt(apiBase,'/companies');
  const companies=(companiesResp.body?.companies||[]).filter(c=>specs.some(s=>s.name===c.name)&&!c.archived);
  const documents=[];
  for(const c of companies){
    const d=await callAt(apiBase,`/documents?companyId=${encodeURIComponent(c.id)}`); documents.push({companyId:c.id,name:c.name,documents:(d.body?.documents||[]).filter(x=>!x.archived)});
  }
  const knowledge=await callAt(apiBase,'/knowledge/uploaded');
  const items=(knowledge.body?.documents||knowledge.body?.items||[]).filter(x=>!x.archived);
  const activeDocs=documents.reduce((n,c)=>n+c.documents.length,0);
  const expectedTypes=['Income Statement','Balance Sheet','Cash Flow Statement'];
  
  const requiredTypes=['Income Statement','Balance Sheet','Cash Flow Statement'];
  const companyChecks=documents.map(x=>{
    const statementDocuments=x.documents.filter(d=>d.documentType!=='KPI Certification Workbook' && d.filename!=='comprehensive-all-85-kpis.xlsx');
    const workbookDocuments=x.documents.filter(d=>d.documentType==='KPI Certification Workbook' || d.filename==='comprehensive-all-85-kpis.xlsx');
    const types=[...new Set(statementDocuments.map(d=>d.documentType).filter(Boolean))];
    const filenames=new Set(statementDocuments.map(d=>d.filename).filter(Boolean));
    const spec=specs.find(s=>s.name===x.name);
    const expectedYears=spec?.statements?.flatMap(s=>s.fiscalYears||[])||['2024','2025'];
    const expectedYearSet=[...new Set(expectedYears.map(String))];
    const expectedFilenames=new Set(spec?.statements?.map(s=>s.filename)||[]);
    const statementCoverage=requiredTypes.every(t=>types.includes(t));
    const filenameCoverage=[...expectedFilenames].every(n=>filenames.has(n));
    const metadataComplete=statementDocuments.every(d=>d.documentType&&d.fiscalYear&&String(d.documentFiscalYear||d.fiscalYear)==='2025');
    const extractionComplete=statementDocuments.every(d=>Number(d.factCount||0)>0 && Number(d.evidenceCount||0)>0 && Array.isArray(d.structuredFacts) && d.structuredFacts.length>0);
    const extractedFiscalYears=[...new Set(statementDocuments.flatMap(d=>(Array.isArray(d.structuredFacts)?d.structuredFacts:[]).map(f=>String(f.fiscalYear||'')).filter(Boolean)))].sort();
    const aiReviewComplete=statementDocuments.every(d=>!d.aiStatus||['completed','completed_with_fallback'].includes(String(d.aiStatus))||['completed','completed_with_fallback'].includes(String(d.aiReview?.status||'')));
    return {company:x.name,documentCount:x.documents.length,statementDocumentCount:statementDocuments.length,workbookPresent:workbookDocuments.length>0,statementTypes:types,statementCoverage,filenameCoverage,metadataComplete,extractionComplete,extractedFiscalYears,expectedFiscalYears:expectedYearSet,aiReviewComplete};
  });
  const hasPdf=items.some(x=>(x.filename===manifest.knowledgePdf||x.title==='MYAI CFO Certification Knowledge Evidence') && !!x.contentPath && !!x.sourcePath);
  const hasUrl=items.some(x=>String(x.sourceUrl||x.url||'')===manifest.knowledgeUrl && !!x.contentPath && !!x.sourcePath);
  return {companies,documents,activeDocumentCount:activeDocs,knowledgeItems:items,hasKnowledgePdf:hasPdf,hasKnowledgeUrl:hasUrl,companyChecks,expectedStatementTypes:expectedTypes};
}


async function cleanupPriorSyntheticCertification(apiBase){
  const companiesResp=await callAt(apiBase,'/companies');
  const companies=(companiesResp.body?.companies||[]).filter(c=>!c.archived && (c.industry==='Synthetic Certification' || String(c.name||'').startsWith('MYAI CFO Test — ')));
  for(const c of companies){
    const r=await callAt(apiBase,`/companies/${encodeURIComponent(c.id)}/delete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'CERTIFICATION_FRESH_SYNTHETIC_BOUNDARY',jobId})});
    if(![200,404].includes(r.status)) throw new Error(`Failed to remove prior synthetic company ${c.name}: HTTP ${r.status}`);
  }
  const k=await callAt(apiBase,'/knowledge/uploaded');
  const items=(k.body?.documents||k.body?.items||[]).filter(x=>!x.archived && (x.title==='MYAI CFO Certification Knowledge Evidence'||x.title==='MYAI CFO Certification Synthetic URL Evidence'||String(x.filename||'').includes('certification-knowledge-evidence')));
  for(const item of items){
    const r=await callAt(apiBase,`/knowledge/${encodeURIComponent(item.id)}/delete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'CERTIFICATION_FRESH_SYNTHETIC_BOUNDARY',jobId})});
    if(![200,404].includes(r.status)) throw new Error(`Failed to remove prior synthetic knowledge item ${item.id}: HTTP ${r.status}`);
  }
}

const specs=['healthy','stress','inconsistent','comprehensive'].map(key=>{
  const rows=manifest.manifest.filter(x=>x.companyKey===key);
  const meta={healthy:{name:'MYAI CFO Test — Healthy',country:'United States',currency:'USD',framework:'US GAAP'},stress:{name:'MYAI CFO Test — Stress',country:'United Kingdom',currency:'GBP',framework:'IFRS'},inconsistent:{name:'MYAI CFO Test — Inconsistent',country:'India',currency:'INR',framework:'Ind AS'},comprehensive:{name:'MYAI CFO Test — Comprehensive',country:'United States',currency:'USD',framework:'US GAAP'}}[key];
  return {...meta,key,statements:rows};
});

if(visibleRequired && visibleApi===base && !visibleOnly) throw new Error('Visible application API must be distinct from isolated certification API during full certification.');
const targets=visibleOnly
  ? [{label:'VISIBLE_APPLICATION',api:apiFor(visibleApi),base:visibleApi}]
  : [
      ...(visibleRequired?[{label:'VISIBLE_APPLICATION',api:apiFor(visibleApi),base:visibleApi}]:[]),
      {label:'CERTIFICATION',api:api,base:base}
    ];

const results={schemaVersion:'2.0',suite:'EARLY_VISIBLE_SYNTHETIC_PRODUCTION_EVIDENCE',jobId,generatedAt:new Date().toISOString(),status:'PASS',targets:[],errors:[]};
for(const target of targets){
  const out={label:target.label,base:target.base,companies:[],knowledge:{},verification:null,aiReview:[],status:'PASS',errors:[]};
  try{
    if(target.label==='VISIBLE_APPLICATION') await cleanupPriorSyntheticCertification(target.api);
    const allJobs=[];
    for(const spec of specs){
      const company=await upsertCompany(target.api,spec);
      // Keep the primary Healthy workspace active in the visible application as
      // soon as it exists. This prevents the UI from falling back to 'No company
      // selected' if a later synthetic regression case fails.
      if(spec.key==='healthy') {
        const ar=await callAt(target.api,'/companies/active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:company.id}),timeoutMs:60000});
        if(ar.status!==200) throw new Error(`Failed to set Healthy synthetic company active: HTTP ${ar.status}`);
      }
      const statements=await uploadStatements(target.api,company,spec);
      let workbook=null;
      if(spec.key==='comprehensive') workbook=await upsertComprehensiveKpiWorkbook(target.api,company);
      out.companies.push({key:spec.key,name:company.name,id:company.id,statements:statements.map(x=>({filename:x.document?.filename,documentId:x.document?.id,jobId:x.jobId,reused:x.reused})),workbook:workbook?{filename:'comprehensive-all-85-kpis.xlsx',documentId:workbook.body?.id,reused:workbook.reused}:null});
      allJobs.push(...statements.filter(s=>s.jobId).map(s=>({company:company.name,documentId:s.document?.id,filename:s.document?.filename,jobId:s.jobId})));
    }
    // Knowledge Hub evidence is seeded at the same early stage as the financial statements.
    out.knowledge.pdf=await upsertKnowledgePdf(target.api);
    out.knowledge.url=await upsertKnowledgeUrl(target.api);
    if(seedOnly){
      const reviews=await waitJobsAt(target.api,allJobs,1200);
      for(const item of reviews){
        out.aiReview.push({company:item.company,documentId:item.documentId,filename:item.filename,jobId:item.jobId,status:item.result?.status||'unknown',error:item.result?.error||null});
        if(!['completed','completed_with_fallback'].includes(item.result?.status)) throw new Error(`${item.company}/${item.filename}: AI review ${item.result?.status||'unknown'}${item.result?.error?` — ${item.result.error}`:''}`);
      }
      if(out.knowledge.pdf.body?.jobId){
        const kj=await waitJobAt(target.api,out.knowledge.pdf.body.jobId,'/knowledge/jobs',1200); out.knowledge.pdf.job=kj;
        if(kj.status!=='completed') throw new Error(`Knowledge PDF ingestion ${kj.status}: ${kj.error||''}`);
      }
      const state=await verifyState(target.api,specs); out.verification=state;
      if(state.companies.length!==4)throw new Error(`Expected 4 visible synthetic companies; found ${state.companies.length}.`);
      if(state.activeDocumentCount<12)throw new Error(`Expected at least 12 synthetic financial statements; found ${state.activeDocumentCount}.`);
      if(!state.companyChecks.every(x=>x.statementCoverage&&x.filenameCoverage&&x.metadataComplete&&x.extractionComplete&&x.expectedFiscalYears.every(y=>x.extractedFiscalYears.includes(y))&&x.aiReviewComplete))throw new Error(`Synthetic financial statement verification incomplete: ${JSON.stringify(state.companyChecks)}`);
    const comprehensiveState=state.companyChecks.find(x=>x.company==='MYAI CFO Test — Comprehensive');
    if(!comprehensiveState?.workbookPresent)throw new Error('Comprehensive 85-KPI workbook is not present in MYAI CFO Test — Comprehensive.');
    if(!fs.existsSync(comprehensiveKpiManifest))throw new Error(`Missing comprehensive KPI manifest ${comprehensiveKpiManifest}`);
    const kpiManifest=JSON.parse(fs.readFileSync(comprehensiveKpiManifest,'utf8'));
    if(Number(kpiManifest.kpiCount)!==85 || Number(kpiManifest.inputFieldCount)!==85 || Number(kpiManifest.yearCount)!==3)throw new Error(`Comprehensive KPI manifest invalid: ${JSON.stringify(kpiManifest)}`);
      if(!state.hasKnowledgePdf||!state.hasKnowledgeUrl)throw new Error(`Knowledge Hub synthetic evidence incomplete: PDF=${state.hasKnowledgePdf} URL=${state.hasKnowledgeUrl}`);
      const healthy=state.companies.find(c=>c.name==='MYAI CFO Test — Healthy');
      if(!healthy?.id)throw new Error('Healthy certification company was not persisted.');
      await callAt(target.api,'/companies/active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:healthy.id})});
    } else {
    // One bounded global wait for all statement AI jobs prevents 9 sequential 15-minute waits.
    const reviews=await waitJobsAt(target.api,allJobs,1200);
    for(const item of reviews){ out.aiReview.push({company:item.company,documentId:item.documentId,filename:item.filename,jobId:item.jobId,status:item.result?.status||'unknown',error:item.result?.error||null}); if(!['completed','completed_with_fallback'].includes(item.result?.status)) throw new Error(`${item.company}/${item.filename}: AI review ${item.result?.status||'unknown'}${item.result?.error?` — ${item.result.error}`:''}`); }
    if(out.knowledge.pdf.body?.jobId){const kj=await waitJobAt(target.api,out.knowledge.pdf.body.jobId,'/knowledge/jobs',1200);out.knowledge.pdf.job=kj;if(kj.status!=='completed')throw new Error(`Knowledge PDF ingestion ${kj.status}: ${kj.error||''}`);}
    const state=await verifyState(target.api,specs); out.verification=state;
    if(state.companies.length!==4)throw new Error(`Expected 4 visible synthetic companies; found ${state.companies.length}.`);
    if(state.activeDocumentCount<12)throw new Error(`Expected at least 12 synthetic financial statements; found ${state.activeDocumentCount}.`);
    if(!state.companyChecks.every(x=>x.statementCoverage&&x.filenameCoverage&&x.metadataComplete&&x.extractionComplete&&x.expectedFiscalYears.every(y=>x.extractedFiscalYears.includes(y))&&x.aiReviewComplete))throw new Error(`Synthetic financial statement verification incomplete: ${JSON.stringify(state.companyChecks)}`);
    const comprehensiveState=state.companyChecks.find(x=>x.company==='MYAI CFO Test — Comprehensive');
    if(!comprehensiveState?.workbookPresent)throw new Error('Comprehensive 85-KPI workbook is not present in MYAI CFO Test — Comprehensive.');
    if(!fs.existsSync(comprehensiveKpiManifest))throw new Error(`Missing comprehensive KPI manifest ${comprehensiveKpiManifest}`);
    const kpiManifest=JSON.parse(fs.readFileSync(comprehensiveKpiManifest,'utf8'));
    if(Number(kpiManifest.kpiCount)!==85 || Number(kpiManifest.inputFieldCount)!==85 || Number(kpiManifest.yearCount)!==3)throw new Error(`Comprehensive KPI manifest invalid: ${JSON.stringify(kpiManifest)}`);
    if(!state.hasKnowledgePdf||!state.hasKnowledgeUrl)throw new Error(`Knowledge Hub synthetic evidence incomplete: PDF=${state.hasKnowledgePdf} URL=${state.hasKnowledgeUrl}`);
    await callAt(target.api,'/companies/active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:state.companies.find(c=>c.name==='MYAI CFO Test — Healthy')?.id||null})});
    }
  }catch(e){out.status='FAIL';out.errors.push(String(e?.message||e));results.status='FAIL';results.errors.push(`${target.label}: ${String(e?.message||e)}`);}
  results.targets.push(out);
}
results.companyCount=Math.max(0,...results.targets.map(x=>x.verification?.companies?.length||0));
results.totalFinancialStatements=Math.max(0,...results.targets.map(x=>x.verification?.activeDocumentCount||0));
results.knowledgePdf=results.targets.every(x=>x.verification?.hasKnowledgePdf);
results.knowledgeUrl=results.targets.every(x=>x.verification?.hasKnowledgeUrl);
fs.mkdirSync(path.dirname(resultPath),{recursive:true}); fs.writeFileSync(resultPath,JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
process.exitCode=results.status==='PASS'?0:2;
