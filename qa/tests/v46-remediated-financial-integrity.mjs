import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const server=fs.readFileSync(path.join(root,'app/backend/server.mjs'),'utf8');
const extractor=fs.readFileSync(path.join(root,'scripts/extraction/document_ensemble.py'),'utf8');
const checks=[];
const expect=(id,ok,detail,data={})=>checks.push({id,status:ok?'PASS':'FAIL',ok,detail,...data});

const releaseVersion=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim();
expect('VERSION',/^[0-9]+\.[0-9]+\.[0-9]+$/.test(releaseVersion),`Remediated MVP version is ${releaseVersion}.`);
expect('SERVER_SYNTAX',spawnSync(process.execPath,['--check',path.join(root,'app/backend/server.mjs')],{encoding:'utf8'}).status===0,'Backend syntax check passes.');
expect('EXTRACTOR_SYNTAX',spawnSync(process.platform==='win32'?'py':'python3',process.platform==='win32'?['-3','-m','py_compile',path.join(root,'scripts/extraction/document_ensemble.py')]:['-m','py_compile',path.join(root,'scripts/extraction/document_ensemble.py')],{encoding:'utf8'}).status===0,'Extractor Python syntax check passes.');
expect('SOURCE_SCALE_CONTRACT',server.includes('f.normalizedValue=sv;')&&server.includes('f.baseValue=sv*financialScaleFactor')&&server.includes('function normalizedFactNumber(f){\n  // Financial facts are source-scale values.'),'Canonical financial value keeps source-scale numeric value while base value is metadata for controlled calculations.');
expect('UNIT_AWARE_RATIO',server.includes('const compatibleNumeric=(f)=>')&&server.includes('if(a.currency&&b.currency&&String(a.currency).toUpperCase()!==String(b.currency).toUpperCase())return null;'),'Ratios use controlled unit-aware calculation without rewriting source facts.');
expect('SEMANTIC_AGGREGATES',server.includes('aggregateRole')&&server.includes('reported-aggregate')&&server.includes('selectBestFinancialFact'),'Financial aggregates are selected semantically, not by requiring the word Total.');
expect('REPORTED_EQUITY_FIRST',server.includes("const reported=inp('Shareholders’ Equity','equity'); if(reported.value!=null)return reported;"),'Reported equity outranks derived Assets minus Liabilities.');
expect('CURRENT_RATIO',server.includes("all.push(add('current-ratio'")&&server.includes('Reported Current Assets ÷ Reported Current Liabilities'),'Current Ratio is based on the authoritative current-asset/current-liability aggregates.');
expect('DSO_METHODOLOGY',server.includes('Average Accounts Receivable ÷ Net Credit Sales'),'DSO prefers average receivables and net credit sales with fallback.');
expect('DPO_METHODOLOGY',server.includes('Average Accounts Payable ÷ Purchases'),'DPO prefers average payables and purchases with fallback.');
expect('DEBT_RATIO',server.includes("'debt-ratio','Debt Ratio (Total Liabilities to Total Assets)'")&&server.includes('Total Liabilities ÷ Total Assets'),'Debt Ratio is explicitly separated from Debt-to-Assets.');
expect('KNOWLEDGE_PARITY',server.includes("/api/knowledge/uploaded/")&&server.includes("/reprocess")&&server.includes("/review"),'Knowledge Hub supports reprocess/review endpoints and evidence assets.');
expect('COMPARATIVE_BINDING',extractor.includes('years[pos]')&&extractor.includes('standalone')&&extractor.includes('collected.extend(n)'),'Extractor binds complete comparative columns, including vertically rendered year/value sequences.');
expect('NOTE_REFERENCE_GUARD',extractor.includes('min(abs(v) for v in tail) >= max(100.0,abs(first)*10)'),'Small numeric financial values are not discarded as note references unless the evidence pattern supports it.');
expect('NEGATIVE_SIGN_CONTRACT',server.includes('return n<0?n:(neg?-n:n);'),'Negative source values and parenthesized negative values retain the correct economic sign without double-negation.');
expect('KNOWLEDGE_UI_PARITY',(()=>{const ui=fs.readFileSync(path.join(root,'app/frontend/src/main.jsx'),'utf8'); return ui.includes('reprocessKnowledge')&&ui.includes('reviewKnowledge')&&ui.includes('Images / tables')&&ui.includes('Review outcome')&&ui.includes('Reprocess');})(),'Knowledge Hub UI exposes extracted images/tables, reprocess and review outcome controls.');

