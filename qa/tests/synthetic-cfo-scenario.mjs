import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const jobId=process.env.MYAI_CFO_CERT_JOB_ID||`manual-${Date.now()}`;
const resultPath=path.join(root,'qa','results','synthetic-cfo-latest.json');
const portBase=48880;

function copyTree(src,dst){fs.cpSync(src,dst,{recursive:true,filter:(p)=>{const s=p.replaceAll('\\','/');return !/\/node_modules(\/|$)|\/data\/models\/text(\/|$)|\/\.myai-cfo\/audit(\/|$)|\/qa\/results(\/|$)/.test(s)}})}
function companyState(scenario){
  const cases={
    healthy:{revenue:120000, cogs:72000, gross_profit:48000, operating_income:18000, net_income:14000, ebitda:24000, cash:30000, current_assets:75000, current_liabilities:50000, assets:180000, liabilities:90000, debt:55000, receivables:22000, payables:18000, inventory:25000, capex:8000, operating_cash_flow:22000, depreciation_amortization:6000, interest_expense:4000, equity:125000},
    stress:{revenue:100000, cogs:70000, gross_profit:30000, operating_income:3000, net_income:-2000, ebitda:9000, cash:6000, current_assets:42000, current_liabilities:60000, assets:170000, liabilities:140000, debt:120000, receivables:12000, payables:25000, inventory:22000, capex:9000, operating_cash_flow:4000, depreciation_amortization:5000, interest_expense:8000, equity:30000},
    inconsistent:{revenue:90000, cogs:50000, gross_profit:40000, operating_income:12000, net_income:9000, ebitda:15000, cash:60000, current_assets:30000, current_liabilities:22000, assets:50000, liabilities:70000, debt:30000, receivables:8000, payables:7000, inventory:5000, capex:4000, operating_cash_flow:11000, depreciation_amortization:3000, interest_expense:2500, equity:-20000}
  };
  const vals=cases[scenario];
  const docId=`doc-${scenario}`; const companyId=`company-${scenario}`;
  const facts=Object.entries(vals).map(([concept,value])=>({id:`fact-${scenario}-${concept}`,companyId,documentId:docId,concept,rawValue:String(value),normalizedValue:value,unit:'USD million',scale:'million',currency:'USD',fiscalYear:'2025',validated:true,systemVerified:true,evidenceText:`Synthetic ${scenario} fixture: ${concept}=${value} USD million`,confidence:0.99,createdAt:new Date().toISOString()}));
  const doc={id:docId,companyId,filename:`synthetic-${scenario}.pdf`,documentType:'Annual Report',fiscalYear:'2025',documentFiscalYear:'2025',userFiscalYear:'2025',documentCurrency:'USD',currency:'USD',documentScale:'million',documentUnit:'USD million',status:'completed',stage:'completed',progress:100,evidenceCount:facts.length,structuredFacts:facts,documents:[],archived:false,updatedAt:new Date().toISOString(),createdAt:new Date().toISOString()};
  return {companies:[{id:companyId,name:`Synthetic CFO ${scenario}`,country:'United States',currency:'USD',reportingCurrency:'USD',reportingFramework:'US GAAP',industry:'Synthetic QA',documents:[doc],facts}],activeCompanyId:companyId};
}
async function request(port,pathName,options={}){const r=await fetch(`http://127.0.0.1:${port}${pathName}`,{...options,signal:AbortSignal.timeout(8000)});const body=await r.json();return {status:r.status,body};}

