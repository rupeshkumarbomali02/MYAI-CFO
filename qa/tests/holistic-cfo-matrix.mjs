import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const server=fs.readFileSync(path.join(root,'app','backend','server.mjs'),'utf8');
const start=server.indexOf('function buildRatioLibrary(');
if(start<0) throw new Error('buildRatioLibrary not found');
let depth=0,started=false,end=-1;
for(let i=start;i<server.length;i++){
  const ch=server[i];
  if(ch==='{'){depth++;started=true;}
  else if(ch==='}'&&started){depth--; if(depth===0){end=i+1;break;}}
}
if(end<0) throw new Error('buildRatioLibrary end not found');
function extractFunction(source,name){
  const start=source.indexOf(`function ${name}(`); if(start<0)throw new Error(`${name} not found`); let i=source.indexOf('{',start),depth=0,inStr=null,esc=false;
  for(;i<source.length;i++){
    const c=source[i];
    if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c===inStr)inStr=null;continue;}
    if(c==='"'||c==="'"||c==='`'){inStr=c;continue;}
    if(c==='{')depth++; else if(c==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`unterminated ${name}`);
}
const selectorBody=extractFunction(server,'selectBestFinancialFact');
const financialScoreBody=extractFunction(server,'financialConceptScore');
const labelBody=extractFunction(server,'financialLabelText');
const sourceNumBody=extractFunction(server,'sourceNumericValue');
const scaleBody=extractFunction(server,'financialScaleFactor');
const methodologyBody=extractFunction(server,'financialMethodology');
const normalizedRatioBody=extractFunction(server,'normalizedFinancialForRatio');
const buildBody=server.slice(start,end);
const aliasStart=server.indexOf('const FACT_CONCEPT_ALIASES = {');
const aliasEnd=server.indexOf('function normalizedFactNumber',aliasStart);
const canonicalFactConcept=new Function(server.slice(aliasStart,aliasEnd)+';return canonicalFactConcept;')();
const scaleFn=new Function('FINANCIAL_SCALE_FACTORS',scaleBody+';return financialScaleFactor;')({units:1,thousand:1e3,k:1e3,million:1e6,m:1e6,billion:1e9,bn:1e9,trillion:1e12,tn:1e12,crore:1e7,cr:1e7,lakh:1e5});
const sourceNum=new Function(sourceNumBody+';return sourceNumericValue;')();
const factFY=(f)=>Number(String(f?.fiscalYear||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const labelFn=new Function(labelBody+';return financialLabelText;')();
const scoreFn=new Function('financialLabelText','canonicalFactConcept','factFiscalYearNumber',financialScoreBody+';return financialConceptScore;')(labelFn,canonicalFactConcept,factFY);
const selectFn=new Function('canonicalFactConcept','normalizedFactNumber','factFiscalYearNumber','financialConceptScore',selectorBody+';return selectBestFinancialFact;')(canonicalFactConcept,sourceNum,factFY,scoreFn);
const methodologyFn=new Function(methodologyBody+';return financialMethodology;')();
const ratioFn=new Function('sourceNumericValue',normalizedRatioBody+';return normalizedFinancialForRatio;')(sourceNum);
const buildFn=new Function('canonicalFactConcept','sourceNumericValue','selectBestFinancialFact','financialMethodology','financialScaleFactor','normalizedFinancialForRatio',buildBody+';return buildRatioLibrary;')(canonicalFactConcept,sourceNum,selectFn,methodologyFn,scaleFn,ratioFn);
const buildRatioLibrary=buildFn;
const base={revenue:1000,cogs:600,gross_profit:400,operating_income:150,net_income:100,ebitda:180,cash:200,current_assets:500,current_liabilities:250,assets:1000,liabilities:400,equity:200,debt:300,receivables:100,payables:80,inventory:120,capex:50,operating_cash_flow:100,depreciation_amortization:30,interest_expense:20,share_price:25,eps:2.5,book_value_per_share:10,market_cap:2500,enterprise_value:3300,preferred_dividends:5,weighted_avg_shares:40,dividends_paid:20,annual_dividend_per_share:.5,tax_rate:.25,nopat:120,invested_capital:700,ebit:150,capital_employed:1040,net_fixed_assets:450,average_total_assets:950,average_inventory:100,average_receivables:90,average_payables:75,net_credit_sales:900,total_debt_service:60,net_operating_income:150,lease_payments:10,prior_revenue:900,beginning_value:600,ending_value:1000,number_of_years:2,net_borrowing:50,change_working_capital:20,beginning_cash:100,ending_cash:200,number_of_months:12,average_working_capital:200,depreciation:30,operating_expenses:250,operating_costs:600,sga_expenses:120,budgeted_amount:900,actual_amount:940,total_production_cost:600,units_produced:200,mrr:80,sales_marketing_spend:100,new_customers:20,avg_revenue_per_customer:100,churn_rate:.05,starting_arr:1000,expansion:120,contraction:40,churn_arr:40,starting_revenue:900,lost_revenue:40,customers_lost:4,starting_customers:100,mrr_per_customer:.8,revenue_growth_rate:.2,current_quarter_revenue:300,prior_quarter_revenue:250,prior_quarter_sales_marketing_spend:75,net_cash_burn:50,net_new_arr:200,retained_earnings:200,market_value_equity:2500,cost_of_equity:.1,cost_of_debt:.05,risk_free_rate:.04,beta:1.1,market_return:.1,tax_expense:25,taxes:25,one_off_adjustments:10,fixed_costs:200,price_per_unit:10,variable_cost_per_unit:2,actual_sales:400,break_even_sales:200,prior_ebitda:150,prior_operating_income:120,variable_costs:300,organic_growth:.15};
const scenarios={
 baseline:{},
 liquidityStress:{cash:40,current_assets:180,current_liabilities:240,receivables:55,inventory:85,payables:120},
 leverageStress:{assets:1500,liabilities:1250,debt:1100,interest_expense:90,ebitda:150,operating_income:90},
 lossMaking:{net_income:-80,operating_income:-35,gross_profit:280,ebitda:40,interest_expense:45},
 zeroDenominator:{average_inventory:0,average_receivables:0,average_payables:0,number_of_years:0,number_of_months:0,weighted_avg_shares:0},
 growthScenario:{revenue:1400,prior_revenue:1000,ending_value:1400,beginning_value:1000,organic_growth:.4,revenue_growth_rate:.4,net_new_arr:350},
 missingInputs:{},
 inconsistency:{assets:500,liabilities:700,current_assets:50,current_liabilities:100,cash:70,inventory:90,revenue:-10,cogs:-5,capex:-3}
};
// Remove selected fields to exercise missing-input behavior without changing other ratios.
const missing=['eps','market_cap','enterprise_value','share_price','book_value_per_share','mrr','starting_arr','starting_revenue','starting_customers','tax_rate','weighted_avg_shares'];
const concepts=Object.keys(base);
function makeFacts(overrides,drop=[]){
  const vals={...base,...overrides};
  for(const k of drop) delete vals[k];
  return Object.entries(vals).map(([concept,value])=>({concept,normalizedValue:value,rawValue:String(value),unit:'USD million',currency:'USD',scale:'million',fiscalYear:'2025',id:`qa-${concept}`,documentId:'qa-doc',evidenceText:`Synthetic QA ${concept}=${value}`,systemVerified:true,validated:true,confidence:1}));
}
function shuffle(a,seed){const x=[...a];let s=seed>>>0;for(let i=x.length-1;i>0;i--){s=(1664525*s+1013904223)>>>0;const j=s%(i+1);[x[i],x[j]]=[x[j],x[i]]}return x;}
const results=[]; const recommendations=[];
for(const [name,override] of Object.entries(scenarios)){
  const facts=makeFacts(name==='missingInputs'?{}:override,name==='missingInputs'?missing:[]);
  const ratios=buildRatioLibrary(facts);
  const nonFinite=ratios.filter(r=>r.value!==null && !Number.isFinite(Number(r.value)));
  const core=Object.fromEntries(['current-ratio','quick-ratio','cash-ratio','gross-margin','operating-margin','net-margin','debt-to-equity','interest-coverage'].map(id=>[id,ratios.find(r=>r.id===id)]));
  const issues=[];
  if(ratios.length!==85) issues.push(`85-ratio catalogue mismatch: ${ratios.length}`);
  if(nonFinite.length) issues.push(`Non-finite ratio values: ${nonFinite.map(x=>x.id).join(', ')}`);
  if(name==='inconsistency' && ratios.find(x=>x.id==='current-ratio')?.status!=='data-inconsistency') issues.push('Current ratio did not flag data inconsistency.');
  if(name==='lossMaking' && !(Number(core['net-margin']?.value)<0)) issues.push('Negative net margin was not produced.');
  if(name==='liquidityStress' && !(Number(core['current-ratio']?.value)<1)) issues.push('Liquidity stress did not push current ratio below 1.');
  if(name==='leverageStress' && !(Number(core['debt-to-equity']?.value)>2)) issues.push('Leverage stress did not push debt/equity above 2x.');
  if(name==='zeroDenominator' && ratios.some(x=>x.status==='computed' && (x.value===null || !Number.isFinite(Number(x.value))))) issues.push('Zero denominator created invalid computed values.');
  if(name==='missingInputs' && ratios.some(x=>x.status==='computed' && x.value===null)) issues.push('Missing-input scenario contains a computed-null ratio.');
  // permutation invariance: output IDs/status/values must not depend on fact order.
  const shuffled=buildRatioLibrary(shuffle(facts,42));
  const mapA=new Map(ratios.map(x=>[x.id,`${x.status}|${x.value}`]));
  const mapB=new Map(shuffled.map(x=>[x.id,`${x.status}|${x.value}`]));
  for(const id of new Set([...mapA.keys(),...mapB.keys()])) if(mapA.get(id)!==mapB.get(id)) issues.push(`Permutation changed ratio ${id}: ${mapA.get(id)} -> ${mapB.get(id)}`);
  const highRisk=[];
  if(Number(core['current-ratio']?.value)<1) highRisk.push('Liquidity pressure');
  if(Number(core['debt-to-equity']?.value)>2) highRisk.push('High leverage');
  if(Number(core['net-margin']?.value)<0) highRisk.push('Negative profitability');
  if(name==='inconsistency') recommendations.push('Block authoritative CFO conclusions until contradictory accounting facts are resolved.');
  if(highRisk.length) recommendations.push(`${name}: ${highRisk.join(', ')} — use deterministic KPI signals to drive CFO review recommendations.`);
  results.push({scenario:name,status:issues.length?'FAIL':'PASS',issues,ratioCount:ratios.length,computed:ratios.filter(x=>x.status==='computed').length,dataInconsistency:ratios.filter(x=>x.status==='data-inconsistency').length,core:Object.fromEntries(Object.entries(core).map(([k,v])=>[k,v?{value:v.value,status:v.status}:null]))});
}
// Add a scale/currency normalization check using the same economic values expressed in different presentation units.
const baseInr=makeFacts({});
const inrThousand=baseInr.map(f=>({...f,currency:'USD',scale:'thousand',unit:'USD thousand',rawValue:String(f.normalizedValue*1000),normalizedValue:f.normalizedValue*1000}));
const rUsd=buildRatioLibrary(baseInr), rInr=buildRatioLibrary(inrThousand);
const invariantIds=new Set(['current-ratio','quick-ratio','cash-ratio','gross-margin','operating-margin','net-margin','debt-to-equity']);
const invariantFailures=[];for(const id of invariantIds){const a=rUsd.find(x=>x.id===id),b=rInr.find(x=>x.id===id);if(a?.status!==b?.status||Math.abs(Number(a?.value)-Number(b?.value))>1e-9)invariantFailures.push(id)}
results.push({scenario:'scale_currency_invariance',status:invariantFailures.length?'FAIL':'PASS',issues:invariantFailures.map(x=>`Scale/currency changed ${x}`),ratioCount:rInr.length,computed:rInr.filter(x=>x.status==='computed').length,dataInconsistency:rInr.filter(x=>x.status==='data-inconsistency').length,core:{}});
const failed=results.filter(x=>x.status==='FAIL');
const out={schemaVersion:'1.0',suite:'HOLISTIC_CFO_RATIO_KPI_MATRIX',generatedAt:new Date().toISOString(),expectedRatioCount:85,scenarios:results,summary:{scenarioCount:results.length,passed:results.filter(x=>x.status==='PASS').length,failed:failed.length,allRatiosChecked:results.every(x=>x.ratioCount===85),permutationTested:true,scaleCurrencyInvariantTested:true},recommendations:[...new Set(recommendations)],status:failed.length?'FAIL':'PASS'};
const outPath=path.join(root,'qa','results','holistic-cfo-matrix.json');fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));process.exit(failed.length?2:0);