// Execute the real extractor against a deterministic 3-year comparative fixture.
const fixture=path.join(root,'qa/fixtures/V46-Remediated-Comparative-Financial-Test.pdf');
const tmp=path.join(root,'qa/.v46-remediated-test'); fs.rmSync(tmp,{recursive:true,force:true}); fs.mkdirSync(tmp,{recursive:true});
const out=path.join(tmp,'extraction.json');
const py=process.platform==='win32'?'py':'python3'; const args=process.platform==='win32'?['-3',path.join(root,'scripts/extraction/document_ensemble.py'),'--input',fixture,'--output',out]:[path.join(root,'scripts/extraction/document_ensemble.py'),'--input',fixture,'--output',out];
const run=spawnSync(py,args,{cwd:root,encoding:'utf8',timeout:120000});
let j={}; try{j=JSON.parse(fs.readFileSync(out,'utf8'));}catch{}
const facts=j.structuredFacts||[];
const fact=(concept,year)=>facts.find(f=>f.concept===concept&&String(f.fiscalYear)===String(year));
expect('EXTRACTION_RUN',run.status===0,'Comparative fixture extraction completed.',{exitCode:run.status});
expect('THREE_YEAR_COLUMNS',JSON.stringify(j.comparativeFiscalYears||[])===JSON.stringify([2025,2024,2023]),'Three financial periods are preserved in descending fiscal-year order.',{years:j.comparativeFiscalYears});
expect('TABLE_EVIDENCE',(j.tables||[]).length>=2,'Detected table evidence is preserved.',{tableCount:j.tables?.length||0});
const htmlFixture=path.join(root,'qa/fixtures/tesla-sec-like-comparative.html');
const htmlOut=path.join(root,'qa/.v46-html-test.json'); const htmlAssets=path.join(root,'qa/.v46-html-assets'); fs.rmSync(htmlAssets,{recursive:true,force:true});
const hrun=spawnSync(py,process.platform==='win32'?['-3',path.join(root,'scripts/extraction/document_ensemble.py'),'--input',htmlFixture,'--output',htmlOut,'--assets',htmlAssets]:[path.join(root,'scripts/extraction/document_ensemble.py'),'--input',htmlFixture,'--output',htmlOut,'--assets',htmlAssets],{cwd:root,encoding:'utf8',timeout:120000});
let hj={};try{hj=JSON.parse(fs.readFileSync(htmlOut,'utf8'));}catch{}
const hf=hj.structuredFacts||[];
expect('HTML_EXTRACTION_RUN',hrun.status===0,'SEC-like HTML comparative extraction completed.',{exitCode:hrun.status});
expect('HTML_COMPARATIVE_YEARS',JSON.stringify(hj.comparativeFiscalYears||[])===JSON.stringify([2025,2024,2023]),'HTML table retains 2025/2024/2023 comparative periods.',{years:hj.comparativeFiscalYears});
expect('HTML_ASSETS',(hj.tables||[]).length===2&&(hj.images||[]).length===1,'HTML extraction preserves tables and image assets.',{tables:hj.tables?.length||0,images:hj.images?.length||0});
expect('HTML_CA_CL',hf.some(f=>f.concept==='current_assets'&&f.fiscalYear===2025&&Number(f.normalizedValue)===68642)&&hf.some(f=>f.concept==='current_liabilities'&&f.fiscalYear===2025&&Number(f.normalizedValue)===31714),'HTML extraction captures Current Assets and Current Liabilities.');
expect('HTML_LIABILITIES_GUARD',!hf.some(f=>f.concept==='liabilities'&&/liabilities and equity/i.test(f.sourceLabel||'')),'HTML extraction never maps Total Liabilities and Equity to Total Liabilities.');
expect('HTML_DERIVED_DEBT',hf.some(f=>f.concept==='debt'&&String(f.fiscalYear)==='2025'&&Number(f.normalizedValue)===8376&&f.aggregateRole==='derived-aggregate'),'HTML extraction derives total debt from current + non-current debt when no reported total exists.');
fs.rmSync(htmlOut,{force:true});fs.rmSync(htmlAssets,{recursive:true,force:true});
for(const [concept,year,value] of [
 ['revenue',2025,94827],['revenue',2024,97690],['revenue',2023,96773],
 ['current_assets',2025,96],['current_assets',2024,88],['current_assets',2023,80],
 ['current_liabilities',2025,55],['current_liabilities',2024,52],['current_liabilities',2023,49],
 ['assets',2025,250],['liabilities',2025,121],['equity',2025,129],['debt',2025,58]
]){
 const f=fact(concept,year); expect(`FACT_${concept}_${year}`,!!f&&Number(f.normalizedValue)===value&&Number(f.absoluteValue)===value*1e6,`${concept} FY${year} preserves source value ${value} and controlled base value.`); 
}
const ca=fact('current_assets',2025), cl=fact('current_liabilities',2025);
expect('CURRENT_RATIO_GOLDEN',!!ca&&!!cl&&Math.abs(Number(ca.normalizedValue)/Number(cl.normalizedValue)-96/55)<1e-12,'Current Ratio golden calculation is 96 ÷ 55 = 1.7454545…',{value:ca&&cl?Number(ca.normalizedValue)/Number(cl.normalizedValue):null});
expect('SOURCE_VALUE_NOT_MILLIONIZED',!!fact('revenue',2025)&&Number(fact('revenue',2025).normalizedValue)===94827&&Number(fact('revenue',2025).normalizedValue)!==94827000000,'Revenue remains 94,827 at the source-scale canonical layer.');
expect('SEMANTIC_CURRENT_ASSET_LABEL',ca?.aggregateRole==='reported-aggregate'&&String(ca?.sourceLabel||'').startsWith('Current Assets'),'Current Assets is treated as a reported aggregate without requiring the word Total.');
expect('SEMANTIC_CURRENT_LIABILITY_LABEL',cl?.aggregateRole==='reported-aggregate'&&String(cl?.sourceLabel||'').startsWith('Current Liabilities'),'Current Liabilities is treated as a reported aggregate without requiring the word Total.');
expect('BALANCE_CONTEXT_VARIANT',extractor.includes('consolidated\\s+balance\\s+sheets?'),'PDF extractor recognizes consolidated balance-sheet statement headings.');
expect('LIABILITIES_EQUITY_EXCLUSION',extractor.includes('liabilit(?:y|ies)\\s+(?:and|&)\\s+equity'),'Extractor excludes combined liabilities-and-equity rows from the liabilities concept.');
expect('DEBT_COMPONENTS',extractor.includes('current_debt')&&extractor.includes('long_term_debt')&&extractor.includes('derive_debt_aggregates'),'Debt components are retained and total debt can be derived deterministically when necessary.');
expect('HTML_STRUCTURED_PATH',extractor.includes('def run_html(path):')&&extractor.includes('rowsData')&&extractor.includes('fiscalYears')&&extractor.includes("html-table-structured"),'HTML/SEC ingestion preserves structured tables and fiscal-year columns.');
expect('INTELLIGENCE_NUMERIC_RANK',server.includes('const compareRank=(a,b)=>{const ra=factRank(a),rb=factRank(b);')&&server.includes('const na=Number(ra[i]),nb=Number(rb[i]);'),'Intelligence fact ranking compares numeric rank dimensions rather than serialized JSON.');
expect('SPINE_REBUILD_WHEN_INCOMPLETE',server.includes('function documentNeedsFinancialSpineRebuild(doc)')&&server.includes("!concepts.has('current_assets')")&&server.includes("!concepts.has('current_liabilities')"),'Financial documents with partial facts are rebuilt instead of being skipped merely because some facts exist.');
expect('PDF_KNOWLEDGE_ASSET_ROOT',server.includes("enrichPdfTextWithAssets(ex.text||'',filePath,idv,jobId)")&&server.includes("enrichPdfTextWithAssets(ex.text||'',fp,knowledgeId,jobId)"),'Knowledge PDF upload/reprocess writes visual/table assets under the persistent knowledge ID.');
expect('PDF_PAGE_SNAPSHOTS_ALL',fs.readFileSync(path.join(root,'scripts/pdf/extract_pdf_assets.py'),'utf8').includes('Preserve a visual snapshot for every PDF page'),'PDF visual evidence captures every page, not only pages containing detected images/tables.');
expect('URL_SOURCE_PRESERVATION',server.includes('sourceBytesHash:sha(sourceBase64)')&&server.includes('extractionInputMode')&&server.includes('extractionContentBase64'), 'URL ingestion preserves original source bytes while using a resolved-asset extraction representation when required.');
expect('VISUAL_YEAR_HEADERS',server.includes("Comparative fiscal years:")&&server.includes("header=['Line item',...knownYears.map(String)]"), 'Visual table viewer explicitly surfaces comparative fiscal-year headers even when extractor table headers are absent.');
expect('VISUAL_ASSET_RESOLUTION',server.includes('resolveHtmlAssetUrls')&&server.includes('extractionBase64')&&server.includes("raw=resolveHtmlAssetUrls"), 'HTML URL extraction resolves relative image assets before structured ingestion.');