async function runScenario(scenario,index){
  const tempRoot=process.env.MYAI_CFO_CERT_TEMP_ROOT||path.resolve(process.env.MYAI_CFO_CERT_TEMP_ROOT || path.join(os.tmpdir(),'MYAI-CFO-Certification'));
  fs.mkdirSync(tempRoot,{recursive:true});
  const tmp=fs.mkdtempSync(path.join(tempRoot,`myai-cfo-synth-${scenario}-`));
  copyTree(root,tmp);
  const statePath=path.join(tmp,'app','data','state.json');
  const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{version:fs.readFileSync(path.join(tmp,'VERSION.txt'),'utf8').trim(),companies:[],activeCompanyId:null,documents:[],knowledgeItems:[],aiJobs:{},arena:{runs:[],champion:null,competitions:[],jobs:{}},moni:{status:'ready'}};
  const fixture=companyState(scenario);
  Object.assign(state,fixture);
  state.disclaimer={accepted:false,version:'2.5',hash:''};
  state.aiJobs={}; state.arena={runs:[],champion:null,competitions:[],jobs:{}}; state.moni ||= {status:'ready'};
  fs.mkdirSync(path.join(tmp,'app','data'),{recursive:true}); fs.writeFileSync(path.join(tmp,'app','data','state.json'),JSON.stringify(state,null,2));
  const port=portBase+index;
  const child=spawn(process.execPath,[path.join(tmp,'app','backend','server.mjs')],{cwd:tmp,env:{...process.env,MYAI_CFO_API_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let logs=''; child.stdout.on('data',d=>logs+=String(d)); child.stderr.on('data',d=>logs+=String(d));
  const deadline=Date.now()+12000; let ready=false;
  while(Date.now()<deadline){try{const r=await request(port,'/api/health');if(r.status===200){ready=true;break}}catch{} await new Promise(r=>setTimeout(r,250));}
  if(!ready){child.kill();throw new Error(`${scenario}: backend did not become ready. ${logs.slice(-2000)}`)}
  const disclaimer=await request(port,'/api/disclaimer');
  const accepted=await request(port,'/api/disclaimer/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:disclaimer.body.version,hash:disclaimer.body.hash})});
  if(accepted.status!==200) throw new Error(`disclaimer accept failed: ${JSON.stringify(accepted.body)}`);
  await new Promise(r=>setTimeout(r,150));
  const intelligence=await request(port,'/api/cfo-intelligence');
  const dashboard=await request(port,'/api/dashboard');
  child.kill('SIGTERM');
  await new Promise(r=>setTimeout(r,100));
  const ratios=intelligence.body.ratios||[];
  const byId=new Map(ratios.map(x=>[x.id,x]));
  const issues=[];
  const expectedCount=85;
  if(ratios.length!==expectedCount)issues.push(`Expected ${expectedCount} ratios, got ${ratios.length}`);
  const core=['current-ratio','quick-ratio','cash-ratio','gross-margin','operating-margin','net-margin','debt-to-equity','ccc','dso','dpo'];
  for(const id of core) if(!byId.has(id)) issues.push(`Missing KPI/ratio: ${id}`);
  const current=Number(byId.get('current-ratio')?.value), quick=Number(byId.get('quick-ratio')?.value), cash=Number(byId.get('cash-ratio')?.value), de=Number(byId.get('debt-to-equity')?.value), nm=Number(byId.get('net-margin')?.value);
  if(scenario==='healthy' && !(current>1 && quick>0.8 && cash>0.4 && de<2 && nm>0))issues.push(`Healthy scenario did not produce healthy core ratios: current=${current}, quick=${quick}, cash=${cash}, debtToEquity=${de}, netMargin=${nm}.`);
  if(scenario==='stress'){
    if(!(current<1))issues.push('Stress current ratio should be <1.0.');
    if(!(quick<0.8))issues.push('Stress quick ratio should be <0.8.');
    if(!(cash<0.2))issues.push('Stress cash ratio should be <0.2.');
    if(!(de>2))issues.push('Stress debt/equity should be >2.0.');
    if(!(nm<0))issues.push('Stress net margin should be negative.');
    if(!intelligence.body.risks.some(x=>/liquidity pressure/i.test(x.title)))issues.push('Stress liquidity risk recommendation missing.');
    if(!(intelligence.body.healthScore < 87))issues.push(`Stress health score should be lower than baseline, got ${intelligence.body.healthScore}`);
  }
  if(scenario==='inconsistent'){
    if(!(byId.get('current-ratio')?.status==='data-inconsistency'))issues.push('Inconsistent current ratio not flagged.');
    if(intelligence.body.healthScore!==null)issues.push('Inconsistent data must not receive a health score.');
  }
  if(dashboard.status!==200) issues.push(`Dashboard API status ${dashboard.status}`);
  if(intelligence.status!==200) issues.push(`Intelligence API status ${intelligence.status}`);
  if(dashboard.body.company?.currency!=='USD')issues.push(`Dashboard company currency invariant failed: ${dashboard.body.company?.currency||'none'}`);
  if(dashboard.body.documentCount!==1)issues.push(`Dashboard document count mismatch: ${dashboard.body.documentCount??'none'}`);
  return {scenario,status:issues.length?'FAIL':'PASS',issues,ratioCount:ratios.length,healthScore:intelligence.body.healthScore,decisionState:dashboard.body.decisionState,risks:intelligence.body.risks.map(x=>x.title),metrics:intelligence.body.metrics,dashboard:{status:dashboard.status,company:dashboard.body.company?.name||null,validatedFactCount:dashboard.body.validatedFactCount,evidenceCount:dashboard.body.evidenceCount,currency:dashboard.body.company?.currency}};
}
const out={jobId,schemaVersion:'1.0',suite:'HOLISTIC_SYNTHETIC_CFO_SCENARIOS',generatedAt:new Date().toISOString(),expectedRatioCount:85,scenarios:[],status:'PASS'};
for(const [scenario,index] of [['healthy',1],['stress',2],['inconsistent',3]]){
  try{const r=await runScenario(scenario,index);out.scenarios.push(r);if(r.status!=='PASS')out.status='FAIL'}catch(e){out.scenarios.push({scenario,status:'FAIL',issues:[e.message]});out.status='FAIL';}
}
fs.mkdirSync(path.dirname(resultPath),{recursive:true});fs.writeFileSync(resultPath,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));process.exitCode=out.status==='PASS'?0:2;