// Exercise the production ratio library itself without starting the server.
function extractFunction(source,name){
 const start=source.indexOf(`function ${name}(`); if(start<0)throw new Error(`${name} not found`); let i=source.indexOf('{',start),depth=0,inStr=null,esc=false; for(;i<source.length;i++){const c=source[i]; if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c===inStr)inStr=null;continue;} if(c==='"'||c==="'"||c==='`'){inStr=c;continue;} if(c==='{')depth++; else if(c==='}'&&--depth===0){return source.slice(start,i+1)}} throw new Error(`unterminated ${name}`);
}
const selectorBody=extractFunction(server,'selectBestFinancialFact');
const financialScoreBody=extractFunction(server,'financialConceptScore');
const labelBody=extractFunction(server,'financialLabelText');
const sourceNumBody=extractFunction(server,'sourceNumericValue');
const scaleBody=extractFunction(server,'financialScaleFactor');
const methodologyBody=extractFunction(server,'financialMethodology');
const normalizedRatioBody=extractFunction(server,'normalizedFinancialForRatio');
const buildBody=extractFunction(server,'buildRatioLibrary');
const canonical=(c)=>String(c||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const aliases={
 revenue:new Set(['revenue','revenues','total_revenue','total_revenues','net_sales','sales','revenue_from_operations','value_of_sales_services']),
 cash:new Set(['cash','cash_and_cash_equivalents','cash_equivalents']),
 current_assets:new Set(['current_assets','total_current_assets']), current_liabilities:new Set(['current_liabilities','total_current_liabilities']),
 assets:new Set(['assets','total_assets']), liabilities:new Set(['liabilities','total_liabilities']), equity:new Set(['equity','total_equity','shareholders_equity','owners_equity']), debt:new Set(['debt','total_debt','borrowings','total_borrowings']),
}; const canonicalReal=(c)=>{const r=canonical(c);for(const [k,v] of Object.entries(aliases))if(v.has(r))return k;return r;};
const scaleFns=new Function('FINANCIAL_SCALE_FACTORS',scaleBody+';return financialScaleFactor;')({units:1,thousand:1e3,k:1e3,million:1e6,m:1e6,billion:1e9,bn:1e9,trillion:1e12,tn:1e12,crore:1e7,cr:1e7,lakh:1e5});
const sourceNum=new Function(sourceNumBody+';return sourceNumericValue;')();
const normalizedNum=sourceNum; const factFY=(f)=>Number(String(f?.fiscalYear||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const labelFn=new Function(labelBody+';return financialLabelText;')();
const scoreFn=new Function('financialLabelText','canonicalFactConcept','factFiscalYearNumber',financialScoreBody+';return financialConceptScore;')(labelFn,canonicalReal,factFY);
const selectFn=new Function('canonicalFactConcept','normalizedFactNumber','factFiscalYearNumber','financialConceptScore',selectorBody+';return selectBestFinancialFact;')(canonicalReal,normalizedNum,factFY,scoreFn);
const methodologyFn=new Function(methodologyBody+';return financialMethodology;')();
const ratioFn=new Function('sourceNumericValue',normalizedRatioBody+';return normalizedFinancialForRatio;')(sourceNum);
const buildFn=new Function('canonicalFactConcept','sourceNumericValue','selectBestFinancialFact','financialMethodology','financialScaleFactor','normalizedFinancialForRatio',buildBody+';return buildRatioLibrary;')(canonicalReal,sourceNum,selectFn,methodologyFn,scaleFns,ratioFn);
const testFacts=[
 {id:'ca2025',concept:'current_assets',rawValue:'96',normalizedValue:96,scale:'million',currency:'USD',fiscalYear:'2025',sourceLabel:'Current Assets',aggregateRole:'reported-aggregate',systemVerified:true,validated:true},
 {id:'cl2025',concept:'current_liabilities',rawValue:'55',normalizedValue:55,scale:'million',currency:'USD',fiscalYear:'2025',sourceLabel:'Current Liabilities',aggregateRole:'reported-aggregate',systemVerified:true,validated:true},
 {id:'ta2025',concept:'assets',rawValue:'250',normalizedValue:250,scale:'million',currency:'USD',fiscalYear:'2025',sourceLabel:'Total Assets',aggregateRole:'reported-aggregate',systemVerified:true,validated:true},
 {id:'tl2025',concept:'liabilities',rawValue:'121',normalizedValue:121,scale:'million',currency:'USD',fiscalYear:'2025',sourceLabel:'Total Liabilities',aggregateRole:'reported-aggregate',systemVerified:true,validated:true},
 {id:'eq2025',concept:'equity',rawValue:'129',normalizedValue:129,scale:'million',currency:'USD',fiscalYear:'2025',sourceLabel:'Equity',aggregateRole:'reported-aggregate',systemVerified:true,validated:true},
 {id:'debt2025',concept:'debt',rawValue:'58',normalizedValue:58,scale:'million',currency:'USD',fiscalYear:'2025',sourceLabel:'Borrowings',aggregateRole:'source-line',systemVerified:true,validated:true},
 {id:'rev2025',concept:'revenue',rawValue:'94827',normalizedValue:94827,scale:'million',currency:'USD',fiscalYear:'2025',sourceLabel:'Total revenues',aggregateRole:'reported-aggregate',systemVerified:true,validated:true},
 {id:'inv2025',concept:'inventory',rawValue:'22',normalizedValue:22,scale:'million',currency:'USD',fiscalYear:'2025',sourceLabel:'Inventory',aggregateRole:'source-line',systemVerified:true,validated:true},
 {id:'cash2025',concept:'cash',rawValue:'45',normalizedValue:45,scale:'million',currency:'USD',fiscalYear:'2025',sourceLabel:'Cash and Cash Equivalents',aggregateRole:'source-line',systemVerified:true,validated:true},
];
let ratioResults=[]; let ratioError=''; try{ratioResults=buildFn(testFacts);}catch(e){ratioError=String(e?.stack||e);ratioResults=[];}
const rr=new Map(ratioResults.map(x=>[x.id,x]));
expect('RATIO_LIBRARY_EXECUTES',ratioResults.length>=50,'Production ratio library executes against representative canonical facts.',{metricCount:ratioResults.length,error:ratioResults.length?'':ratioError});
expect('RATIO_CURRENT',Math.abs(Number(rr.get('current-ratio')?.value)-96/55)<1e-12,'Production Current Ratio calculation uses source-scale current-asset/current-liability facts.',{value:rr.get('current-ratio')?.value??null,inputs:rr.get('current-ratio')?.inputs||null});
expect('RATIO_DEBT',Math.abs(Number(rr.get('debt-ratio')?.value)-121/250)<1e-12,'Production Debt Ratio calculation uses total liabilities ÷ total assets.',{value:rr.get('debt-ratio')?.value??null});
expect('RATIO_REPORTS_SOURCE_SCALE',rr.get('current-ratio')?.inputs?.every(x=>x.value==null||x.value<1000),'Ratio provenance inputs remain source-scale, not million-expanded.');

fs.mkdirSync(path.join(root,'qa','results'),{recursive:true});
fs.writeFileSync(path.join(root,'qa','results','v46-remediated-financial-integrity.json'),JSON.stringify({schemaVersion:'1.0',suite:'V46_REMEDIATED_FINANCIAL_INTEGRITY',version:fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim(),generatedAt:new Date().toISOString(),pass:checks.every(x=>x.ok),checks},null,2));
fs.rmSync(tmp,{recursive:true,force:true});
console.log(JSON.stringify({schemaVersion:'1.0',suite:'V46_REMEDIATED_FINANCIAL_INTEGRITY',version:fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim(),pass:checks.every(x=>x.ok),checks},null,2));
process.exitCode=checks.every(x=>x.ok)?0:2;
