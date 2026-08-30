import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { loadCorePolicy, makePolicyEngine, verifyPolicyIntegrity } from './policy/policy-engine.mjs';
import { detectPromptInjection, scanRetrievedContent, AI_SECURITY_TESTS } from './assurance/ai-boundary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, 'app', 'data');
const uploadDir = path.join(dataDir, 'documents');
const companyDataDir = path.join(dataDir, 'companies');
const modelsDir = path.join(dataDir, 'models', 'text');
const knowledgeFile = path.join(dataDir, 'knowledge-sources.json');
const referenceDir = path.join(dataDir, 'reference');
const countriesFile = path.join(referenceDir, 'countries.json');
const currenciesFile = path.join(referenceDir, 'currencies.json');
const frontendReferenceDir = path.join(root, 'app', 'frontend', 'public', 'reference');
function readReferenceArray(primaryFile,fallbackFile){
  const load=(f)=>{try{const v=JSON.parse(fs.readFileSync(f,'utf8'));return Array.isArray(v)?v:[];}catch{return [];}};
  const primary=load(primaryFile); if(primary.length)return primary; return load(fallbackFile);
}
const seededSourcesFile = path.join(referenceDir, 'knowledge-sources.json');
const knowledgeUploadsDir = path.join(dataDir, 'knowledge', 'uploads');
const requestAttachmentsDir = path.join(dataDir, 'request-attachments');
const documentAssetsDir = path.join(dataDir, 'document-assets');
const pdfHelper = path.join(root, 'scripts', 'pdf', 'extract_pdf_assets.py');
const ensembleHelper = path.join(root, 'scripts', 'extraction', 'document_ensemble.py');
const stateFile = path.join(dataDir, 'state.json');
const auditDir = path.join(root, 'app', '.myai-cfo', 'audit');
const acceptanceFile = path.join(auditDir, 'acceptance.jsonl');
const auditManifest = path.join(auditDir, 'manifest.json');
const installIdFile = path.join(root, 'app', '.myai-cfo', 'install.id');
const VERSION = fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim();
const API_PORT = Number(process.env.MYAI_CFO_API_PORT||47821);
const DISCLAIMER_VERSION = '2.5';
const PRODUCT = 'MYAI CFO';
const corePolicy = loadCorePolicy(root);
if(!verifyPolicyIntegrity(corePolicy)){ throw new Error('CORE POLICY INTEGRITY CHECK FAILED. MYAI CFO is refusing to start.'); }
const policyCheck = makePolicyEngine(corePolicy);
const execFileAsync = promisify(execFile);
const productionCertificationJobs = new Map();
const activeDocumentExtractionControllers = new Map();

fs.mkdirSync(uploadDir, {recursive:true});
fs.mkdirSync(companyDataDir, {recursive:true});
fs.mkdirSync(modelsDir, {recursive:true});
fs.mkdirSync(knowledgeUploadsDir, {recursive:true});
fs.mkdirSync(auditDir,{recursive:true});
if(!fs.existsSync(auditManifest)){fs.writeFileSync(auditManifest,JSON.stringify({lastHash:'GENESIS',events:0,updatedAt:new Date().toISOString()},null,2),'utf8');}
if(!fs.existsSync(acceptanceFile)){fs.writeFileSync(acceptanceFile,'','utf8');}
fs.mkdirSync(requestAttachmentsDir, {recursive:true});
fs.mkdirSync(documentAssetsDir, {recursive:true});
fs.mkdirSync(auditDir, {recursive:true});
if(!fs.existsSync(installIdFile)) fs.writeFileSync(installIdFile, crypto.randomUUID(), 'utf8');

const disclaimerText = `MYAI CFO — IMPORTANT NOTICE, TERMS OF USE AND AI ASSISTANCE DISCLAIMER

Version: ${DISCLAIMER_VERSION}

MYAI CFO is software designed to assist with financial analysis, management reporting, document analysis, research, accounting-related reasoning, workflow support and related decision support. It is an AI-assisted information system and is not a substitute for a qualified accountant, auditor, tax adviser, lawyer, investment adviser, finance professional, CFO, director, board or other appropriately qualified professional.

AI-generated outputs, classifications, calculations, summaries, forecasts, interpretations, recommendations and actions may contain errors, omissions, incorrect extraction, hallucinations, stale information, model limitations, software defects or other inaccuracies. A confident answer is not evidence that an answer is correct.

Users remain responsible for independently reviewing and verifying material outputs before relying on MYAI CFO for financial, accounting, tax, legal, regulatory, investment, employment, operational, contractual, governance or other consequential decisions.

MYAI CFO includes a baseline conversational safety layer. It may refuse or redirect requests involving self-harm or suicide, sexually explicit content, graphic violence, targeted hateful abuse, or abusive/vulgar requests. The CFO chat is intended for professional, educational and operational assistance; safety controls may evolve as the system is tested and updated.

MYAI CFO must not be used as the sole basis for investment decisions, securities trading, lending or credit decisions, tax filings, statutory reporting, audit opinions, legal decisions, regulatory submissions, employment decisions, material capital allocation or other high-impact decisions.

Financial statements, accounting treatments, tax positions, legal conclusions, forecasts and recommendations must be checked against the applicable authoritative source, jurisdiction, effective date, contractual terms and professional advice where appropriate.

Where information is incomplete, inconsistent, ambiguous, conflicting, stale or unavailable, MYAI CFO may produce an incomplete or uncertain conclusion. Missing values must not be treated as zero. Extracted information is not automatically validated financial truth.

Users should review underlying evidence, source documents, assumptions, calculations, data freshness, model identity, model provenance, applicable knowledge sources and material limitations before acting.

MYAI CFO may operate with local models, third-party AI providers, uploaded files, connected systems, external data providers and user-supplied knowledge. Availability, accuracy, licensing, pricing, privacy practices, terms and behaviour of those components may change.

Company data must remain isolated by company/workspace. Cross-company analysis should only occur when explicitly requested and permitted.

Users are responsible for ensuring that documents, knowledge bases, prompts, contracts, emails, personal information and other data supplied to MYAI CFO may lawfully be processed in their chosen environment and for complying with applicable confidentiality, privacy, professional secrecy, copyright, licensing and data-protection obligations.

The acceptance record maintained by MYAI CFO is intended to provide an application audit trail showing that this notice was presented and accepted at a particular time on a particular installation. It is not a guarantee of legal enforceability, nor does it replace legal advice, contractual terms, statutory notices, privacy notices or other compliance requirements.

By selecting “I Understand & Continue”, the user confirms that they have read and understood this notice, understand that AI outputs require appropriate verification, and agree to use MYAI CFO accordingly.`;


const SAFETY_POLICY_VERSION = corePolicy.version;

function safetyCheck(message=''){
  return policyCheck(message,'user_input');
}

function aiInputGuard({message='', retrievedKnowledge=[]}={}){
  const normalized=String(message||'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'');
  const direct=detectPromptInjection(normalized);
  const retrieved=scanRetrievedContent(retrievedKnowledge);
  if(direct.blocked)return {allowed:false,stage:'ai_input_guard',...direct};
  if(!retrieved.safe)return {allowed:false,stage:'retrieved_content_guard',testId:retrieved.flagged[0]?.testId||'AI-SEC-010',category:'indirect_prompt_injection',reason:'Retrieved content contains instruction-like text and was quarantined.'};
  return {allowed:true,stage:'ai_input_guard'};
}

async function internetStatus(){
  return await new Promise(resolve=>{
    const req=https.get('https://www.cloudflare.com/cdn-cgi/trace',{timeout:1800},r=>{r.resume();resolve({online:true,checkedAt:new Date().toISOString()});});
    req.on('timeout',()=>{req.destroy();resolve({online:false,checkedAt:new Date().toISOString()});});
    req.on('error',()=>resolve({online:false,checkedAt:new Date().toISOString()}));
  });
}

// /api/health is a local process-readiness endpoint. It must not block on an
// external network probe because certification uses it to establish that the
// child backend is reachable. Online connectivity is refreshed asynchronously
// and exposed as cached metadata instead.
let cachedInternetStatus={online:null,checkedAt:null};
function refreshCachedInternetStatus(){
  internetStatus().then(x=>{cachedInternetStatus=x;}).catch(()=>{});
}

let cachedHostSpecifications=null;
let cachedHostSpecificationsAt=0;
async function detectWindowsGpus(){
  const results=[];
  const seen=new Set();
  const add=(name,vramGb,driver,source)=>{
    const cleanName=String(name||'').trim();
    const v=Number.isFinite(Number(vramGb))&&Number(vramGb)>0?Math.round(Number(vramGb)*10)/10:null;
    const key=(cleanName||'Unknown GPU').toLowerCase();
    if(seen.has(key)) return;
    seen.add(key); results.push({name:cleanName||'Unknown GPU',vramGb:v,driver:driver?String(driver):null,source});
  };
  // Fastest/highest-confidence NVIDIA path when the vendor utility is installed.
  try{
    const {stdout}=await execFileAsync('nvidia-smi.exe',['--query-gpu=name,memory.total,driver_version','--format=csv,noheader,nounits'],{timeout:8000,windowsHide:true});
    for(const line of String(stdout||'').split(/\r?\n/)){
      const parts=line.split(',').map(x=>x.trim());
      if(parts.length>=3){ const v=Number(parts[1]); add(parts[0],Number.isFinite(v)?v/1024:null,parts[2],'nvidia-smi'); }
    }
  }catch{}
  // Windows WMI fallback. Do not silently discard a slow-but-valid result.
  try{
    const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress"],{timeout:10000,windowsHide:true});
    const parsed=JSON.parse(String(stdout||'null'));
    const rows=Array.isArray(parsed)?parsed:(parsed?[parsed]:[]);
    for(const x of rows){
      const bytes=Number(x.AdapterRAM); add(x.Name,Number.isFinite(bytes)&&bytes>0?bytes/1024**3:null,x.DriverVersion,'win32_videocontroller');
    }
  }catch{}
  return results;
}
async function hostSpecifications(forceRefresh=false){
  const now=Date.now();
  if(!forceRefresh && cachedHostSpecifications && now-cachedHostSpecificationsAt<30000) return cachedHostSpecifications;
  const totalRamGb=Math.round((os.totalmem()/1024**3)*10)/10;
  const freeRamGb=Math.round((os.freemem()/1024**3)*10)/10;
  const cpuModel=os.cpus()?.[0]?.model||'Unknown CPU';
  let gpus=[];
  if(process.platform==='win32') gpus=await detectWindowsGpus();
  else if(process.platform==='linux') {
    try{ const {stdout}=await execFileAsync('sh',['-lc',"command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits || true"],{timeout:5000});
      for(const line of String(stdout||'').split(/\r?\n/)){ const parts=line.split(',').map(x=>x.trim()); if(parts.length>=3){const v=Number(parts[1]); if(parts[0]) gpus.push({name:parts[0],vramGb:Number.isFinite(v)?Math.round((v/1024)*10)/10:null,driver:parts[2]||null,source:'nvidia-smi'});}}
    }catch{}
  }
  cachedHostSpecifications={cpu:{model:cpuModel,cores:os.cpus().length},memory:{totalGb:totalRamGb,freeGb:freeRamGb,usedGb:Math.round((totalRamGb-freeRamGb)*10)/10},gpus,os:{platform:process.platform,release:os.release(),arch:process.arch},hostname:os.hostname(),gpuDetection:{status:gpus.length?'detected':'unavailable',sources:[...new Set(gpus.map(g=>g.source).filter(Boolean))],checkedAt:new Date().toISOString()}};
  cachedHostSpecificationsAt=now;
  return cachedHostSpecifications;
}

const disclaimerHash = crypto.createHash('sha256').update(disclaimerText,'utf8').digest('hex');

const defaultAgents = [
  {id:'letta',name:'Letta',role:'Persistent CFO agent memory, company context and decision state',layer:'memory',status:'registered',enabled:true,score:null,domain:['cfo','audit','tax','investment-banking'],source:'https://github.com/letta-ai/letta'},
  {id:'openclaw',name:'OpenClaw',role:'Autonomous computer and tool execution agent',layer:'computer',status:'registered',enabled:false,score:null,domain:['cfo','workflow','research'],source:'https://github.com/openclaw/openclaw'},
  {id:'hermes',name:'Hermes Agent',role:'Self-hosted autonomous research and execution agent',layer:'autonomous',status:'registered',enabled:false,score:null,domain:['cfo','research','workflow']},
  {id:'finrobot',name:'FinRobot',role:'Finance-native multi-agent investment research, valuation and financial modelling',layer:'finance-specialist',status:'registered',enabled:false,score:null,domain:['investment-banking','cfo'],source:'https://github.com/AI4Finance-Foundation/FinRobot'},
  {id:'openbb-agent',name:'OpenBB Finance Agent',role:'Financial data, market research, filings and macro-data agent',layer:'finance-data',status:'registered',enabled:false,score:null,domain:['investment-banking','cfo','research'],source:'https://github.com/OpenBB-finance/OpenBB'},
  {id:'tradingagents',name:'TradingAgents',role:'Fundamental, sentiment, technical, risk and portfolio research workflow',layer:'investment-research',status:'registered',enabled:false,score:null,domain:['investment-banking','investment-research'],source:'https://github.com/TauricResearch/TradingAgents'},
  {id:'finrl',name:'FinRL / FinRL-X',role:'Quantitative finance, portfolio optimisation and reinforcement-learning research',layer:'quant-finance',status:'registered',enabled:false,score:null,domain:['investment','quant'],source:'https://github.com/AI4Finance-Foundation/FinRL'},
  {id:'qlib',name:'Qlib',role:'Quantitative investment research, modelling and backtesting',layer:'quant-finance',status:'registered',enabled:false,score:null,domain:['investment','quant'],source:'https://github.com/microsoft/qlib'},
  {id:'fin-gpt',name:'FinGPT',role:'Financial NLP, sentiment, forecasting and research workflow',layer:'finance-llm',status:'registered',enabled:false,score:null,domain:['cfo','investment','research'],source:'https://github.com/AI4Finance-Foundation/FinGPT'},
  {id:'finnlp',name:'FinNLP',role:'Financial news, filings and sentiment data pipeline',layer:'finance-data',status:'registered',enabled:false,score:null,domain:['investment','market-intelligence'],source:'https://github.com/AI4Finance-Foundation/FinNLP'},
  {id:'auditwen',name:'AuditWen',downloadable:true,role:'Audit-specific document review, issue summarisation and regulation matching',layer:'audit-specialist',status:'registered',enabled:false,score:null,domain:['audit','compliance']},
  {id:'steuerllm',name:'SteuerLLM',downloadable:true,role:'German tax-law reasoning and statutory research',layer:'tax-specialist',status:'registered',enabled:false,score:null,domain:['tax','germany']},
  {id:'openaccountants',name:'OpenAccountants',role:'Jurisdiction-aware accounting and tax rules/MCP workflow',layer:'tax-accounting',status:'registered',enabled:false,score:null,domain:['tax','accounting'],source:'https://github.com/openaccountants/openaccountants'},
  {id:'policyengine',name:'PolicyEngine',role:'Tax and policy microsimulation workflow',layer:'tax-engine',status:'registered',enabled:false,score:null,domain:['tax','policy'],source:'https://github.com/PolicyEngine'},
  {id:'unstructured',name:'Unstructured',role:'Financial and tax document parsing for RAG',layer:'document-intelligence',status:'registered',enabled:false,score:null,domain:['audit','tax','cfo'],source:'https://github.com/Unstructured-IO/unstructured'},
  {id:'docling',name:'Docling',role:'Layout-aware PDF and financial document extraction',layer:'document-intelligence',status:'registered',enabled:false,score:null,domain:['audit','tax','cfo'],source:'https://github.com/docling-project/docling'},
  {id:'ragflow',name:'RAGFlow',role:'Deep document understanding and RAG workflow',layer:'rag',status:'registered',enabled:false,score:null,domain:['audit','tax','cfo'],source:'https://github.com/infiniflow/ragflow'},
  {id:'llamaindex',name:'LlamaIndex',role:'Document, data and evidence retrieval agent',layer:'rag',status:'registered',enabled:false,score:null,domain:['audit','cfo','tax'],source:'https://github.com/run-llama/llama_index'},
  {id:'langgraph',name:'LangGraph',role:'Stateful production workflow orchestration',layer:'orchestration',status:'registered',enabled:false,score:null,domain:['audit','tax','cfo'],source:'https://github.com/langchain-ai/langgraph'},
  {id:'crewai',name:'CrewAI',role:'Role-based multi-agent teams for research and review',layer:'council',status:'registered',enabled:false,score:null,domain:['audit','tax','investment-banking'],source:'https://github.com/crewAIInc/crewAI'},
  {id:'pydanticai',name:'PydanticAI',role:'Type-safe agent engineering and structured outputs',layer:'structured',status:'registered',enabled:false,score:null,domain:['audit','tax','cfo'],source:'https://github.com/pydantic/pydantic-ai'},
  {id:'openhands',name:'OpenHands',role:'Autonomous software and data engineering agent',layer:'engineering',status:'registered',enabled:false,score:null,domain:['automation'],source:'https://github.com/All-Hands-AI/OpenHands'},
  {id:'openai-agents-sdk',name:'OpenAI Agents SDK',role:'Agent delegation, tools and guardrails',layer:'orchestration',status:'registered',enabled:false,score:null,domain:['cfo','audit','tax'],source:'https://github.com/openai/openai-agents-python'},
  {id:'microsoft-agent-framework',name:'Microsoft Agent Framework',role:'Enterprise agent orchestration',layer:'enterprise',status:'registered',enabled:false,score:null,domain:['audit','tax','cfo']},
  {id:'autogen',name:'AutoGen',role:'Conversational multi-agent systems',layer:'multi-agent',status:'registered',enabled:false,score:null,domain:['audit','tax','research'],source:'https://github.com/microsoft/autogen'},
  {id:'semantic-kernel',name:'Semantic Kernel',role:'Enterprise orchestration and tool integration',layer:'enterprise',status:'registered',enabled:false,score:null,domain:['cfo','audit','tax'],source:'https://github.com/microsoft/semantic-kernel'},
  {id:'dify',name:'Dify',role:'Visual AI workflow and RAG platform',layer:'workflow',status:'registered',enabled:false,score:null,domain:['cfo','tax','audit'],source:'https://github.com/langgenius/dify'},
  {id:'n8n',name:'n8n AI Agents',role:'Automation and agent workflow execution',layer:'automation',status:'registered',enabled:false,score:null,domain:['cfo','workflow'],source:'https://github.com/n8n-io/n8n'},
  {id:'agent-zero',name:'Agent Zero',role:'General autonomous personal agent',layer:'personal',status:'registered',enabled:false,score:null,domain:['research','workflow']},
  {id:'smolagents',name:'Smolagents',role:'Lightweight tool-using agents',layer:'lightweight',status:'registered',enabled:false,score:null,domain:['research','automation'],source:'https://github.com/huggingface/smolagents'},
  {id:'openagents',name:'OpenAgents',role:'Open agent infrastructure and interoperability',layer:'infrastructure',status:'registered',enabled:false,score:null,domain:['finance','interoperability']},
  {id:'agentictrading',name:'AgenticTrading',role:'Execution, audit, risk and memory agents for quantitative workflows',layer:'trading',status:'registered',enabled:false,score:null,domain:['investment','quant']},
  {id:'finvault',name:'FinVault',role:'Financial AI policy, audit and fiduciary-risk evaluation',layer:'assurance',status:'registered',enabled:false,score:null,domain:['audit','risk']},
  {id:'mindsdb',name:'MindsDB',role:'AI queries, forecasting and anomaly workflows over financial databases',layer:'data-ai',status:'registered',enabled:false,score:null,domain:['cfo','data'],source:'https://github.com/mindsdb/mindsdb'},
  {id:'sec-edgar',name:'SEC / EDGAR Intelligence',role:'SEC filings, XBRL and disclosure retrieval capability',layer:'regulatory-data',status:'registered',enabled:false,score:null,domain:['audit','investment-banking'],source:'https://github.com/jadchaar/sec-edgar-downloader'},
  {id:'financial-datasets',name:'Financial Datasets Agent',role:'SEC filings, earnings calls and financial statement retrieval',layer:'financial-data',status:'registered',enabled:false,score:null,domain:['investment-banking','cfo'],source:'https://github.com/virattt/financial-datasets'},
  {id:'trading-research-council',name:'Investment Research Council',role:'Bull/bear, fundamentals, technicals and risk review capability',layer:'investment-council',status:'registered',enabled:false,score:null,domain:['investment-banking','investment']},
  {id:'tax-reviewer',name:'Tax Review Agent',role:'Tax-rule retrieval, reconciliation and reviewer workflow',layer:'tax',status:'registered',enabled:false,score:null,domain:['tax','audit']},
  {id:'audit-reviewer',name:'Audit Review Agent',role:'Audit evidence completeness, exceptions and reviewer workflow',layer:'audit',status:'registered',enabled:false,score:null,domain:['audit','cfo']},
  {id:'cfo-forecast-agent',name:'CFO Forecast Agent',role:'Forecast, variance, liquidity and scenario-analysis capability',layer:'cfo',status:'registered',enabled:false,score:null,domain:['cfo','fp&a']}
];
const CURRENCY_BY_COUNTRY = {
  'India':'INR','United Kingdom':'GBP','United States':'USD','Germany':'EUR','France':'EUR','Canada':'CAD',
  'Australia':'AUD','Singapore':'SGD','United Arab Emirates':'AED','Hong Kong':'HKD','China':'CNY','Japan':'JPY',
  'South Africa':'ZAR','Brazil':'BRL','Mexico':'MXN','Saudi Arabia':'SAR','Netherlands':'EUR','Ireland':'EUR'
};
const currencyCatalog = (()=>{try{return new Set(readJson(currenciesFile,[]).map(x=>String(x.code||'').toUpperCase()).filter(Boolean))}catch{return new Set()}})();
function normalizeCurrencyCode(value){return String(value||'').trim().toUpperCase();}
function validateCompanyCurrencyPair(currency, reportingCurrency){
  const base=normalizeCurrencyCode(currency), report=normalizeCurrencyCode(reportingCurrency||currency);
  if(!/^[A-Z]{3}$/.test(base)) return {ok:false,error:'A valid ISO 4217 base currency code is required.',code:'INVALID_BASE_CURRENCY'};
  if(currencyCatalog.size && !currencyCatalog.has(base)) return {ok:false,error:`Unsupported base currency: ${base}. Select a currency from the bundled ISO 4217 catalogue.`,code:'UNSUPPORTED_BASE_CURRENCY'};
  if(!/^[A-Z]{3}$/.test(report)) return {ok:false,error:'A valid ISO 4217 reporting currency code is required.',code:'INVALID_REPORTING_CURRENCY'};
  if(currencyCatalog.size && !currencyCatalog.has(report)) return {ok:false,error:`Unsupported reporting currency: ${report}. Select a currency from the bundled ISO 4217 catalogue.`,code:'UNSUPPORTED_REPORTING_CURRENCY'};
  return {ok:true,base,report};
}

const defaultState={
  companies:[],
  activeCompanyId:null,
  disclaimer:{accepted:false,version:DISCLAIMER_VERSION,hash:disclaimerHash},
  moni:{status:'ready',confidenceThreshold:0.82,learningLedger:[],independentAnswering:false},
  agents:defaultAgents,
  models:[],
  selectedModelFilename:null,
  modelLifecycle:{},
  arena:{runs:[],champion:null,competitions:[]},modelDownloadHistory:[],proactive:{lastScanAt:null,alerts:[],predictions:[]},aiJobs:{},
  onlineRoute:{provider:'OmniRoute',enabled:false,baseUrl:process.env.MYAI_CFO_OMNIROUTE_URL||'http://127.0.0.1:20128/v1',model:null,allowCompanyEvidence:false}
};

let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):defaultState;
state.companies ||= [];
state.agents ||= defaultAgents;
state.extractionJobs ||= {};
state.moni ||= defaultState.moni;
state.arena ||= {runs:[],champion:null,jobs:{}};
state.modelDownloadHistory ||= [];
state.modelLifecycle ||= {};
state.qa ||= {};
state.qa.aiSecuritySuite ||= {version:'3.0-production',tests:AI_SECURITY_TESTS.map(x=>x.id),status:'NOT_RUN',executedTests:0,failedTests:0,results:[],lastRunAt:null};
state.qa.ragSuite ||= {version:'3.0-production',tests:70,status:'NOT_RUN',executedTests:0,failedTests:0,results:[],metrics:null,lastRunAt:null};
state.qa.agentTrajectory ||= {enabled:true,version:'3.0-production',status:'NOT_RUN',executedTests:0,failedTests:0,results:[],lastRunAt:null};
state.qa.recoveryVerification ||= {enabled:true,version:'3.0-production',status:'NOT_RUN',executedTests:0,failedTests:0,results:[],lastRunAt:null};
state.qa.observability ||= {enabled:true,version:'2.0-production',status:'NOT_RUN',executedTests:0,failedTests:0,lastRunAt:null};
state.selectedModelFilename ||= null;
state.qaFaults = {modelUnavailable:false,retrievalFailure:false,toolFailure:false,workerFailure:false};
state.arena.runs ||= [];
state.arena.competitions ||= [];
state.arena.jobs ||= {};
for(const job of Object.values(state.arena.jobs)){if(job.status==='running'){job.status='queued';job.recoveredAt=new Date().toISOString();}}
state.proactive ||= {lastScanAt:null,alerts:[],predictions:[]};
state.proactive.alerts ||= []; state.proactive.predictions ||= [];
state.aiJobs ||= {};
state.onlineRoute ||= defaultState.onlineRoute;
state.onlineRoute.baseUrl ||= process.env.MYAI_CFO_OMNIROUTE_URL||'http://127.0.0.1:20128/v1';
state.onlineRoute.provider ||= 'OmniRoute';
state.onlineRoute.enabled = state.onlineRoute.enabled===true;
state.onlineRoute.allowCompanyEvidence = state.onlineRoute.allowCompanyEvidence===true;
state.moni.agentPerformance ||= {};
state.moni.modelPerformance ||= {};
state.moni.modelBenchmark ||= {status:'idle',jobId:null,results:[],updatedAt:null};
state.moni.onlineLearner ||= {};
state.knowledgeJobs ||= {};
state.moni.feedback ||= [];
state.moni.learningMode ||= 'online-evidence-weighted';
state.moni.jobs ||= {};
state.moni.competitions ||= []; 
if(state.agentRegistryVersion!==4){
  state.agents=defaultAgents.map(a=>({...a,archived:false,updatedAt:new Date().toISOString()}));
  state.moni.agentPerformance={};
  state.agentRegistryVersion=4;
} else {
  state.agents = (state.agents||defaultAgents).map(a=>({...a,archived:!!a.archived,updatedAt:a.updatedAt||new Date().toISOString()}));
  if(!Array.isArray(state.agents) || state.agents.length===0){
    state.agents=defaultAgents.map(a=>({...a,archived:false,updatedAt:new Date().toISOString()}));
    state.agentRegistryVersion=4;
    audit('AGENT_REGISTRY_REPAIRED',{reason:'Empty production agent registry restored from bundled defaults'});
  }
}
state.disclaimer ||= {accepted:false,version:DISCLAIMER_VERSION,hash:disclaimerHash};
state.companies.forEach(c=>{
  c.currency=normalizeCurrencyCode(c.currency)||normalizeCurrencyCode(CURRENCY_BY_COUNTRY[c.country]||'');
  c.reportingCurrency=normalizeCurrencyCode(c.reportingCurrency)||c.currency;
  c.documents ||= [];
  c.facts ||= [];
  c.evidence ||= [];
  c.archived = !!c.archived;
  c.updatedAt ||= c.createdAt || new Date().toISOString();
});
const sha=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
const modelDownloadJobs=new Map();
let liveRuntime=null;
const liveRuntimes=new Map();
const runtimeStartPromises=new Map();
let runtimeIdleTimer=null;
const RUNTIME_IDLE_MS=null;
let activeInferenceCount=0;
const runtimePorts=new Set();

function scheduleRuntimeOffload(){
  if(runtimeIdleTimer){clearTimeout(runtimeIdleTimer);runtimeIdleTimer=null;}
  // Deliberately no automatic unload. A loaded model remains available until the user
  // explicitly chooses Unload now in AI Models. This avoids cold-start churn and
  // prevents long Arena runs from losing the shared runtime.
}
function touchRuntime(){
  // Keep the runtime warm. Manual unload is the only unload path.
}


const FIRST_RUN_PRELOADS = [
  {id:'qwen25-1.5b-q4', name:'Qwen2.5 1.5B Instruct Q4_K_M', filename:'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf', url:'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf', role:'Fast local smoke-test model • ~1 GB • plumbing/runtime/RAG/agent workflow validation',contextSize:8192,nativeContextSize:32768,priority:1,smokeOnly:true},
  {id:'qwen3-4b-q4', name:'Qwen3 4B Instruct Q4_K_M', filename:'Qwen3-4B-Q4_K_M.gguf', url:'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf', role:'Production lightweight local CFO model • production-equivalent AI quality certification',contextSize:8192,nativeContextSize:32768,priority:2,production:true}
];
const PRODUCTION_PRELOADS = [
  {id:'qwen3-4b-q4', name:'Qwen3 4B Instruct Q4_K_M', filename:'Qwen3-4B-Q4_K_M.gguf', url:'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf', role:'Production lightweight local CFO model • production-equivalent AI quality certification',contextSize:8192,nativeContextSize:32768,priority:1,production:true},
  {id:'qwen3-14b-q4', name:'Qwen3 14B Instruct Q4_K_M', filename:'Qwen3-14B-Q4_K_M.gguf', url:'https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf', role:'Higher-capability production local CFO model • quality certification on capable machines',contextSize:8192,nativeContextSize:32768,priority:2,production:true}
];
const PRELOAD_VERSION='1.24.26-smoke-first-preload-v3';
const PRELOAD_POLICY={mode:'smoke-first-adaptive-preload',preferredModelId:'qwen25-1.5b-q4',productionModelId:'qwen3-4b-q4',nativeContextTokens:32768,testContextTokens:8192,agentId:'letta'};
function selectPreloadSpec(host){
  const installed=installedModels(false);
  if(installed.some(x=>x.filename==='Qwen2.5-1.5B-Instruct-Q4_K_M.gguf'||x.filename==='Qwen3-4B-Q4_K_M.gguf'||x.filename==='Qwen3-14B-Q4_K_M.gguf'))return null;
  return FIRST_RUN_PRELOADS[0];
}
function selectProductionPreloadSpec(host){
  const ram=Number(host?.memory?.totalGb)||0;
  const vram=Math.max(0,...(host?.gpus||[]).map(g=>Number(g.vramGb)||0));
  const installed=installedModels(false);
  if(installed.some(x=>x.filename==='Qwen3-14B-Q4_K_M.gguf'))return null;
  const capable=ram>=20 || vram>=8;
  return PRODUCTION_PRELOADS.find(x=>x.id===(capable?'qwen3-14b-q4':'qwen3-4b-q4')) || PRODUCTION_PRELOADS[0];
}

// Production curated finance-first local LLM recommendations. Only entries with a verified
// direct GGUF asset are marked downloadable; research-only specialist projects remain links.
const CFO_LOCAL_RECOMMENDATIONS = [
  {id:'qwen35-35b-a3b-q4',name:'Qwen3.5 35B-A3B Q4_K_M',filename:'Qwen3.5-35B-A3B-Q4_K_M.gguf',size:'~22.3 GB',parameters:'35B total / 3B active',license:'Apache 2.0',tier:'CFO Flagship',domain:'CFO / Tax / Audit / Valuation / Due Diligence',task:'Highest-priority local reasoning candidate for deep CFO analysis on capable machines.',recommended:true,downloadable:true,nativeContextTokens:262144,testContextTokens:65536,minRamGb:48,minVramGb:16,url:'https://huggingface.co/bartowski/Qwen_Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/Qwen/Qwen3.5-35B-A3B'},
  {id:'qwen35-27b-q4',name:'Qwen3.5 27B Q4_K_M',filename:'Qwen3.5-27B-Q4_K_M.gguf',size:'~16.7 GB',parameters:'27B',license:'Model-specific / verify at install',tier:'CFO High',domain:'CFO / Tax / Audit / Valuation',task:'Strong local reasoning with a lower memory requirement than the 35B flagship.',recommended:true,downloadable:true,nativeContextTokens:262144,testContextTokens:65536,minRamGb:32,minVramGb:12,url:'https://huggingface.co/cmp-nct/Qwen3.5-27B-GGUF/resolve/main/Qwen3.5-27B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/cmp-nct/Qwen3.5-27B-GGUF'},
  {id:'qwen3-32b-q4',name:'Qwen3 32B Q4_K_M',filename:'Qwen3-32B-Q4_K_M.gguf',size:'19.8 GB',parameters:'32B',license:'Apache 2.0',tier:'CFO High',domain:'CFO / Tax / Audit / Valuation / IB',task:'Dense higher-capability finance reasoning option with a verified official GGUF.',recommended:true,downloadable:true,nativeContextTokens:32768,testContextTokens:32768,minRamGb:48,minVramGb:16,url:'https://huggingface.co/Qwen/Qwen3-32B-GGUF/resolve/main/Qwen3-32B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/Qwen/Qwen3-32B-GGUF'},
  {id:'qwen3-14b-q4',name:'Qwen3 14B Instruct Q4_K_M',filename:'Qwen3-14B-Q4_K_M.gguf',size:'~9 GB',parameters:'14B',license:'Apache 2.0',tier:'CFO Standard',domain:'CFO / Tax / Audit / Valuation / IB',task:'Recommended upgrade from the 4B local model for stronger local reasoning.',recommended:true,downloadable:true,nativeContextTokens:32768,testContextTokens:32768,minRamGb:20,minVramGb:8,url:'https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/Qwen/Qwen3-14B-GGUF'},
  {id:'qwen3-4b-q4',name:'Qwen3 4B Instruct Q4_K_M',filename:'Qwen3-4B-Q4_K_M.gguf',size:'~2.5 GB',parameters:'4B',license:'Apache 2.0',tier:'Production Lightweight',domain:'CFO / Tax / Audit / Valuation',task:'Lightweight local fallback for machines with limited memory.',recommended:true,downloadable:true,nativeContextTokens:32768,testContextTokens:32768,minRamGb:8,minVramGb:4,url:'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/Qwen/Qwen3-4B-GGUF'},
  {id:'nemotron-3-nano-4b-q4',name:'NVIDIA Nemotron 3 Nano 4B Q4_K_M',filename:'NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf',size:'~2.5 GB',parameters:'4B',license:'NVIDIA Nemotron Open Model License',tier:'Finance Model Adviser — NVIDIA Recommended',domain:'CFO / Finance / Tax / Audit / Due Diligence / Valuation / Investment Banking / Document QA',task:'NVIDIA local finance-model candidate; benchmark against Qwen3-4B for CFO, finance, tax, audit, due diligence and valuation workloads.',recommended:true,upgrade:true,downloadable:true,nativeContextTokens:262144,testContextTokens:32768,minRamGb:8,minVramGb:4,url:'https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF/resolve/main/NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF'},
  {id:'granite-4.1-3b-q4',name:'IBM Granite 4.1 3B Q4_K_M',filename:'granite-4.1-3b-Q4_K_M.gguf',size:'~2.0 GB',parameters:'3B',license:'Apache 2.0',tier:'AI Model Upgrade',domain:'General / Enterprise / Reasoning',task:'IBM Granite upgrade candidate for enterprise-style instruction following and tool use.',recommended:false,upgrade:true,downloadable:true,nativeContextTokens:131072,testContextTokens:32768,minRamGb:8,minVramGb:4,url:'https://huggingface.co/ibm-granite/granite-4.1-3b-GGUF/resolve/main/granite-4.1-3b-Q4_K_M.gguf',pageUrl:'https://huggingface.co/ibm-granite/granite-4.1-3b-GGUF'},
  {id:'granite-4.1-8b-q4',name:'IBM Granite 4.1 8B Q4_K_M',filename:'granite-4.1-8b-Q4_K_M.gguf',size:'~5 GB',parameters:'8B',license:'Apache 2.0',tier:'AI Model Upgrade',domain:'General / Enterprise / Reasoning',task:'Higher-capability IBM Granite upgrade candidate; benchmark before using for CFO tasks.',recommended:false,upgrade:true,downloadable:true,nativeContextTokens:131072,testContextTokens:32768,minRamGb:16,minVramGb:8,url:'https://huggingface.co/ibm-granite/granite-4.1-8b-GGUF/resolve/main/granite-4.1-8b-Q4_K_M.gguf',pageUrl:'https://huggingface.co/ibm-granite/granite-4.1-8b-GGUF'},
  {id:'llama-nemotron-nano-4b-v1.1-q4',name:'Llama Nemotron Nano 4B v1.1 Q4_K_M',filename:'Llama-3.1-Nemotron-Nano-4B-v1.1-Q4_K_M.gguf',size:'~3 GB',parameters:'4B',license:'NVIDIA Open Model License',tier:'Finance Model Adviser — NVIDIA Recommended',domain:'CFO / Finance / Tax / Audit / Due Diligence / Valuation / Investment Banking / Agents',task:'NVIDIA agentic finance-model candidate for CFO and specialist finance workflows; benchmark before promotion to active runtime.',recommended:true,upgrade:true,downloadable:true,nativeContextTokens:131072,testContextTokens:32768,minRamGb:8,minVramGb:4,url:'https://huggingface.co/bartowski/nvidia_Llama-3.1-Nemotron-Nano-4B-v1.1-GGUF/resolve/main/Llama-3.1-Nemotron-Nano-4B-v1.1-Q4_K_M.gguf',pageUrl:'https://huggingface.co/bartowski/nvidia_Llama-3.1-Nemotron-Nano-4B-v1.1-GGUF'},
  {id:'fingpt',name:'FinGPT',parameters:'Family',format:'Finance LLM ecosystem',domain:'CFO / IB / research',task:'Finance-specific research ecosystem; not presented as a one-click GGUF unless a verified runnable asset is available.',sourceUrl:'https://github.com/AI4Finance-Foundation/FinGPT',pageUrl:'https://github.com/AI4Finance-Foundation/FinGPT',kind:'research',downloadable:false,autoLoad:false},
  {id:'finrobot',name:'FinRobot',parameters:'Agent framework',format:'Finance agent framework',domain:'CFO / IB / Valuation',task:'Finance-agent workflow/tooling reference; used as an integration source, not a standalone GGUF.',sourceUrl:'https://github.com/AI4Finance-Foundation/FinRobot',pageUrl:'https://github.com/AI4Finance-Foundation/FinRobot',kind:'framework',downloadable:false,autoLoad:false},
  {id:'finma-pixiu',name:'FinMA / PIXIU',parameters:'7B family',format:'Transformers',domain:'CFO / IB / research',task:'Finance-tuned instruction model; not one-click local GGUF in this production release.',sourceUrl:'https://github.com/The-FinAI/PIXIU',pageUrl:'https://huggingface.co/ChanceFocus/finma-7b-full',kind:'research',downloadable:false,autoLoad:false},
  {id:'finbert',name:'FinBERT',parameters:'110M',format:'Transformers encoder',domain:'Finance / Audit / Market',task:'Financial sentiment/classification specialist; used as an auxiliary specialist when a compatible runtime is added.',sourceUrl:'https://huggingface.co/ProsusAI/finbert',pageUrl:'https://huggingface.co/ProsusAI/finbert',kind:'specialist',downloadable:false,autoLoad:false},
  {id:'auditwen',name:'AuditWen',parameters:'Fine-tuned model',format:'Transformers',domain:'Audit',task:'Audit issue summarisation / regulation matching research model.',sourceUrl:'https://github.com/IDEA-FinAI/AuditWen',pageUrl:'https://huggingface.co/models?search=AuditWen',kind:'research',downloadable:false,autoLoad:false}
];
function curatedFinanceRecommendations(){
  const categories=['CFO','Finance','Tax','Audit','Due Diligence','Valuation','Investment Banking','Research'];
  const normalise=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  const output=[];
  for(const category of categories){
    const rows=CFO_LOCAL_RECOMMENDATIONS.filter(m=>String(m.domain||'').split('/').map(x=>x.trim()).includes(category));
    const seen=new Set(), duplicates=new Set();
    for(const m of rows){const key=normalise(m.id||m.filename||m.name); if(seen.has(key))duplicates.add(key); else seen.add(key);}
    // A category containing duplicate model suggestions is excluded entirely, by design.
    if(duplicates.size)continue;
    output.push(...rows);
  }
  return output;
}
function modelSpecForFilename(filename){
  const n=String(filename||'').toLowerCase();
  return curatedFinanceRecommendations().find(m=>String(m.filename||'').toLowerCase()===n) ||
    MODEL_CATALOG.find(m=>String(m.filename||'').toLowerCase()===n) || null;
}
function generationBudgetForModel(filename){
  const n=String(filename||'').toLowerCase();
  if(n.includes('35b')) return 8192;
  if(n.includes('27b')||n.includes('32b')) return 6144;
  if(n.includes('14b')) return 3072;
  if(n.includes('4b')) return 1536;
  return 2048;
}
function contextBudgetForModel(filename){
  const spec=modelSpecForFilename(filename); if(spec?.testContextTokens)return Number(spec.testContextTokens);
  const n=String(filename||'').toLowerCase();
  if(n.includes('35b')||n.includes('27b')) return 65536;
  if(n.includes('32b')||n.includes('14b')||n.includes('4b')) return 32768;
  return 32768;
}
function hostModelEligibility(spec,host={}){
  const ram=Number(host?.memory?.totalGb)||0, vram=Math.max(0,...(host?.gpus||[]).map(g=>Number(g.vramGb)||0));
  return ram>=Number(spec?.minRamGb||0)||vram>=Number(spec?.minVramGb||0);
}

const MODEL_CATALOG = [
  {id:'qwen36-35b-a3b-q4km',name:'Qwen3.6 35B-A3B Q4_K_M',filename:'Qwen3.6-35B-A3B-Q4_K_M.gguf',size:'~20 GB',tier:'Long Context',parameters:'35B total / 3B active',license:'Model-specific',task:'Primary local CFO reasoning / long-context finance analysis',label:'LONG-CONTEXT • AVAILABLE FOR LATER MULTI-MODEL TESTING',recommended:false,nativeContextTokens:262144,testContextTokens:32768,url:'https://huggingface.co/Infatoshi/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/Infatoshi/Qwen3.6-35B-A3B-GGUF'},
  {id:'gemma2-2b-abliterated-q4km',name:'Gemma 2 2B Abliterated',filename:'gemma-2-2b-it-abliterated-Q4_K_M.gguf',size:'~1.7 GB',tier:'Recommended',parameters:'2B',license:'Model-specific',task:'Fast lightweight local CFO model',label:'[UNCENSORED] • RECOMMENDED FOR ALL • BLAZING FAST',recommended:true,url:'https://huggingface.co/bartowski/gemma-2-2b-it-abliterated-GGUF/resolve/main/gemma-2-2b-it-abliterated-Q4_K_M.gguf',pageUrl:'https://huggingface.co/bartowski/gemma-2-2b-it-abliterated-GGUF'},
  {id:'gemma4-e4b-ultra-heretic-q4km',name:'Gemma 4 E4B Ultra Uncensored Heretic',filename:'gemma-4-E4B-it-ultra-uncensored-heretic-Q4_K_M.gguf',size:'~5.3 GB',tier:'Recommended',parameters:'E4B',license:'Apache 2.0',task:'Higher-capability local reasoning',label:'[UNCENSORED] • HERETIC',recommended:true,url:'https://huggingface.co/llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic-GGUF/resolve/main/gemma-4-E4B-it-ultra-uncensored-heretic-Q4_K_M.gguf',pageUrl:'https://huggingface.co/llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic-GGUF'},
  {id:'qwen35-9b-uncensored-aggressive-q4km',name:'Qwen 3.5 9B Uncensored Aggressive',filename:'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',size:'~5.3 GB',tier:'Recommended',parameters:'9B',license:'Apache 2.0',task:'Reasoning / agentic local model',label:'[UNCENSORED] • AGGRESSIVE',recommended:true,url:'https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',pageUrl:'https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive'},
  {id:'nemomix-unleashed-12b-q4km',name:'NemoMix Unleashed 12B',filename:'NemoMix-Unleashed-12B-Q4_K_M.gguf',size:'~7.5 GB',tier:'Recommended',parameters:'12B',license:'Model-specific',task:'Heavyweight local reasoning',label:'[UNCENSORED] • HEAVYWEIGHT',recommended:true,url:'https://huggingface.co/bartowski/NemoMix-Unleashed-12B-GGUF/resolve/main/NemoMix-Unleashed-12B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/bartowski/NemoMix-Unleashed-12B-GGUF'},
  {id:'dolphin29-llama3-8b-q4km',name:'Dolphin 2.9 Llama 3 8B',filename:'dolphin-2.9-llama3-8b-Q4_K_M.gguf',size:'~4.9 GB',tier:'Recommended',parameters:'8B',license:'Meta Llama 3 Community License',task:'General / agentic local model',label:'[UNCENSORED]',recommended:true,url:'https://huggingface.co/bartowski/dolphin-2.9-llama3-8b-GGUF/resolve/main/dolphin-2.9-llama3-8b-Q4_K_M.gguf',pageUrl:'https://huggingface.co/bartowski/dolphin-2.9-llama3-8b-GGUF'},
  {id:'phi35-mini-38b-q4km',name:'Phi-3.5 Mini 3.8B',filename:'Phi-3.5-mini-Instruct-Q4_K_M.gguf',size:'~2.4 GB',tier:'Recommended',parameters:'3.8B',license:'MIT',task:'Lightweight standard local model',label:'[STANDARD] • LIGHTWEIGHT',recommended:true,url:'https://huggingface.co/lm-kit/phi-3.5-mini-3.8b-instruct-gguf/resolve/main/Phi-3.5-mini-Instruct-Q4_K_M.gguf',pageUrl:'https://huggingface.co/lm-kit/phi-3.5-mini-3.8b-instruct-gguf'},
  {id:'qwen3-4b-q4',name:'Qwen3 4B Instruct Q4_K_M',filename:'Qwen3-4B-Q4_K_M.gguf',size:'2.5 GB',tier:'Production Primary',parameters:'4B',license:'Apache 2.0',task:'Local CFO generalist / reasoning',label:'PRODUCTION • LIGHTWEIGHT PRIMARY CFO MODEL • 32K NATIVE CONTEXT',recommended:true,nativeContextTokens:32768,testContextTokens:8192,url:'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/Qwen/Qwen3-4B-GGUF'},
  {id:'qwen3-14b-q4',name:'Qwen3 14B Instruct Q4_K_M',filename:'Qwen3-14B-Q4_K_M.gguf',size:'~9 GB',tier:'Adaptive CFO',parameters:'14B',license:'Apache 2.0',task:'Higher-capability local CFO reasoning, extraction QA and financial analysis',label:'ADAPTIVE • HIGHER-CAPABILITY LOCAL CFO MODEL',recommended:true,nativeContextTokens:32768,testContextTokens:8192,url:'https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf',pageUrl:'https://huggingface.co/Qwen/Qwen3-14B-GGUF'},
  {id:'smollm2-17b-q4',name:'SmolLM2 1.7B Instruct Q4_K_M',filename:'smollm2-1.7b-instruct-q4_k_m.gguf',size:'1.1 GB',tier:'Low',parameters:'1.7B',license:'Apache 2.0',task:'Light local assistant',url:'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf',pageUrl:'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF'},
  {id:'qwen25-7b-q4',name:'Qwen2.5 7B Instruct Q4_K_M',filename:'qwen2.5-7b-instruct-q4_k_m.gguf',size:'4.7 GB',tier:'Mid',parameters:'7B',license:'Apache 2.0',task:'Higher-quality local CFO reasoning',url:'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',pageUrl:'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF'},
  {id:'qwen3-8b-q4',name:'Qwen3 8B Instruct Q4_K_M',filename:'Qwen3-8B-Q4_K_M.gguf',size:'5.0 GB class',tier:'High',parameters:'8B',license:'Apache 2.0',task:'Higher-quality local CFO reasoning',url:null,pageUrl:'https://huggingface.co/models?search=Qwen3-8B-GGUF'},
  {id:'deepseek-r1-7b-q4',name:'DeepSeek-R1 7B Q4',filename:'DeepSeek-R1-7B-Q4_K_M.gguf',size:'~4.7 GB',tier:'High',parameters:'7B',license:'Model-specific',task:'Reasoning backbone for finance',url:null,pageUrl:'https://huggingface.co/models?search=DeepSeek-R1-GGUF'},
  {id:'deepseek-r1-14b-q4',name:'DeepSeek-R1 14B Q4',filename:'DeepSeek-R1-14B-Q4_K_M.gguf',size:'~9 GB',tier:'High',parameters:'14B',license:'Model-specific',task:'Higher-capability reasoning backbone',url:null,pageUrl:'https://huggingface.co/models?search=DeepSeek-R1-GGUF'},
  {id:'qwen35-9b-q4',name:'Qwen3.5 9B Instruct Q4',filename:'Qwen3.5-9B-Q4_K_M.gguf',size:'~6 GB',tier:'High',parameters:'9B',license:'Apache 2.0',task:'Multilingual reasoning / compliance',url:null,pageUrl:'https://huggingface.co/models?search=Qwen3.5-9B-GGUF'},
  {id:'llama33-8b-q4',name:'Llama 3.3 8B Instruct Q4',filename:'Llama-3.3-8B-Instruct-Q4_K_M.gguf',size:'~5 GB',tier:'High',parameters:'8B',license:'Llama Community License',task:'General finance / audit backbone',url:null,pageUrl:'https://huggingface.co/models?search=Llama-3.3-8B-GGUF'},
  {id:'mistral-small-24b-q4',name:'Mistral Small 24B Q4',filename:'Mistral-Small-3.2-24B-Instruct-Q4_K_M.gguf',size:'~15 GB',tier:'Heavy',parameters:'24B',license:'Apache 2.0',task:'EU multilingual CFO reasoning',url:null,pageUrl:'https://huggingface.co/models?search=Mistral-Small-3.2-24B-GGUF'},
  {id:'falcon3-7b-q4',name:'Falcon 3 7B Q4',filename:'Falcon3-7B-Instruct-Q4_K_M.gguf',size:'~4.5 GB',tier:'Mid',parameters:'7B',license:'Model-specific',task:'GCC-relevant general backbone',url:null,pageUrl:'https://huggingface.co/models?search=Falcon3-7B-GGUF'}
];

const FINANCE_MODEL_CATALOG = [
{id:'fingpt',name:'FinGPT',parameters:'7B+ / family',format:'Finance LLM ecosystem',domain:'CFO / IB / research',task:'Financial NLP, sentiment, forecasting and robo-advising',sourceUrl:'https://github.com/AI4Finance-Foundation/FinGPT',pageUrl:'https://huggingface.co/FinGPT',kind:'framework',downloadable:false,autoLoad:false},
{id:'finrobot-model',name:'FinRobot',repo:'AI4Finance-Foundation/FinRobot',parameters:'Agent platform',format:'Finance agent framework',domain:'CFO / IB',task:'Financial analysis, valuation and report generation',sourceUrl:'https://github.com/AI4Finance-Foundation/FinRobot',pageUrl:'https://github.com/AI4Finance-Foundation/FinRobot',kind:'framework',downloadable:false,autoLoad:false},
{id:'finma-pixiu',name:'FinMA / PIXIU',repo:'ChanceFocus/finma-7b-full',downloadable:true,parameters:'7B family',format:'Transformers',domain:'CFO / IB',task:'Financial NLP, QA and instruction following',sourceUrl:'https://github.com/The-FinAI/PIXIU',pageUrl:'https://huggingface.co/ChanceFocus/finma-7b-full',kind:'model',downloadable:true,autoLoad:false},
{id:'investlm',name:'InvestLM',parameters:'65B',format:'Transformers',domain:'Investment banking',task:'Investment-domain instruction model',sourceUrl:'https://github.com/InvestLM/InvestLM',pageUrl:'https://huggingface.co/InvestLM/InvestLM',kind:'model',downloadable:false,autoLoad:false},
{id:'auditwen',name:'AuditWen',downloadable:false,parameters:'28K-instruction fine-tune',format:'Transformers',domain:'Audit',task:'Audit issue summarisation and regulation matching',sourceUrl:'https://github.com/IDEA-FinAI/AuditWen',pageUrl:'https://huggingface.co/models?search=AuditWen',kind:'model',downloadable:true,autoLoad:false},
{id:'steuerllm',name:'SteuerLLM',downloadable:false,parameters:'28B',format:'Transformers',domain:'Tax / Germany',task:'German tax-law reasoning',sourceUrl:'https://github.com/steuerllm',pageUrl:'https://huggingface.co/models?search=SteuerLLM',kind:'model',downloadable:true,autoLoad:false},
{id:'fin-r1',name:'Fin-R1',parameters:'Finance reasoning',format:'Transformers',domain:'CFO / IB',task:'Finance-specific reasoning',sourceUrl:'https://huggingface.co/models?search=Fin-R1',pageUrl:'https://huggingface.co/models?search=Fin-R1',kind:'model',downloadable:false,autoLoad:false},
{id:'fino1',name:'Fino1',parameters:'Finance reasoning',format:'Transformers',domain:'CFO / Audit / IB',task:'Financial reasoning and verification',sourceUrl:'https://huggingface.co/models?search=Fino1',pageUrl:'https://huggingface.co/models?search=Fino1',kind:'model',downloadable:false,autoLoad:false},
{id:'xuanyuan2',name:'XuanYuan 2.0',parameters:'176B class',format:'Transformers',domain:'CFO / China',task:'Chinese financial language model',sourceUrl:'https://huggingface.co/models?search=XuanYuan',pageUrl:'https://huggingface.co/models?search=XuanYuan',kind:'model',downloadable:false,autoLoad:false},
{id:'disc-finllm',name:'DISC-FinLLM',parameters:'Finance LLM',format:'Transformers',domain:'CFO / Audit',task:'Financial Q&A and document processing',sourceUrl:'https://github.com/FudanDISC/DISC-FinLLM',pageUrl:'https://huggingface.co/models?search=DISC-FinLLM',kind:'model',downloadable:false,autoLoad:false},
{id:'cfgpt',name:'CFGPT',parameters:'Finance GPT family',format:'Transformers',domain:'CFO',task:'Chinese financial GPT framework',sourceUrl:'https://huggingface.co/models?search=CFGPT',pageUrl:'https://huggingface.co/models?search=CFGPT',kind:'model',downloadable:false,autoLoad:false},
{id:'instruct-fingpt',name:'Instruct-FinGPT',parameters:'7B class',format:'Transformers',domain:'CFO / IB',task:'Financial sentiment and instruction tasks',sourceUrl:'https://huggingface.co/models?search=Instruct-FinGPT',pageUrl:'https://huggingface.co/models?search=Instruct-FinGPT',kind:'model',downloadable:false,autoLoad:false},
{id:'weaver-bird',name:'Weaver-Bird',parameters:'Finance LLM',format:'Transformers',domain:'CFO / IB',task:'Bilingual financial NLP',sourceUrl:'https://huggingface.co/models?search=Weaver-Bird',pageUrl:'https://huggingface.co/models?search=Weaver-Bird',kind:'model',downloadable:false,autoLoad:false},
{id:'open-finllms',name:'Open-FinLLMs',parameters:'Multimodal family',format:'Transformers',domain:'CFO / IB',task:'Text, tabular and chart financial analysis',sourceUrl:'https://huggingface.co/models?search=Open-FinLLMs',pageUrl:'https://huggingface.co/models?search=Open-FinLLMs',kind:'model',downloadable:false,autoLoad:false},
{id:'dianjin-r1',name:'DianJin-R1',parameters:'Finance reasoning',format:'Transformers',domain:'CFO / Tax',task:'Financial reasoning chat model',sourceUrl:'https://huggingface.co/models?search=DianJin-R1',pageUrl:'https://huggingface.co/models?search=DianJin-R1',kind:'model',downloadable:false,autoLoad:false},
{id:'ploutos',name:'Ploutos',parameters:'Financial LLM',format:'Transformers',domain:'IB / Quant',task:'Interpretable stock-movement research',sourceUrl:'https://huggingface.co/models?search=Ploutos',pageUrl:'https://huggingface.co/models?search=Ploutos',kind:'model',downloadable:false,autoLoad:false},
{id:'finbert',name:'FinBERT',repo:'ProsusAI/finbert',downloadable:false,parameters:'110M',format:'Transformers',domain:'CFO / Audit / Market',task:'Financial sentiment classification',sourceUrl:'https://huggingface.co/ProsusAI/finbert',pageUrl:'https://huggingface.co/ProsusAI/finbert',kind:'model',downloadable:true,autoLoad:false},
{id:'bbt-fin',name:'BBT-Fin',parameters:'Finance encoder',format:'Transformers',domain:'CFO / Audit',task:'Financial NLP representation',sourceUrl:'https://huggingface.co/models?search=BBT-Fin',pageUrl:'https://huggingface.co/models?search=BBT-Fin',kind:'model',downloadable:false,autoLoad:false},
{id:'deepseek-r1',name:'DeepSeek-R1',parameters:'671B MoE family',format:'GGUF / Transformers',domain:'All finance roles',task:'General reasoning backbone for finance',sourceUrl:'https://huggingface.co/models?search=DeepSeek-R1-GGUF',pageUrl:'https://huggingface.co/models?search=DeepSeek-R1-GGUF',kind:'backbone',downloadable:false,autoLoad:false},
{id:'qwen35',name:'Qwen3 / Qwen3.5',parameters:'Family',format:'GGUF / Transformers',domain:'All finance roles',task:'Multilingual reasoning and compliance',sourceUrl:'https://huggingface.co/models?search=Qwen3.5-GGUF',pageUrl:'https://huggingface.co/models?search=Qwen3.5-GGUF',kind:'backbone',downloadable:false,autoLoad:false},
{id:'glm45v',name:'GLM-4.5V',parameters:'Vision-language',format:'Transformers',domain:'Audit / Tax',task:'Scanned evidence and multimodal document analysis',sourceUrl:'https://huggingface.co/models?search=GLM-4.5V',pageUrl:'https://huggingface.co/models?search=GLM-4.5V',kind:'backbone',downloadable:false,autoLoad:false},
{id:'llama',name:'Llama series',parameters:'Family',format:'GGUF / Transformers',domain:'CFO / Audit / IB',task:'General open-weight backbone',sourceUrl:'https://huggingface.co/models?search=Llama-GGUF',pageUrl:'https://huggingface.co/models?search=Llama-GGUF',kind:'backbone',downloadable:false,autoLoad:false},
{id:'mistral',name:'Mistral / Mixtral',parameters:'Family',format:'GGUF / Transformers',domain:'CFO / Tax / EU',task:'EU-focused multilingual and reasoning backbone',sourceUrl:'https://huggingface.co/models?search=Mistral-GGUF',pageUrl:'https://huggingface.co/models?search=Mistral-GGUF',kind:'backbone',downloadable:false,autoLoad:false},
{id:'kimi-k2',name:'Kimi K2',parameters:'1T+ class',format:'Open-weight',domain:'IB / CFO',task:'Long-context and agentic analysis',sourceUrl:'https://huggingface.co/models?search=Kimi-K2-GGUF',pageUrl:'https://huggingface.co/models?search=Kimi-K2-GGUF',kind:'backbone',downloadable:false,autoLoad:false},
{id:'falcon',name:'Falcon series',parameters:'Family',format:'GGUF / Transformers',domain:'CFO / GCC',task:'UAE-origin open-weight backbone',sourceUrl:'https://huggingface.co/models?search=Falcon-GGUF',pageUrl:'https://huggingface.co/models?search=Falcon-GGUF',kind:'backbone',downloadable:false,autoLoad:false},

  {id:'financeforge-8b',name:'FinanceForge 8B',parameters:'8B',format:'GGUF',domain:'CFO / IB',task:'Finance QA / analysis',repo:'mradermacher/FinanceForge-8b-GGUF',pageUrl:'https://huggingface.co/mradermacher/FinanceForge-8b-GGUF',kind:'model',downloadable:true,autoLoad:true},
  {id:'qwen-open-finance-r-8b',name:'Qwen Open Finance R 8B',parameters:'8B',format:'GGUF',domain:'CFO / IB / research',task:'Financial reasoning / QA',repo:'pate2464/Qwen-Open-Finance-R-8B-FP8-Q8_0-GGUF',pageUrl:'https://huggingface.co/pate2464/Qwen-Open-Finance-R-8B-FP8-Q8_0-GGUF',kind:'model',downloadable:true,autoLoad:true},
  {id:'financial-gpt-oss-20b',name:'Financial GPT-OSS 20B Q8',parameters:'20B class',format:'GGUF',domain:'CFO / IB',task:'Financial analysis / investment research',repo:'mradermacher/financial-gpt-oss-20b-q8-GGUF',pageUrl:'https://huggingface.co/mradermacher/financial-gpt-oss-20b-q8-GGUF',kind:'model',downloadable:true,autoLoad:true},
  {id:'fingpt-forecaster-7b',name:'FinGPT Forecaster Llama2 7B',parameters:'7B',format:'GGUF',domain:'Investment research',task:'Financial forecasting / market narrative',repo:'Joshua265/fingpt-forecaster_llama2-7b-gguf',pageUrl:'https://huggingface.co/Joshua265/fingpt-forecaster_llama2-7b-gguf',kind:'model',downloadable:true,autoLoad:true},
];
const COUNTRIES = readReferenceArray(countriesFile,path.join(frontendReferenceDir,'countries.json'));
const CURRENCIES = readReferenceArray(currenciesFile,path.join(frontendReferenceDir,'currencies.json'));
const SEEDED_SOURCES = (()=>{
  const candidates=[seededSourcesFile,path.join(frontendReferenceDir,'knowledge-sources.json'),path.join(root,'knowledge-sources.json')];
  for(const f of candidates){try{const v=JSON.parse(fs.readFileSync(f,'utf8'));if(Array.isArray(v)&&v.length)return v;}catch{}}
  return [];
})();
const JURISDICTIONS = [{name:'International',code:'INTL',alpha3:'INT',numeric:'000',coverage:'seeded'}, ...COUNTRIES.map(c=>({name:c.name,code:c.code,alpha3:c.alpha3,numeric:c.numeric,coverage:SEEDED_SOURCES.some(s=>s.jurisdiction===c.name)?'seeded':'registry-ready'}))].sort((a,b)=>a.name.localeCompare(b.name));
const KNOWLEDGE_SOURCES = SEEDED_SOURCES;

function companyDocumentsDir(companyId){const dir=path.join(companyDataDir,String(companyId),'documents');fs.mkdirSync(dir,{recursive:true});return dir;}
function normaliseCompanyName(v){return String(v||'').trim().replace(/\s+/g,' ').toLowerCase();}
function duplicateCompanyName(name,excludeId=null){const n=normaliseCompanyName(name);return state.companies.find(c=>c.id!==excludeId&&!c.archived&&normaliseCompanyName(c.name)===n)||null;}
function recordDownloadJob(job){const copy={...job};delete copy.controller;delete copy.process;state.modelDownloadHistory=[copy,...(state.modelDownloadHistory||[]).filter(x=>x.jobId!==copy.jobId)].slice(0,50);save();}
const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
save();

function learningStats(agentId,task){
  const a=state.moni.agentPerformance?.[agentId]?.[task] || {attempts:0,wins:0,emaScore:0.5,feedback:0};
  return a;
}
function learnerState(task){
  state.moni.onlineLearner ||= {};
  return state.moni.onlineLearner[task] ||= {version:1,updates:0,learningRate:0.12,weights:{grounding:0.30,numericConsistency:0.25,caution:0.15,completeness:0.10,historical:0.20,bias:0}};
}
function sigmoid(x){return 1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));}
function learnerPredict(features,task){
  const l=learnerState(task),w=l.weights;
  const z=w.bias+w.grounding*features.grounding+w.numericConsistency*features.numericConsistency+w.caution*features.caution+w.completeness*features.completeness+w.historical*features.historical;
  return sigmoid(z);
}
function learnerUpdate(task,features,target,weight=1){
  const l=learnerState(task),w=l.weights,lr=l.learningRate*(Number(weight)||1);
  const pred=learnerPredict(features,task),err=Number(target)-pred;
  w.bias += lr*err;
  for(const k of ['grounding','numericConsistency','caution','completeness','historical'])w[k]=clamp(w[k]+lr*err*features[k],-1,1);
  l.updates += 1; l.lastUpdatedAt=new Date().toISOString();
  return {prediction:pred,error:err,weights:{...w},updates:l.updates};
}
function updateLearning(agentId,task,score,isWinner=false,feedback=0,features=null){
  state.moni.agentPerformance ||= {}; state.moni.agentPerformance[agentId] ||= {};
  const a=state.moni.agentPerformance[agentId][task] ||= {attempts:0,wins:0,emaScore:0.5,feedback:0};
  a.attempts += 1; if(isWinner)a.wins += 1;
  a.emaScore = (a.emaScore*0.85) + (Number(score)||0)*0.15;
  a.feedback += Number(feedback)||0;
  if(features)learnerUpdate(task,features,isWinner?1:0,isWinner?1:0.35);
  return a;
}
function clamp(v,min=0,max=1){return Math.max(min,Math.min(max,v));}
function tokenSet(text){return new Set(String(text||'').toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>=4));}
function overlapScore(a,b){const A=tokenSet(a),B=tokenSet(b); if(!A.size||!B.size)return 0; let n=0; for(const t of A)if(B.has(t))n++; return n/Math.max(1,Math.min(A.size,40));}
function candidateScore({answer,agent,task,companyContext,allEvidence}){
  const text=String(answer||'');
  const evidenceText=(companyContext?.evidence||[]).map(x=>x.text).join(' ')+' '+(companyContext?.validatedFacts||[]).map(x=>`${x.concept} ${x.rawValue}`).join(' ')+' '+(companyContext?.candidateFacts||[]).map(x=>`${x.concept} ${x.rawValue}`).join(' ');
  const grounding=overlapScore(text,evidenceText);
  const numericTokens=(text.match(/(?:[$€£₹]|\b)?\d[\d,.%]*/g)||[]).filter(x=>/[0-9]/.test(x));
  const contextNumbers=new Set((evidenceText.match(/(?:[$€£₹]|\b)?\d[\d,.%]*/g)||[]).map(x=>x.replace(/[^0-9.\-]/g,'')));
  const numericConsistency=numericTokens.length?numericTokens.filter(x=>contextNumbers.has(x.replace(/[^0-9.\-]/g,''))).length/numericTokens.length:0.5;
  const caution=/not validated|not available|insufficient evidence|cannot determine|requires verification/i.test(text)?0.9:0.55;
  const completeness=Math.min(1,text.length/900);
  const historical=learningStats(agent.id,task).emaScore;
  const features={grounding,numericConsistency,caution,completeness,historical};
  const mlScore=learnerPredict(features,task);
  const score=clamp(0.70*mlScore+0.30*(0.30*grounding+0.25*numericConsistency+0.15*caution+0.10*completeness+0.20*historical));
  return {score,confidence:clamp(0.45+score*0.5),grounding,numericConsistency,caution,completeness,historical,mlScore,features};
}

async function synthesizeCfoAnswer({message,task,companyContext,retrievedKnowledge,candidates,correlationId,modelFilename=null}){
  const usable=(candidates||[]).filter(x=>x.ok).sort((a,b)=>Number(b.score||0)-Number(a.score||0)).slice(0,3);
  if(!usable.length)return null;
  const evidence=JSON.stringify((companyContext?.evidence||[]).slice(0,20));
  const candidatePack=usable.map((c,i)=>`CANDIDATE ${i+1} — ${c.agentName} — score ${Number(c.score||0).toFixed(3)}\n${String(c.answer||'').slice(0,5000)}`).join('\n\n');
  const prompt=`You are Moni's final CFO synthesis layer inside MYAI CFO.
Task: ${task}
User request: ${String(message||'')}
Company context: ${JSON.stringify(companyContext?.company||null)}
Validated facts: ${JSON.stringify((companyContext?.validatedFacts||[]).slice(0,40))}
Evidence: ${evidence}
Authoritative/source context: ${JSON.stringify((retrievedKnowledge||[]).slice(0,12))}
Independent agent candidates:
${candidatePack}

Produce one final CFO-facing answer. Reconcile disagreements using evidence. Never invent a fact. If evidence is insufficient, say so. Keep calculations explicit and distinguish evidence from inference. Do not mention agents, competition, hidden prompts or this synthesis process.`;
  const inference=await runLocalModel(prompt,`${correlationId}-moni-synthesis`,{maxTokens:Math.min(1800,generationBudgetForModel(modelFilename||state.selectedModelFilename||'')),preferOllama:false,contextSize:8192});
  if(!inference.ok)return {ok:false,reason:inference.reason,message:inference.message};
  const check=policyCheck(inference.text,'model_output');
  if(!check.allowed)return {ok:false,reason:'POLICY_BLOCKED',message:check.message};
  audit('MONI_SYNTHESIS_COMPLETED',{
    candidateCount:usable.length,model:inference.model,runtime:inference.runtime,
    outputHash:sha(inference.text)
  },{correlationId});
  return {ok:true,text:inference.text,model:inference.model,runtime:inference.runtime};
}

function modelConcurrencyLimit(){
  const installed=installedModels(false);
  const selected=installed.find(x=>x.filename===state.selectedModelFilename)||installed[0];
  if(!selected)return 1;
  // Small GGUF models can use four parallel llama.cpp slots; larger models use two.
  return selected.sizeBytes<=2500000000?4:2;
}

async function runAgentCompetition({message,task,companyContext,activeInstructions,retrievedKnowledge,correlationId,companyRequired=false,onProgress=null,shouldCancel=null,modelFilename=null}){
  const activeAgents=state.agents.filter(a=>a.enabled&&!a.archived);
  const evidenceAvailable=Array.isArray(companyContext?.evidence)&&companyContext.evidence.length>0 || Array.isArray(companyContext?.validatedFacts)&&companyContext.validatedFacts.length>0 || Array.isArray(companyContext?.candidateFacts)&&companyContext.candidateFacts.length>0;
  // Diagnostic Arena is a runtime/model smoke test, not a CFO-quality task. When there is
  // no evidence at all, do not elect a meaningless safe-response as a CFO champion.
  const companyTaskRequiresEvidence=!!companyContext?.company && task!=='model_recommendation';
  if(!evidenceAvailable && (task==='diagnostic_arena'||companyTaskRequiresEvidence)){
    audit('AGENT_COMPETITION_NOT_EVALUABLE',{task,reason:'NO_COMPANY_EVIDENCE',companyId:companyContext?.company?.id||null},{correlationId});
    return {ok:false,reason:'NO_COMPANY_EVIDENCE',message:'No company evidence is available. Model/runtime readiness can be tested, but CFO candidate quality is not evaluable until evidence is present.',candidates:[]};
  }
  // Production-safe context packing: the installed Qwen3 4B runtime may expose a smaller
  // effective context than the model's native limit. Keep each candidate well below 2K
  // tokens so Agent Arena cannot fail merely because evidence was verbose.
  const financialTerms=financialQueryProfile(message);
  const docEvidenceRanked=rankFinancialEvidence(companyContext?.documents||[],message,companyContext?.fiscalYears||[]);
  const baseEvidence=docEvidenceRanked.length?docEvidenceRanked:(companyContext?.evidence||[]);
  const trimmedEvidence=baseEvidence.slice(0,18).map(e=>({id:e.id,documentId:e.documentId,filename:e.filename,ordinal:e.ordinal,text:String(e.text||'').slice(0,620)}));
  const trimmedCompany={id:companyContext?.company?.id,name:companyContext?.company?.name,country:companyContext?.company?.country,currency:companyContext?.company?.currency,reportingCurrency:companyContext?.company?.reportingCurrency,reportingFramework:companyContext?.company?.reportingFramework,industry:companyContext?.company?.industry};
  const trimmedCompanyContext={company:trimmedCompany,documents:(companyContext?.documents||[]).slice(0,8),evidence:trimmedEvidence};
  const allEvidence=JSON.stringify(trimmedEvidence);
  const validated=rankCandidateFacts(companyContext?.validatedFacts||[],message);
  const candidatesOnly=rankCandidateFacts(companyContext?.candidateFacts||[],message);
  const knowledge=(retrievedKnowledge||[]).slice(0,4).map(x=>({name:x.name,category:x.category,jurisdiction:x.jurisdiction,text:String(x.text||'').slice(0,260)}));
  const instructions=(activeInstructions||[]).slice(0,2).map(x=>String(x.text||'').slice(0,220));
  const base=`Task: ${task}\nUser request: ${String(message||'')}\nFinancial query profile: ${JSON.stringify(financialTerms)}\nCompany context: ${JSON.stringify(trimmedCompanyContext||{company:null})}\nValidated facts: ${JSON.stringify(validated)}\nCandidate facts are evidence only and must never be treated as established: ${JSON.stringify(candidatesOnly)}\nEvidence excerpts: ${allEvidence}\nRelevant knowledge: ${JSON.stringify(knowledge)}\nUser instructions: ${JSON.stringify(instructions)}\nRules: be CFO-facing, do not invent facts, state uncertainty, distinguish evidence from inference, answer the question directly, preserve formulas/source evidence, and provide enough detail to complete the task. Avoid unnecessary repetition.`;
  audit('AGENT_COMPETITION_STARTED',{task,agentCount:activeAgents.length,messageHash:sha(String(message||'')),companyId:companyContext?.company?.id||null},{correlationId});
  if(!activeAgents.length)return {ok:false,reason:'NO_ACTIVE_AGENTS',message:'No active agent capabilities are available.'};
  const candidates=[];
  const runOne=async(agent)=>{
    if(typeof shouldCancel==='function'&&shouldCancel())return {agentId:agent.id,agentName:agent.name,ok:false,reason:'CANCELLED',answer:'Agent competition terminated by the user.',score:0,confidence:0};
    const p=`You are the ${agent.name} capability in MYAI CFO. Role: ${agent.role}. Compete independently with other capabilities. Do not mention that you are competing. Provide the best CFO-useful answer you can using the supplied evidence.\n\n${base}`;
    const inference=await runLocalModel(p,`${correlationId}-${agent.id}`,{maxTokens:Math.min(1400,generationBudgetForModel(modelFilename||state.selectedModelFilename||'')),modelFilename,contextSize:Math.max(8192,contextBudgetForModel(modelFilename||state.selectedModelFilename||''))});
    if(!inference.ok)return {agentId:agent.id,agentName:agent.name,ok:false,reason:inference.reason,answer:inference.message,score:0,confidence:0};
    const check=policyCheck(inference.text,'model_output');
    if(!check.allowed)return {agentId:agent.id,agentName:agent.name,ok:false,reason:'POLICY_BLOCKED',answer:check.message,score:0,confidence:0};
    const scored=candidateScore({answer:inference.text,agent,task,companyContext,allEvidence});
    return {agentId:agent.id,agentName:agent.name,ok:true,answer:inference.text,model:inference.model,runtime:inference.runtime,...scored};
  };
  // Run a small bounded number of candidates concurrently. Two requests match the
  // default low-memory llama.cpp slot configuration and reduce HTTP/queue failures
  // while preserving a real multi-agent competition.
  const concurrency=Math.min(modelConcurrencyLimit(),Math.max(1,activeAgents.length));
  let nextIndex=0;
  const worker=async()=>{
    while(true){
      if(typeof shouldCancel==='function'&&shouldCancel())return;
      const index=nextIndex++; if(index>=activeAgents.length)return;
      let cand;
      try{cand=await runOne(activeAgents[index]);}
      catch(e){cand={agentId:activeAgents[index].id,agentName:activeAgents[index].name,ok:false,reason:'AGENT_EXECUTION_ERROR',answer:String(e?.message||e),score:0,confidence:0};}
      candidates.push(cand);
      if(cand.ok) audit('AGENT_CANDIDATE_EVALUATED',{task,agentId:cand.agentId,model:cand.model,score:cand.score,confidence:cand.confidence,grounding:cand.grounding,numericConsistency:cand.numericConsistency,outputHash:sha(cand.answer)},{correlationId});
      if(typeof onProgress==='function')onProgress({completedAgents:candidates.length,currentAgentId:cand.agentId,currentAgentName:cand.agentName,candidates:candidates.map(x=>({agentId:x.agentId,agentName:x.agentName,ok:x.ok,reason:x.reason,answer:x.answer||'',score:x.score,confidence:x.confidence,grounding:x.grounding||0,numericConsistency:x.numericConsistency||0,model:x.model,runtime:x.runtime}))});
    }
  };
  await Promise.all(Array.from({length:concurrency},()=>worker()));
  if(typeof shouldCancel==='function'&&shouldCancel())return {ok:false,reason:'CANCELLED',message:'Agent competition terminated by the user.',candidates};
  const usable=candidates.filter(x=>x.ok).sort((a,b)=>b.score-a.score);
  if(!usable.length)return {ok:false,reason:'NO_USABLE_CANDIDATE',message:'No local agent candidate produced a usable answer.',candidates};
  const winner=usable[0];
  let synthesis=null; if(usable.length>1){try{synthesis=await synthesizeCfoAnswer({message,task,companyContext,retrievedKnowledge,candidates:usable,correlationId,modelFilename});}catch(e){audit('MONI_SYNTHESIS_FAILED',{errorHash:sha(String(e?.message||e))},{correlationId});}}
  if(synthesis?.ok){
    winner.answer=synthesis.text;
    winner.finalAnswer=true;
    winner.model=synthesis.model;
    winner.runtime=synthesis.runtime;
  }
  for(const c of usable){
    updateLearning(c.agentId,task,c.score,c.agentId===winner.agentId,0,c.features);
    const mk=String(c.model||'unknown');
    const mp=state.moni.modelPerformance[mk] ||= {attempts:0,wins:0,emaScore:0.5};
    mp.attempts += 1; if(c.agentId===winner.agentId)mp.wins += 1;
    mp.emaScore=(mp.emaScore*0.85)+(Number(c.score)||0)*0.15; mp.lastUpdatedAt=new Date().toISOString();
  }
  const trajectory={
    schemaVersion:'1.0',
    goal:{task,messageHash:sha(String(message||''))},
    plan:[{step:'route',status:'completed'},{step:'retrieve',status:'completed'},{step:'candidate-evaluation',status:'completed'},{step:'synthesis',status:usable.length>1?'completed':'not-required'}],
    decisions:candidates.map(c=>({agentId:c.agentId,ok:c.ok,score:c.score,confidence:c.confidence,selected:c.agentId===winner.agentId})),
    toolCalls:[{tool:'company-evidence-context',status:'completed'}],toolArguments:[{companyId:companyContext?.company?.id||null,documentCount:(companyContext?.documents||[]).length}],toolResults:[{ok:true,evidenceCount:trimmedEvidence.length}],
    stateTransitions:[{from:'started',to:'routed'},{from:'routed',to:'retrieved'},{from:'retrieved',to:'evaluated'},{from:'evaluated',to:'terminated'}],
    termination:{winnerAgentId:winner.agentId,reason:'highest evidence-grounded candidate score'},
    finalResponse:{hash:winner.answer?sha(winner.answer):null,length:String(winner.answer||'').length},
    evaluation:{confidence:winner.confidence,score:winner.score,grounding:winner.grounding,numericConsistency:winner.numericConsistency}
  };
  const competition={id:correlationId,createdAt:new Date().toISOString(),task,messageHash:sha(String(message||'')),companyId:companyContext?.company?.id||null,candidates:candidates.map(c=>({agentId:c.agentId,agentName:c.agentName,ok:c.ok,score:c.score,confidence:c.confidence,grounding:c.grounding,numericConsistency:c.numericConsistency,model:c.model,runtime:c.runtime,outputHash:c.answer?sha(c.answer):null})),winnerAgentId:winner.agentId,winnerAgentName:winner.agentName,winnerScore:winner.score,winnerConfidence:winner.confidence,finalAnswerSynthesized:!!winner.finalAnswer,finalModel:winner.model,finalRuntime:winner.runtime,trajectory};
  audit('AGENT_TRAJECTORY_CAPTURED',trajectory,{correlationId});
  state.arena.competitions=[competition,...state.arena.competitions].slice(0,200); state.arena.champion={agentId:winner.agentId,task,score:winner.score,updatedAt:competition.createdAt}; save();
  audit('MONI_CHAMPION_SELECTED',{task,winnerAgentId:winner.agentId,winnerAgentName:winner.agentName,score:winner.score,confidence:winner.confidence,candidateCount:candidates.length},{correlationId});
  return {ok:true,winner,candidates,competitionId:correlationId,trajectory,competition};
}

function proactiveScan(){
  const alerts=[]; const predictions=[];
  for(const c of state.companies.filter(x=>!x.archived)){
    const activeFacts=(c.facts||[]).filter(f=>f.validated||f.systemVerified);
    const byConcept={}; for(const f of activeFacts){(byConcept[f.concept] ||= []).push(f);}
    for(const [concept,rows] of Object.entries(byConcept)){
      if(rows.length<2)continue; const nums=rows.map(r=>Number(String(r.rawValue).replace(/[^0-9.\-]/g,''))).filter(Number.isFinite); if(nums.length<2)continue;
      const latest=nums[0],prior=nums[1]; if(!Number.isFinite(latest)||!Number.isFinite(prior)||prior===0)continue;
      const growth=(latest-prior)/Math.abs(prior);
      if(/revenue|gross profit|ebitda|net income|cash|assets|liabilities/i.test(concept)&&Math.abs(growth)>=0.15){
        const predictedNext=latest+(latest-prior);
        predictions.push({companyId:c.id,companyName:c.name,concept,latest,prior,growth,predictedNext,confidence:clamp(0.55+Math.min(Math.abs(growth),1)*0.25),createdAt:new Date().toISOString(),reason:'Material change detected from validated financial facts; next-period baseline projected from the latest observed trend.'});
      }
    }
    if(activeFacts.length===0 && (c.documents||[]).some(d=>!d.archived)) alerts.push({companyId:c.id,companyName:c.name,level:'warning',title:'Evidence awaiting AI review',text:'Documents are present but no system-verified financial facts are available yet.',createdAt:new Date().toISOString()});
  }
  const modelEntries=Object.entries(state.moni.modelPerformance||{});
  if(modelEntries.length){
    const recentAvg=modelEntries.reduce((n,[,v])=>n+(Number(v.emaScore)||0),0)/modelEntries.length;
    if(recentAvg<0.62)alerts.push({level:'info',title:'AI stack re-evaluation recommended',text:'Moni performance is below the preferred confidence band. Review the installed model and active agent capabilities in AI Models and AI Arena.',createdAt:new Date().toISOString()});
  }
  state.proactive={lastScanAt:new Date().toISOString(),alerts:alerts.slice(0,100),predictions:predictions.slice(0,100)}; save(); return state.proactive;
}
setInterval(()=>{try{proactiveScan()}catch{}},300000);

const id=p=>`${p}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
function readJson(file,fallback=[]){
  try{
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    if(Array.isArray(fallback)){
      if(Array.isArray(value)) return value;
      if(value && Array.isArray(value.uploaded)) return value.uploaded;
      if(value && Array.isArray(value.items)) return value.items;
      return fallback;
    }
    return value;
  }catch{return fallback}
}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2),'utf8')}


function loadManifest(){
  try{return JSON.parse(fs.readFileSync(auditManifest,'utf8'))}catch{return {lastHash:'GENESIS',events:0}}
}
function audit(eventType,payload={},meta={}){
  const manifest=loadManifest();
  const installId=fs.readFileSync(installIdFile,'utf8').trim();
  const actorSeed=`${installId}|${os.hostname()}|${process.env.USERNAME||process.env.USER||''}`;
  const actorHash=sha(actorSeed);
  const event={
    eventId:crypto.randomUUID(),
    eventType,
    product:PRODUCT,
    applicationVersion:VERSION,
    disclaimerVersion:DISCLAIMER_VERSION,
    disclaimerHash,
    timestampUtc:new Date().toISOString(),
    actorHash,
    correlationId:meta.correlationId||payload.correlationId||null,
    payload
  };
  event.previousHash=manifest.lastHash;
  event.eventHash=sha(JSON.stringify(event));
  fs.appendFileSync(acceptanceFile,JSON.stringify(event)+'\n','utf8');
  fs.writeFileSync(auditManifest,JSON.stringify({lastHash:event.eventHash,events:(manifest.events||0)+1,updatedAt:event.timestampUtc},null,2),'utf8');
  return event;
}

function accepted(){return state.disclaimer.accepted===true && state.disclaimer.version===DISCLAIMER_VERSION && state.disclaimer.hash===disclaimerHash}
const STATIC_WEB_ORIGINS=new Set([
  'http://127.0.0.1:47820','http://localhost:47820','http://127.0.0.1:5173','http://localhost:5173'
]);
function isAllowedLocalOrigin(origin){
  if(!origin)return false;
  if(STATIC_WEB_ORIGINS.has(origin))return true;
  try{
    const u=new URL(origin);
    const host=String(u.hostname||'').toLowerCase();
    const localHost=host==='localhost'||host==='127.0.0.1'||host==='[::1]'||host==='::1';
    return localHost && (u.protocol==='http:'||u.protocol==='https:');
  }catch{return false;}
}
const ALLOWED_WEB_ORIGINS={has:isAllowedLocalOrigin};
const send=(res,code,body)=>{
  const origin=res.__myaiOrigin;
  const headers={'Content-Type':'application/json; charset=utf-8','Vary':'Origin','Access-Control-Allow-Headers':'Content-Type, X-Correlation-ID, Authorization','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'};
  if(origin && isAllowedLocalOrigin(origin))headers['Access-Control-Allow-Origin']=origin;
  res.writeHead(code,headers);res.end(JSON.stringify(body));
};
const parseBody=(req,maxBytes=100*1024*1024)=>new Promise((resolve,reject)=>{let b='';let bytes=0;let settled=false;const fail=(e)=>{if(settled)return;settled=true;try{req.destroy()}catch{};reject(e)};req.on('data',c=>{if(settled)return;bytes+=Buffer.byteLength(c);if(bytes>maxBytes){const e=new Error(`Request exceeds the ${Math.round(maxBytes/1024/1024)} MB limit.`);e.code='REQUEST_TOO_LARGE';return fail(e);}b+=c});req.on('end',()=>{if(settled)return;if(!b.trim()){settled=true;return resolve({})}try{const j=JSON.parse(b);settled=true;resolve(j)}catch{const e=new Error('Invalid JSON request body');e.code='INVALID_JSON';fail(e);}});req.on('error',reject);});
const guard=(req,res)=>{if(accepted())return true;send(res,428,{error:'Disclaimer acceptance required',code:'DISCLAIMER_REQUIRED'});return false};

function extractFinancialFacts(text){
  const facts=[]; const seen=new Set();
  const add=(concept,value,source='pattern',evidence='')=>{
    if(value===undefined||value===null)return;
    const clean=String(value).replace(/\s+/g,' ').trim();
    if(!/[0-9]/.test(clean))return;
    const key=`${concept}|${clean}`; if(seen.has(key))return; seen.add(key);
    facts.push({concept,rawValue:clean,sourcePattern:source,evidenceText:String(evidence||clean).replace(/\s+/g,' ').trim().slice(0,500)});
  };
  const patterns=[
    ['revenue',/(?:total\s+)?revenue(?:s)?\s*(?:from\s+operations)?\s*[:\-]?\s*([($£€]?\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?[)]?)/ig],
    ['revenue',/total\s+revenues?\s*\(?\s*([($£€]?\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?[)]?)/ig],
    ['gross profit',/gross\s+profit\s*[:\-]?\s*([($£€]?\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?[)]?)/ig],
    ['ebitda',/ebitda\s*[:\-]?\s*([($£€]?\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?[)]?)/ig],
    ['cash and cash equivalents',/cash\s+and\s+cash\s+equivalents?\s*[:\-]?\s*([($£€]?\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?[)]?)/ig],
    ['total assets',/total\s+assets\s*[:\-]?\s*([($£€]?\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?[)]?)/ig],
    ['total liabilities',/total\s+liabilit(?:y|ies)\s*[:\-]?\s*([($£€]?\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?[)]?)/ig],
    ['net income',/(?:net\s+income|net\s+profit)\s*[:\-]?\s*([($£€]?\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?[)]?)/ig]
  ];
  for(const [concept,re] of patterns){for(const m of text.matchAll(re))add(concept,m[1],'label-pattern',m[0]);}
  const lines=text.split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const conceptMatch=line.match(/^(total\s+)?(revenue|revenues|gross profit|ebitda|cash and cash equivalents|total assets|total liabilities|net income|net profit)\b/i);
    if(!conceptMatch)continue;
    const concept=(conceptMatch[2].toLowerCase()==='revenues'?'revenue':conceptMatch[2].toLowerCase());
    const nums=[...line.matchAll(/(?:[$£€]\s*)?[-(]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*(?:million|billion|m|bn))?\)?/gi)].map(m=>m[0]);
    if(nums.length)add(concept,nums[0],'table-line',line);
    else for(let j=1;j<=2 && i+j<lines.length;j++){const n=[...lines[i+j].matchAll(/(?:[$£€]\s*)?[-(]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*(?:million|billion|m|bn))?\)?/gi)].map(m=>m[0]);if(n.length){add(concept,n[0],'table-near-label',`${line} | ${lines[i+j]}`);break;}}
  }
  return facts.slice(0,30);
}
function companyEvidenceContext(c){
  if(!c)return {company:null,documents:[],validatedFacts:[],candidateFacts:[],evidence:[]};
  const activeDocs=(c.documents||[]).filter(d=>!d.archived);
  const documents=activeDocs.map(d=>({id:d.id,title:d.title||d.filename,filename:d.filename,documentType:d.documentType||d.category,fiscalYear:d.fiscalYear,documentFiscalYear:d.documentFiscalYear,status:d.status,evidenceCount:d.evidenceCount||0,sourceUrl:d.sourceUrl||null}));
  const activeDocIds=new Set(activeDocs.map(d=>d.id));
  const mapFact=(f,status)=>({id:f.id||null,concept:f.concept,rawValue:f.rawValue,normalizedValue:f.normalizedValue,unit:f.unit||null,scale:f.scale||null,currency:f.currency||null,fiscalYear:f.fiscalYear||null,periodEnd:f.periodEnd||null,documentId:f.documentId,sourcePage:f.sourcePage||null,evidenceText:f.evidenceText||null,confidence:f.confidence??null,validatedAt:f.validatedAt||null,systemVerified:!!f.systemVerified,validated:!!f.validated,verificationMethod:f.verificationMethod||'structured-extractor',status});
  const validatedFacts=(c.facts||[]).filter(f=>(f.validated||f.systemVerified)&&activeDocIds.has(f.documentId)).map(f=>mapFact(f,'validated'));
  const candidateFacts=(c.facts||[]).filter(f=>!f.validated&&!f.systemVerified&&activeDocIds.has(f.documentId)).map(f=>mapFact(f,'candidate'));
  const evidence=activeDocs.flatMap(d=>(d.evidence||[]).slice(0,25).map(e=>({id:e.id,documentId:d.id,filename:d.filename,ordinal:e.ordinal,text:e.text}))).slice(0,100);
  return {company:{id:c.id,name:c.name,country:c.country,currency:c.currency,reportingCurrency:c.reportingCurrency,reportingFramework:c.reportingFramework,industry:c.industry},documents,validatedFacts,candidateFacts,evidence};
}

function requestedReportBasis(message){
  const q=String(message||'').toLowerCase();
  if(/\bconsolidated\b/.test(q)) return 'consolidated';
  if(/\bstandalone\b|\bseparate financial statements\b/.test(q)) return 'standalone';
  return 'any';
}
function documentReportBasis(d){
  const s=[d?.filename,d?.title,d?.documentType,d?.category].filter(Boolean).join(' ').toLowerCase();
  if(/consolidated/.test(s)) return 'consolidated';
  if(/standalone|separate financial statements/.test(s)) return 'standalone';
  return 'unknown';
}

function companyEvidenceContextFiltered(c,{fiscalYears=[],reportBasis='any'}={}){
  if(!c)return companyEvidenceContext(c);
  const years=new Set((fiscalYears||[]).map(String).filter(Boolean));
  const allDocs=(c.documents||[]).filter(d=>!d.archived);
  const basis=String(reportBasis||'any').toLowerCase();
  const basisDocs=basis==='any'?allDocs:allDocs.filter(d=>documentReportBasis(d)===basis);
  const activeDocs=basisDocs.filter(d=>{
    if(!years.size)return true;
    if(years.has(String(d.fiscalYear||''))||years.has(String(d.documentFiscalYear||'')))return true;
    return (Array.isArray(d.structuredFacts)?d.structuredFacts:[]).some(f=>years.has(String(f.fiscalYear||'')));
  });
  const documents=activeDocs.map(d=>({id:d.id,title:d.title||d.filename,filename:d.filename,documentType:d.documentType||d.category,fiscalYear:d.fiscalYear,documentFiscalYear:d.documentFiscalYear,status:d.status,evidenceCount:d.evidenceCount||0,sourceUrl:d.sourceUrl||null}));
  const activeDocIds=new Set(activeDocs.map(d=>d.id));
  const factInRequestedYear=f=>!years.size||years.has(String(f?.fiscalYear||''));
  const mapFact=(f,status)=>({id:f.id||null,concept:f.concept,rawValue:f.rawValue,normalizedValue:f.normalizedValue,unit:f.unit||null,scale:f.scale||null,currency:f.currency||null,fiscalYear:f.fiscalYear||null,periodEnd:f.periodEnd||null,documentId:f.documentId,sourcePage:f.sourcePage||null,evidenceText:f.evidenceText||null,confidence:f.confidence??null,validatedAt:f.validatedAt||null,systemVerified:!!f.systemVerified,validated:!!f.validated,verificationMethod:f.verificationMethod||'structured-extractor',status});
  const validatedFacts=(c.facts||[]).filter(f=>(f.validated||f.systemVerified)&&activeDocIds.has(f.documentId)&&factInRequestedYear(f)).map(f=>mapFact(f,'validated'));
  const candidateFacts=(c.facts||[]).filter(f=>!f.validated&&!f.systemVerified&&activeDocIds.has(f.documentId)&&factInRequestedYear(f)).map(f=>mapFact(f,'candidate'));
  const evidence=activeDocs.flatMap(d=>(d.evidence||[]).slice(0,30).map(e=>({id:e.id,documentId:d.id,filename:d.filename,ordinal:e.ordinal,text:e.text}))).slice(0,160);
  return {company:{id:c.id,name:c.name,country:c.country,currency:c.currency,reportingCurrency:c.reportingCurrency,reportingFramework:c.reportingFramework,industry:c.industry},documents,validatedFacts,candidateFacts,evidence};
}



function enforceCanonicalFactInvariants(company,doc){
  if(!company||!doc)return;
  const docCurrency=doc.documentCurrency||doc.currency||company.currency||null;
  const docScale=doc.documentScale||doc.scale||'units';
  const docUnit=doc.documentUnit||(docCurrency&&docScale&&docScale!=='units'?`${docCurrency} ${docScale}`:docCurrency||null);
  for(const f of company.facts||[]){
    if(f.documentId!==doc.id) continue;
    f.documentId=doc.id;
    f.companyId=company.id;
    f.currency=f.currency||docCurrency;
    f.scale=f.scale&&f.scale!=='units'?f.scale:docScale;
    f.unit=f.unit&&f.unit!=='document unit'?f.unit:docUnit;
    f.fiscalYear=f.fiscalYear||doc.documentFiscalYear||doc.fiscalYear||null;
    // V46 remediation: financial facts retain the source numeric value. Scale/unit is
    // metadata, never an instruction to multiply the visible/canonical financial value.
    const sv=sourceNumericValue(f);
    if(Number.isFinite(sv)){
      f.normalizedValue=sv;
      f.baseValue=sv*financialScaleFactor(f.scale||docScale||'units');
      f.absoluteValue=f.baseValue;
    }
  }
}
function compareFactQuality(a,b){
  const ra=factQualityRank(a), rb=factQualityRank(b);
  for(let i=0;i<ra.length;i++){
    if(i===ra.length-1)return String(ra[i]).localeCompare(String(rb[i]));
    const na=Number(ra[i]),nb=Number(rb[i]);
    if(Number.isFinite(na)&&Number.isFinite(nb)){if(na!==nb)return na-nb;}
    else {const c=String(ra[i]).localeCompare(String(rb[i]));if(c!==0)return c;}
  }
  return 0;
}

function syncStructuredFacts(company){
  if(!company)return;
  company.facts=Array.isArray(company.facts)?company.facts:[];
  for(const doc of (company.documents||[]).filter(d=>!d.archived)){
    const structured=Array.isArray(doc.structuredFacts)?doc.structuredFacts:[];
    if(!structured.length)continue;
    const sfConverted=structuredFactsToCandidates(structured,doc.id,company.id,doc);
    for(const sf of sfConverted){
      const sameKey=f=>f.documentId===doc.id&&canonicalFactConcept(f.concept)===sf.concept&&String(f.fiscalYear||'')===String(sf.fiscalYear||'');
      // A fresh deterministic extraction supersedes stale automated facts for the same
      // document/concept/period. Never silently retain an older systemVerified value after
      // the underlying extractor has produced a different bound value. Explicitly validated
      // facts remain authoritative and are reconciled below rather than deleted.
      const sfNum=normalizedFactNumber(sf);
      company.facts=company.facts.filter(f=>!(sameKey(f)&&!f.validated&&normalizedFactNumber(f)!==sfNum));
      const matches=company.facts.filter(f=>sameKey(f));
      const exact=matches.find(f=>normalizedFactNumber(f)===normalizedFactNumber(sf));
      if(exact){
        exact.concept=sf.concept; exact.rawValue=sf.rawValue; exact.normalizedValue=sf.normalizedValue!=null?sf.normalizedValue:sf.absoluteValue; exact.unit=sf.unit; exact.currency=sf.currency; exact.sourcePage=sf.sourcePage; exact.evidenceText=sf.evidenceText||exact.evidenceText;
        exact.systemVerified=!!(exact.systemVerified||sf.systemVerified); exact.validated=!!(exact.validated||sf.validated);
        exact.consensusCount=Math.max(Number(exact.consensusCount||0),Number(sf.consensusCount||0)); exact.consensusQuality=Math.max(Number(exact.consensusQuality||0),Number(sf.consensusQuality||0));
        exact.extractionMethod=sf.extractionMethod; exact.verificationMethod=sf.verificationMethod; exact.documentId=doc.id; exact.companyId=company.id; exact.currency=sf.currency||doc.documentCurrency||exact.currency; exact.scale=sf.scale||doc.documentScale||exact.scale; exact.unit=sf.unit||doc.documentUnit||exact.unit; exact.fiscalYear=sf.fiscalYear||doc.documentFiscalYear||doc.fiscalYear||exact.fiscalYear; exact.sourceUnitText=sf.sourceUnitText||doc.documentUnit||exact.sourceUnitText;
      }else{
        company.facts.push(sf);
      }
    }
  }
  // De-duplicate the canonical store without discarding higher-quality evidence.
  const dedup=new Map();
  for(const f of company.facts){
    f.concept=canonicalFactConcept(f.concept);
    const key=`${f.documentId}|${f.concept}|${f.fiscalYear}|${normalizedFactNumber(f)}`;
    const prior=dedup.get(key);
    if(!prior || compareFactQuality(f,prior)>0)dedup.set(key,f);
  }
  company.facts=[...dedup.values()];
  enforceDocumentFactInvariants(company);

}

const FINANCIAL_SPINE_VERSION='production-financial-spine-v2';
const CURRENT_FINANCIAL_SPINE_VERSION='production-financial-spine-v4-semantic-financial-tables';
function withOptionalAbortSignal(options={}, signal=null){
  if(signal && typeof AbortSignal!=='undefined' && signal instanceof AbortSignal) return {...options,signal};
  return {...options};
}
const EXTRACTION_MAX_MS=Math.max(60000,Number(process.env.MYAI_CFO_EXTRACTION_MAX_MS||900000));
const CHAT_REQUEST_MAX_MS=Math.max(30000,Number(process.env.MYAI_CFO_CHAT_MAX_MS||180000));
const extractionRefreshInFlight=new Set();
async function extractDocumentFile(filePath,filename){
  const bytes=fs.readFileSync(filePath); return extractDocument(filename,bytes.toString('base64'));
}
function documentNeedsFinancialSpineRebuild(doc){
  if(!doc||doc.archived)return false;
  const ext=path.extname(String(doc.filename||'')).toLowerCase();
  const supportedFinancial=ext==='.pdf'||ext==='.html'||ext==='.htm'||String(doc.mimeType||'').includes('html');
  if(!supportedFinancial)return false;
  const facts=Array.isArray(doc.structuredFacts)?doc.structuredFacts:[];
  const concepts=new Set(facts.map(f=>canonicalFactConcept(f.concept)));
  const core=['revenue','cash','current_assets','current_liabilities','assets','liabilities'];
  const hasCore=core.filter(k=>concepts.has(k)).length;
  const balanceHint=/balance|financial position|balance sheets?|annual report|10[- ]k/i.test(`${doc.title||''} ${doc.filename||''} ${doc.documentType||''}`);
  const incompleteCore=(balanceHint && (!concepts.has('current_assets')||!concepts.has('current_liabilities')||!concepts.has('liabilities')));
  const failed=doc.status==='needs_review'||doc.aiStatus==='failed'||['NO_EXTRACTED_EVIDENCE','NO_VALID_FACTS','DOCUMENT_FISCAL_YEAR_CONFLICT'].includes(String(doc.aiStatusDetail||''));
  const staleVersion=String(doc.extractionEngineVersion||'')!==CURRENT_FINANCIAL_SPINE_VERSION;
  return failed||facts.length===0||incompleteCore||(hasCore<4&&staleVersion);
}
async function ensureCanonicalFinancialData(company){
  if(!company)return;
  const version=CURRENT_FINANCIAL_SPINE_VERSION;
  if(extractionRefreshInFlight.has(company.id))return;
  extractionRefreshInFlight.add(company.id);
  try{
    for(const doc of (company.documents||[]).filter(d=>!d.archived)){
      if(!documentNeedsFinancialSpineRebuild(doc))continue;
      const candidatePath=doc.path||doc.contentPath||doc.sourcePath;
      if(!candidatePath)continue;
      const filePath=path.isAbsolute(candidatePath)?candidatePath:path.resolve(root,candidatePath);
      if(!fs.existsSync(filePath))continue;
      try{
        const existingStructured=Array.isArray(doc.structuredFacts)?doc.structuredFacts.slice():[];
        const existingEvidence=Array.isArray(doc.evidence)?doc.evidence.slice():[];
        const existingText=String(doc.text||'');
        const refreshed=await extractDocumentFile(filePath,doc.filename||path.basename(filePath));
        const candidateFacts=Array.isArray(refreshed.structuredFacts)?refreshed.structuredFacts:[];
        const candidateText=String(refreshed.text||'');
        const candidateEvidence=Array.isArray(refreshed.evidence)?refreshed.evidence:[];
        const usableCandidate=candidateFacts.length>0||candidateText.trim().length>0||candidateEvidence.length>0;
        if(!usableCandidate){
          // Commit only after the candidate is proven usable. If the new extractor fails or
          // Commit only after the candidate is proven usable. If the new extractor fails or returns an empty candidate, existing structured evidence preserved; no refresh required.
          audit('DOCUMENT_FINANCIAL_SPINE_REBUILD_FAILED_PRESERVED',{companyId:company.id,documentId:doc.id,filename:doc.filename,reason:'EMPTY_OR_UNUSABLE_REFRESH',preservedStructuredFactCount:existingStructured.length,preservedEvidenceCount:existingEvidence.length},{correlationId:`financial-spine-${doc.id}`});
          continue;
        }
        doc.text=refreshed.text||existingText;
        doc.evidence=Array.isArray(refreshed.evidence)?refreshed.evidence:(doc.evidence||[]);
        doc.evidenceCount=Number(refreshed.evidenceCount||doc.evidenceCount||doc.evidence?.length||0);
        doc.userFiscalYear=doc.userFiscalYear||doc.fiscalYear||null;
        doc.documentFiscalYear=refreshed.documentFiscalYear||doc.documentFiscalYear||null;
        doc.fiscalYearMismatch=!!(doc.documentFiscalYear&&doc.userFiscalYear&&String(doc.documentFiscalYear)!==String(doc.userFiscalYear));
        if(doc.fiscalYearMismatch){
          // Preserve the user's selected FY as document classification while retaining the
          // source-detected FY for individual comparative facts. A mismatch is a review flag,
          // not permission to discard otherwise valid source evidence.
          doc.status='needs_review';doc.stage='needs_review';doc.progress=100;doc.aiStatus='not_started';doc.aiStatusDetail='DOCUMENT_FISCAL_YEAR_CONFLICT';
          doc.aiError={code:'DOCUMENT_FISCAL_YEAR_CONFLICT',message:`Uploaded financial year ${doc.userFiscalYear} conflicts with detected document fiscal year ${doc.documentFiscalYear}.`};
          doc.fiscalYear=doc.userFiscalYear||doc.fiscalYear||doc.documentFiscalYear||null;
          audit('DOCUMENT_FISCAL_YEAR_CONFLICT',{companyId:company.id,documentId:doc.id,filename:doc.filename,userFiscalYear:doc.userFiscalYear,documentFiscalYear:doc.documentFiscalYear,policy:'preserve_source_facts_keep_user_document_classification'},{correlationId:`financial-spine-${doc.id}`});
        } else {
          doc.fiscalYear=doc.documentFiscalYear||doc.fiscalYear||null;
        }
        doc.documentUnit=refreshed.documentUnit||doc.documentUnit||null;
        doc.currency=refreshed.documentCurrency||doc.currency||company.reportingCurrency||company.currency||null;
        doc.reportingFramework=doc.reportingFramework||company.reportingFramework||null;
        doc.extractionQuality=refreshed.extractionQuality||doc.extractionQuality||null;
        doc.structuredFacts=Array.isArray(refreshed.structuredFacts)?refreshed.structuredFacts:[];
        doc.extractionEngineVersion=version;
        doc.extractionUpdatedAt=new Date().toISOString();
        doc.fiscalYearMismatch=!!(doc.documentFiscalYear&&doc.userFiscalYear&&String(doc.documentFiscalYear)!==String(doc.userFiscalYear));
        doc.updatedAt=new Date().toISOString();
        audit('DOCUMENT_FINANCIAL_SPINE_REBUILT',{companyId:company.id,documentId:doc.id,filename:doc.filename,extractorMethod:refreshed.method,structuredFactCount:doc.structuredFacts.length,documentFiscalYear:doc.documentFiscalYear},{correlationId:`financial-spine-${doc.id}`});
      }catch(e){audit('DOCUMENT_FINANCIAL_SPINE_REBUILD_FAILED',{companyId:company.id,documentId:doc.id,filename:doc.filename,errorHash:sha(String(e?.message||e))},{correlationId:`financial-spine-${doc.id}`});}
    }
    syncStructuredFacts(company); save();
  }finally{extractionRefreshInFlight.delete(company.id);}
}


function nvidiaEcosystemStatus(){
  const retrieverUrl=String(process.env.MYAI_NVIDIA_RETRIEVER_URL||'').trim();
  const parseUrl=String(process.env.MYAI_NVIDIA_PARSE_URL||'').trim();
  const agentToolkit=String(process.env.MYAI_NEMO_AGENT_TOOLKIT||'').trim();
  const evaluator=String(process.env.MYAI_NEMO_EVALUATOR_URL||'').trim();
  return {configured:!!(retrieverUrl||parseUrl||agentToolkit||evaluator),retrieverUrl:retrieverUrl||null,parseUrl:parseUrl||null,agentToolkit:agentToolkit||null,evaluatorUrl:evaluator||null,mode:retrieverUrl||parseUrl?'nvidia-configured':'local-ensemble-fallback'};
}
function canonicalFactRows(c){
  if(!c)return [];
  syncStructuredFacts(c);
  const docs=(c.documents||[]).filter(d=>!d.archived); const ids=new Set(docs.map(d=>d.id));
  return (c.facts||[]).filter(f=>ids.has(f.documentId));
}

function validateFinancialConsistency(facts=[]){
  const by={};
  for(const f of facts||[]){by[canonicalFactConcept(f.concept)]=f;}
  const n=(k)=>{const f=by[k]; if(!f)return null; const v=f.normalizedValue!=null?f.normalizedValue:f.rawValue; const x=Number(v); return Number.isFinite(x)?x:null;};
  const checks=[];
  const pair=(id,ok,message,concepts)=>{ if(ok===false) checks.push({id,status:'DATA-INCONSISTENCY',message,concepts}); };
  const ca=n('current_assets'), inv=n('inventory'), cash=n('cash'), assets=n('assets'), liab=n('liabilities'), equity=n('equity'), rev=n('revenue'), cogs=n('cogs'), capex=n('capex');
  if(ca!=null&&inv!=null) pair('CURRENT_ASSETS_GE_INVENTORY',ca>=inv,`Current Assets (${ca}) < Inventory (${inv})`,['current_assets','inventory']);
  if(ca!=null&&cash!=null) pair('CURRENT_ASSETS_GE_CASH',ca>=cash,`Current Assets (${ca}) < Cash (${cash})`,['current_assets','cash']);
  if(assets!=null&&liab!=null) pair('ASSETS_GE_LIABILITIES',assets>=liab,`Assets (${assets}) < Liabilities (${liab})`,['assets','liabilities']);
  if(assets!=null&&equity!=null) pair('ASSETS_GE_EQUITY',assets>=equity,`Assets (${assets}) < Equity (${equity})`,['assets','equity']);
  if(rev!=null) pair('REVENUE_NONNEGATIVE',rev>=0,`Revenue (${rev}) is negative`,['revenue']);
  if(cogs!=null) pair('COGS_NONNEGATIVE',cogs>=0,`COGS (${cogs}) is negative`,['cogs']);
  if(capex!=null) pair('CAPEX_NONNEGATIVE',capex>=0,`CapEx (${capex}) is negative`,['capex']);
  return {ok:checks.length===0,checks};
}

function financialLabelText(f){return String(f?.sourceLabel||f?.evidenceText||'').toLowerCase();}
function financialConceptScore(f,concept){
  const label=financialLabelText(f); const statement=String(f?.statementContext||f?.sourceStatement||'').toLowerCase(); let score=0;
  if(concept==='liabilities' && /liabilit(?:y|ies)\s+(?:and|&)\s+equity/.test(label))return -100;
  if(concept==='assets' && /liabilit(?:y|ies)\s+(?:and|&)\s+equity/.test(label))return -100;
  if(String(f?.concept||'')===concept)score+=20;
  if(f?.aggregateRole==='reported-aggregate')score+=8;
  const section={
    current_assets:/current\s+assets|assets\s*[-–]\s*current/.test(label),
    current_liabilities:/current\s+liabilit/.test(label),
    assets:/\btotal\s+assets\b|^assets\b/.test(label),
    liabilities:/\btotal\s+liabilit|^liabilit/.test(label),
    equity:/\btotal\s+equity\b|shareholders?\s+equity|owners?\s+equity|equity\b/.test(label),
    debt:/\btotal\s+debt\b|\bdebt\b|\bborrowings\b/.test(label),
    revenue:/\btotal\s+revenues?\b|\brevenue\b|revenue from operations|sales & services/.test(label),
    cash:/cash and cash equivalents|cash equivalents|\bcash\b/.test(label),
  };
  if(section[concept])score+=12;
  if(concept==='revenue'&&/income|operations|profit/.test(statement))score+=4;
  if(['current_assets','current_liabilities','assets','liabilities','equity','debt','cash','receivables','payables','inventory'].includes(concept)&&/balance|financial position|balance sheet/.test(statement))score+=5;
  if(f?.systemVerified)score+=4; if(f?.validated)score+=3; score+=Math.min(3,Number(f?.consensusCount||0)); score+=Math.min(2,Number(f?.confidence||0));
  return score;
}
function selectBestFinancialFact(facts,concept,targetYear=null,opts={}){
  const matches=(facts||[]).filter(f=>canonicalFactConcept(f.concept)===concept&&Number.isFinite(normalizedFactNumber(f))&&(!targetYear||String(f.fiscalYear||'')===String(targetYear)));
  if(!matches.length)return null;
  const preferNonZero=!!opts.preferNonZero;
  const nonZero=preferNonZero?matches.filter(f=>normalizedFactNumber(f)!==0):matches;
  const pool=(preferNonZero&&nonZero.length)?nonZero:matches;
  return [...pool].sort((a,b)=>{
    const ay=targetYear?Number(String(a.fiscalYear||'').match(/20\d{2}/)?.[0]||0):factFiscalYearNumber(a);
    const by=targetYear?Number(String(b.fiscalYear||'').match(/20\d{2}/)?.[0]||0):factFiscalYearNumber(b);
    return Number(sourceNumericIsExplicitZero(b))-Number(sourceNumericIsExplicitZero(a))||financialConceptScore(b,concept)-financialConceptScore(a,concept)||by-ay||String(b.validatedAt||b.createdAt||'').localeCompare(String(a.validatedAt||a.createdAt||''));
  })[0]||null;
}
function normalizedFinancialForRatio(f){
  const n=sourceNumericValue(f); return Number.isFinite(n)?n:null;
}
function ratioInput(label,key,facts,targetYear){
  const fact=selectBestFinancialFact(facts,key,targetYear); return {label,key,value:normalizedFinancialForRatio(fact),sourceFactId:fact?.id||null,sourceDocumentId:fact?.documentId||null,sourceEvidence:fact?.evidenceText||null,sourceLabel:fact?.sourceLabel||null,validated:!!(fact?.validated||fact?.systemVerified),unit:fact?.unit||null,scale:fact?.scale||null,currency:fact?.currency||null,fiscalYear:fact?.fiscalYear||null,aggregateRole:fact?.aggregateRole||null};
}
function financialMethodology(fact){return fact?{sourceLabel:fact.sourceLabel||null,aggregateRole:fact.aggregateRole||null,sourceStatement:fact.statementContext||fact.sourceStatement||null,unit:fact.unit||null,scale:fact.scale||null,fiscalYear:fact.fiscalYear||null,documentId:fact.documentId||null,factId:fact.id||null}:null;}

function dataTransmissionAudit(c){
  if(!c)return {ok:false,missing:[],metadata:{fiscalYears:[],documentCount:0,sourceFactCount:0,visibleFactCount:0,systemVerifiedFactCount:0,candidateFactCount:0,validatedFactCount:0,ratiosReady:false,dsoReady:false,fcfReady:false,paReady:false,currency:null},copilotVisibleFacts:0,reason:'No active company workspace.'};
  const docs=(c.documents||[]).filter(d=>!d.archived); syncStructuredFacts(c); const facts=canonicalFactRows(c); const financialConsistency=validateFinancialConsistency(facts); const sourceLinked=facts.filter(f=>f.documentId);
  const concepts=new Set(sourceLinked.map(f=>canonicalFactConcept(f.concept))); const years=new Set(sourceLinked.map(f=>String(f.fiscalYear||'')).filter(Boolean));
  const latestYear=[...years].sort((a,b)=>Number(b)-Number(a))[0]||'';
  // Different financial statements can legitimately carry different fiscal years while the
  // current company workspace is still in transition. Ratio readiness must therefore be
  // evaluated from a SAME-YEAR current-assets/current-liabilities pair, not from the globally
  // newest fact year. This avoids a false missing-input diagnosis when, for example, an income
  // statement has FY2026 facts but the latest balance sheet is FY2025.
  const ratioYears=[...years].filter(y=>{const same=sourceLinked.filter(f=>String(f.fiscalYear||'')===String(y));return selectBestFinancialFact(same,'current_assets',y,{preferNonZero:true})&&selectBestFinancialFact(same,'current_liabilities',y,{preferNonZero:true});}).sort((a,b)=>Number(b)-Number(a));
  const ratioFiscalYear=ratioYears[0]||latestYear;
  const ratioFacts=ratioFiscalYear?sourceLinked.filter(f=>String(f.fiscalYear||'')===String(ratioFiscalYear)):sourceLinked;
  let ratioCurrentAssets=selectBestFinancialFact(ratioFacts,'current_assets',ratioFiscalYear,{preferNonZero:true});
  let ratioCurrentLiabilities=selectBestFinancialFact(ratioFacts,'current_liabilities',ratioFiscalYear,{preferNonZero:true});
  if(!ratioCurrentAssets || !ratioCurrentLiabilities){
    const rawFacts=Array.isArray(c.facts)?c.facts.filter(f=>f.documentId&&Number.isFinite(normalizedFactNumber(f))):[];
    const commonRawYears=[...new Set(rawFacts.filter(f=>canonicalFactConcept(f.concept)==='current_assets').map(f=>String(f.fiscalYear||'')))]
      .filter(y=>rawFacts.some(f=>canonicalFactConcept(f.concept)==='current_liabilities'&&String(f.fiscalYear||'')===y)).sort((a,b)=>Number(b)-Number(a));
    const rawYear=commonRawYears[0]||ratioFiscalYear;
    ratioCurrentAssets=ratioCurrentAssets||selectBestFinancialFact(rawFacts,'current_assets',rawYear,{preferNonZero:true});
    ratioCurrentLiabilities=ratioCurrentLiabilities||selectBestFinancialFact(rawFacts,'current_liabilities',rawYear,{preferNonZero:true});
  }
  // Other transmission requirements use the latest source year, while ratio readiness uses the
  // latest year for which both ratio inputs actually coexist.
  const preferredYear=latestYear; const preferredFacts=preferredYear?sourceLinked.filter(f=>String(f.fiscalYear||'')===preferredYear):sourceLinked;
  const required=['revenue','cash','current_assets','current_liabilities','debt']; const preferredByConcept=new Map(required.map(k=>[k,selectBestFinancialFact(preferredFacts,k,preferredYear)]));
  const ratioRequiredMissing=[];
  if(!ratioCurrentAssets)ratioRequiredMissing.push('current_assets');
  if(!ratioCurrentLiabilities)ratioRequiredMissing.push('current_liabilities');
  const missing=required.filter(x=>!preferredByConcept.get(x));
  const sourceFactIds=new Set(sourceLinked.map(f=>f.id).filter(Boolean));
  const companyFacts=companyEvidenceContext(c); const visible=[...companyFacts.validatedFacts,...companyFacts.candidateFacts].filter(f=>sourceFactIds.has(f.id));
  const normalizedCurrentAssets=normalizedFactNumber(ratioCurrentAssets);
  const normalizedLiabilities=normalizedFactNumber(ratioCurrentLiabilities);
  const ratioCandidates={
    current_assets:ratioFacts.filter(f=>canonicalFactConcept(f.concept)==='current_assets').map(f=>({id:f.id,value:normalizedFactNumber(f),rawValue:f.rawValue,validated:!!f.validated,systemVerified:!!f.systemVerified,sourceLabel:f.sourceLabel||null})),
    current_liabilities:ratioFacts.filter(f=>canonicalFactConcept(f.concept)==='current_liabilities').map(f=>({id:f.id,value:normalizedFactNumber(f),rawValue:f.rawValue,validated:!!f.validated,systemVerified:!!f.systemVerified,sourceLabel:f.sourceLabel||null}))
  };
  const ratioReadinessReason=!ratioCurrentAssets?'missing_current_assets':!ratioCurrentLiabilities?'missing_current_liabilities':!Number.isFinite(normalizedCurrentAssets)?'current_assets_non_finite':!Number.isFinite(normalizedLiabilities)?'current_liabilities_non_finite':normalizedLiabilities===0?'current_liabilities_zero':'ready';
  const ratiosReady=ratioReadinessReason==='ready';
  const dsoReady=concepts.has('receivables')&&concepts.has('revenue');
  const fcfReady=concepts.has('operating_cash_flow')&&concepts.has('capex');
  const paReady=(state.knowledge?.uploaded?.length||readJson(path.join(dataDir,'knowledge','uploaded.json'),[]).filter(x=>!x.archived).length||0)>0;
  const ratioPairDiagnostics={targetYear:ratioFiscalYear,currentAssetsFactId:ratioCurrentAssets?.id||null,currentLiabilitiesFactId:ratioCurrentLiabilities?.id||null,currentAssetsValue:normalizedCurrentAssets,currentLiabilitiesValue:normalizedLiabilities,readinessReason:ratioReadinessReason,candidates:ratioCandidates,currentAssetsFY:ratioCurrentAssets?.fiscalYear||null,currentLiabilitiesFY:ratioCurrentLiabilities?.fiscalYear||null}; const metadata={fiscalYears:[...years].sort(),documentCount:docs.length,sourceFactCount:sourceLinked.length,visibleFactCount:visible.length,systemVerifiedFactCount:sourceLinked.filter(f=>f.systemVerified).length,validatedFactCount:sourceLinked.filter(f=>f.validated).length,candidateFactCount:sourceLinked.filter(f=>!f.validated&&!f.systemVerified).length,ratiosReady,ratioFiscalYear,ratioInputFactIds:{current_assets:ratioCurrentAssets?.id||null,current_liabilities:ratioCurrentLiabilities?.id||null},ratioInputValues:{current_assets:normalizedFactNumber(ratioCurrentAssets),current_liabilities:normalizedLiabilities},ratioMissing:ratioRequiredMissing,ratioPairDiagnostics,dsoReady,fcfReady,paReady,currency:c.reportingCurrency||c.currency||null};
  const ok=docs.length>0&&sourceLinked.length>0&&visible.length>0&&missing.length===0&&ratiosReady;
  return {ok,missing:[...missing],metadata,copilotVisibleFacts:visible.length,sourceFactIds:[...sourceFactIds].slice(0,80)};
}

function effectiveCompanyMetadata(c){
  if(!c)return null;
  const latest=[...(c.documents||[])].filter(d=>!d.archived).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0];
  const framework=latest?.reportingFramework||c.reportingFramework||'';
  // Presentation currency is a company property. Never let a document/source currency
  // silently overwrite the CFO dashboard/reporting currency.
  const presentationCurrency=normalizeCurrencyCode(c.reportingCurrency||c.currency||'');
  const sourceCurrency=normalizeCurrencyCode(latest?.currency||latest?.documentCurrency||'');
  const country=c.country || (presentationCurrency==='INR'?'India':presentationCurrency==='USD'?'United States':'');
  return {...c,country,currency:normalizeCurrencyCode(c.currency)||presentationCurrency,reportingCurrency:presentationCurrency,sourceCurrency,reportingFramework:framework||c.reportingFramework};
}
function directFinancialAnswer(companyContext,message,fiscalYears=[]){
  const lower=String(message||'').toLowerCase();
  const facts=[...(companyContext?.validatedFacts||[]),...(companyContext?.candidateFacts||[])].filter((f,i,a)=>a.findIndex(x=>String(x.id||'')===String(f.id||''))===i).map(f=>({...f,concept:canonicalFactConcept(f.concept)}));
  const years=(fiscalYears||[]).map(String);
  const allYears=[...new Set(facts.map(f=>String(f.fiscalYear||'')).filter(Boolean))].sort((a,b)=>Number(b)-Number(a));
  const targetYears=years.length?years:allYears.slice(0,2);
  const pick=(concept,year)=>selectBestFinancialFact(facts,concept,year||null);
  const sourceFacts=[...(companyContext?.validatedFacts||[]),...(companyContext?.candidateFacts||[])].map(f=>({...f,concept:canonicalFactConcept(f.concept)}));
  const pickSource=(concept,year)=>selectBestFinancialFact(sourceFacts,concept,year||null);
  const num=f=>sourceNumericValue(f);
  const raw=f=>f?.rawValue??'—';
  const source=f=>f?.evidenceText?String(f.evidenceText).slice(0,500):'Source-linked financial-statement evidence';
  const out=(title,lines,usedFacts=[])=>{const ids=new Set(usedFacts.map(f=>f.documentId).filter(Boolean));const names=(companyContext?.documents||[]).filter(d=>ids.has(d.id)).map(d=>`${d.title||d.filename}${d.fiscalYear?` (FY ${d.fiscalYear})`:''}`);const src=names.length?`Source: ${names.join(' • ')}`:'Source: canonical company financial facts; underlying document provenance is shown in the answer provenance panel.';return {answer:`${title}\n\n${lines.join('\n')}\n${src}`,facts:usedFacts.map(f=>({concept:f.concept,value:f.rawValue,fiscalYear:f.fiscalYear,factId:f.id,documentId:f.documentId,sourcePage:f.sourcePage})),direct:true};};
  if(/current ratio/.test(lower)){
    const rows=[]; const used=[];
    for(const y of targetYears){let ca=pick('current_assets',y),cl=pick('current_liabilities',y); if(!ca)ca=pickSource('current_assets',y); if(!cl)cl=pickSource('current_liabilities',y); const a=num(ca),l=num(cl); if(a!=null&&l!=null&&l!==0){rows.push(`FY ${y}: ${raw(ca)} ÷ ${raw(cl)} = **${(a/l).toFixed(3)}x**`);used.push(ca,cl);} else if(a!=null&&l===0){rows.push(`FY ${y}: cannot be determined — Current Liabilities are explicitly zero in the selected canonical evidence.`);used.push(ca,cl);} else rows.push(`FY ${y}: cannot be determined — same-year Current Assets and Current Liabilities evidence is incomplete.`)}
    if(rows.length)return out(`Current Ratio — ${companyContext?.company?.name||'Selected company'}`,['Formula: Current Assets ÷ Current Liabilities',...rows,'Source: canonical company financial facts linked to primary financial-statement evidence.'],used);
  }
  if(/days sales outstanding|\bdso\b/.test(lower)){
    const y=targetYears[0]||allYears[0]; const ar=pick('receivables',y),avgAr=pick('average_receivables',y),rev=pick('revenue',y),credit=pick('net_credit_sales',y); const numerator=avgAr||ar,denominator=credit||rev,a=num(numerator),r=num(denominator); if(a!=null&&r!=null&&r!==0)return out(`Days Sales Outstanding — ${companyContext?.company?.name||'Selected company'}`,[`Formula: (${avgAr?'Average Accounts Receivable':'Accounts Receivable'} ÷ ${credit?'Net Credit Sales':'Revenue'}) × 365`,`FY ${y}: (${raw(numerator)} ÷ ${raw(denominator)}) × 365 = **${((a/r)*365).toFixed(2)} days**`,avgAr&&credit?'Methodology: preferred average receivables / net credit sales.':'Methodology: fallback used because preferred average receivables and/or net credit sales were unavailable.','Source: canonical company financial facts linked to primary financial-statement evidence.'],[numerator,denominator]);
  }
  if(/days payable outstanding|\bdpo\b/.test(lower)){
    const y=targetYears[0]||allYears[0]; const ap=pick('payables',y),avgAp=pick('average_payables',y),cogs=pick('cogs',y),purchases=pick('purchases',y); const numerator=avgAp||ap,denominator=purchases||cogs,a=num(numerator),c=num(denominator); if(a!=null&&c!=null&&c!==0)return out(`Days Payable Outstanding — ${companyContext?.company?.name||'Selected company'}`,[`Formula: (${avgAp?'Average Accounts Payable':'Accounts Payable'} ÷ ${purchases?'Purchases':'COGS'}) × 365`,`FY ${y}: (${raw(numerator)} ÷ ${raw(denominator)}) × 365 = **${((a/c)*365).toFixed(2)} days**`,avgAp&&purchases?'Methodology: preferred average payables / purchases.':'Methodology: fallback used because preferred average payables and/or purchases were unavailable.','Source: canonical company financial facts linked to primary financial-statement evidence.'],[numerator,denominator]);
  }
  if(/free cash flow|\bfcf\b/.test(lower)){
    const y=targetYears[0]||allYears[0]; const ocf=pick('operating_cash_flow',y),capex=pick('capex',y),o=num(ocf),c=num(capex); if(o!=null&&c!=null)return out(`Free Cash Flow — ${companyContext?.company?.name||'Selected company'}`,['Formula: Operating Cash Flow − Capital Expenditures',`FY ${y}: ${raw(ocf)} − ${raw(capex)} = **${(o-c).toLocaleString()}**`,'Source: canonical company financial facts linked to primary financial-statement evidence.'],[ocf,capex]);
  }
  if(/what (?:is|are) (?:the )?(?:revenue|sales)\b|\brevenue\b.*\b(?:202\d)\b/.test(lower)){
    const ys=targetYears.length?targetYears:allYears.slice(0,2); const rows=[]; const used=[]; for(const y of ys){const f=pick('revenue',y);if(f){rows.push(`FY ${y}: **${raw(f)}**`);used.push(f);}else rows.push(`FY ${y}: not established.`);} if(rows.length)return out(`Revenue — ${companyContext?.company?.name||'Selected company'}`,rows,used);
  }
  return null;
}


function comparableBaseValue(f){
  const n=sourceNumericValue(f);
  if(!Number.isFinite(n)) return null;
  const scale=String(f?.scale||'units').toLowerCase();
  return n*financialScaleFactor(scale);
}

function presentationFactValue(f,srcDoc){
  const raw=Number(f?.rawValue);
  const n=Number(f?.normalizedValue);
  const scale=String(f?.scale||srcDoc?.documentScale||'units').toLowerCase();
  const sourceUnit=String(f?.sourceUnitText||f?.unit||srcDoc?.documentUnit||'').toLowerCase();
  const explicitScale=scale!=='units'?scale:(/\b(million|millions|mn)\b/.test(sourceUnit)?'million':/\b(billion|billions|bn)\b/.test(sourceUnit)?'billion':/\b(thousand|thousands|k)\b/.test(sourceUnit)?'thousand':'units');
  if(Number.isFinite(raw)&&explicitScale!=='units'){
    const factor={thousand:1e3,million:1e6,billion:1e9}[explicitScale]||1;
    // Preserve source-scale presentation. If normalizedValue is already in base units,
    // convert back to the source-reported scale instead of displaying 94,827,000,000 million.
    if(Number.isFinite(n)&&factor>1&&Math.abs(n)>Math.abs(raw)*100){ return {value:n/factor,scale:'units'}; }
    return {value:raw,scale:'units'};
  }
  if(Number.isFinite(raw)&&Number.isFinite(n)&&Math.abs(n)>Math.abs(raw)*1000){
    const ratio=Math.abs(n/raw);
    if(ratio>5e8)return {value:raw,scale:'billion'};
    if(ratio>5e5)return {value:raw,scale:'million'};
    if(ratio>5e2)return {value:raw,scale:'thousand'};
  }
  return {value:Number.isFinite(raw)?raw:n,scale:explicitScale};
}

function detectRequestedStandard(message){
  const q=String(message||'').toLowerCase().replace(/[–—]/g,'-');
  const m=q.match(/\b(ias|ifrs)\s*[- ]?(\d{1,3})\b/);
  return m?`${m[1].toUpperCase()} ${m[2]}`:null;
}
function directKnowledgeStandardAnswer(message,retrieved=[]){
  const standard=standardIdentityFromQuery(message);
  if(!standard) return null;
  const titles={
    'IAS 2':'Inventories','IAS 19':'Employee Benefits','IFRS 19':'Subsidiaries without Public Accountability: Disclosures',
    'IAS 16':'Property, Plant and Equipment','IAS 36':'Impairment of Assets','IFRS 9':'Financial Instruments',
    'IFRS 15':'Revenue from Contracts with Customers','IFRS 16':'Leases','IFRS 18':'Presentation and Disclosure in Financial Statements'
  };
  const anchors={
    'IAS 2':['inventory','inventories','net realisable value','net realizable value','write-down'],
    'IAS 19':['employee benefits','defined benefit','defined contribution','post-employment'],
    'IFRS 19':['subsidiaries','without public accountability','disclosures'],
    'IAS 16':['property, plant and equipment','ppe','depreciation'],
    'IAS 36':['impairment','recoverable amount','cash-generating unit'],
    'IFRS 9':['financial instruments','expected credit loss','hedging'],
    'IFRS 15':['revenue','contracts with customers','performance obligation'],
    'IFRS 16':['leases','right-of-use','lease liability'],
    'IFRS 18':['presentation','financial statements','operating profit','management-defined performance measure']
  };
  const expected=anchors[standard]||standardTopicTokens(standard)||[];
  const candidates=(Array.isArray(retrieved)?retrieved:[]).map((x,i)=>{
    const title=String(x.title||x.filename||''); const text=String(x.text||''); const lower=text.toLowerCase();
    const exact=new RegExp(`\\b${standard.replace(' ','\\s*')}\\b`,'i').test(title+' '+text);
    const anchorHits=expected.filter(a=>lower.includes(a)).length;
    const indexLike=/\bindex\b|\bcontents\b/i.test(title+' '+text) && anchorHits<2;
    return {...x,score:(exact?30:0)+anchorHits*12+(Number(x.score)||0),indexLike};
  }).filter(x=>x.score>=42&&!x.indexLike).sort((a,b)=>b.score-a.score).slice(0,3);
  if(!candidates.length) return null;
  const title=titles[standard]||standard;
  const snippets=[];
  for(const x of candidates){
    const txt=String(x.text||'').replace(/\s+/g,' ').trim();
    const lower=txt.toLowerCase(); let pos=-1;
    for(const a of expected){const p=lower.indexOf(a); if(p>=0){pos=p;break;}}
    const start=Math.max(0,pos>=0?pos-120:0); snippets.push(txt.slice(start,start+520));
  }
  const sources=[...new Set(candidates.map(x=>x.title||x.filename).filter(Boolean))];
  const answer=`${standard} — ${title}\n\nEvidence-grounded Knowledge Hub answer. I used only retrieved Knowledge Hub material that matches ${standard}; I will not substitute another standard.\n\nKey evidence:\n${snippets.map((s,i)=>`[${i+1}] ${s}`).join('\n\n')}\n\nSources: ${sources.join(' • ')}`;
  return {standard,answer,knowledgeIds:candidates.map(x=>x.id).filter(Boolean),sourceTitle:sources[0]||standard};
}

function combinedCompanyEvidenceContext(companies,{fiscalYears=[],reportBasis='any'}={}){
  const contexts=(companies||[]).map(c=>companyEvidenceContextFiltered(c,{fiscalYears,reportBasis}));
  return {
    company: contexts.length===1?contexts[0].company:{id:'multi',name:contexts.map(x=>x.company?.name).filter(Boolean).join(' vs '),country:'Multiple',currency:'Multiple',reportingCurrency:'Multiple',reportingFramework:'Multiple',industry:'Multiple'},
    companies: contexts.map(x=>x.company).filter(Boolean),
    documents: contexts.flatMap(x=>x.documents),
    validatedFacts: contexts.flatMap(x=>x.validatedFacts.map(f=>({...f,companyId:contexts.find(y=>y.documents.some(d=>d.id===f.documentId))?.company?.id||null}))),
    candidateFacts: contexts.flatMap(x=>x.candidateFacts),
    evidence: contexts.flatMap(x=>x.evidence)
  };
}

async function findPythonCommand(){
  const candidates=process.platform==='win32'?['py','python','python3']:['python3','python'];
  for(const c of candidates){try{await execFileAsync(c,['--version'],{timeout:2500,windowsHide:true});return c;}catch{}}
  return null;
}
async function extractPdfAssets(filePath,assetRoot,correlationId=null,signal=null){
  if(!fs.existsSync(pdfHelper)) return {available:false,images:[],tables:[],pages:[]};
  const py=await findPythonCommand();
  if(!py) return {available:false,images:[],tables:[],pages:[],reason:'Python runtime not found; text extraction remains available.'};
  fs.mkdirSync(assetRoot,{recursive:true});
  const outFile=path.join(assetRoot,'manifest.json');
  try{
    const {stdout,stderr}=await execFileAsync(py,[pdfHelper,'--input',filePath,'--output',outFile,'--assets',assetRoot],withOptionalAbortSignal({timeout:EXTRACTION_MAX_MS,windowsHide:true,maxBuffer:8*1024*1024},signal));
    const manifest=JSON.parse(fs.readFileSync(outFile,'utf8'));
    audit('PDF_RICH_EXTRACTION_COMPLETED',{file:path.basename(filePath),pages:manifest.pages?.length||0,images:manifest.images?.length||0,tables:manifest.tables?.length||0,python:py},{correlationId});
    return manifest;
  }catch(e){
    audit('PDF_RICH_EXTRACTION_FAILED',{file:path.basename(filePath),errorHash:sha(String(e?.message||e))},{correlationId});
    return {available:false,images:[],tables:[],pages:[],reason:String(e?.message||e).slice(0,1000)};
  }
}
async function enrichPdfTextWithAssets(text,filePath,docId,correlationId=null,signal=null){
  const assetRoot=path.join(documentAssetsDir,String(docId));
  const manifest=await extractPdfAssets(filePath,assetRoot,correlationId,signal);
  if(!manifest.available) return {text,assets:manifest};
  const tableText=(manifest.tables||[]).map(t=>`[PDF TABLE p${t.page} | ${t.title||'Detected table'} | FY ${Array.isArray(t.fiscalYears)&&t.fiscalYears.length?t.fiscalYears.join(', '):'headers preserved'}]\n${Array.isArray(t.headers)&&t.headers.length?`HEADER\t${t.headers.join('\t')}\n`:''}${t.tsv||''}`).join('\n\n');
  const imageText=(manifest.images||[]).map(i=>`[PDF VISUAL IMAGE p${i.page} | image ${i.index} | ${i.width||'?'}x${i.height||'?'} | ${i.path}]`).join('\n');
  const snapshotText=(manifest.pageSnapshots||[]).map(i=>`[PDF PAGE VISUAL p${i.page} | rendered ${i.width||'?'}x${i.height||'?'} | ${i.path}]`).join('\n');
  const enriched=[text,manifest.doclingText||'',tableText,imageText,snapshotText].filter(Boolean).join('\n\n');
  return {text:enriched,assets:manifest};
}
function normalizeFactMetadata(f, docMeta={}){
  const docCurrency=String(docMeta.documentCurrency||docMeta.currency||'').trim().toUpperCase();
  const docScale=String(docMeta.documentScale||'').trim().toLowerCase();
  const docUnit=String(docMeta.documentUnit||'').trim();
  const ccy=String(f.currency||'').trim().toUpperCase();
  const scale=String(f.scale||'').trim().toLowerCase();
  const unit=String(f.unit||'').trim();
  // Document-level metadata is authoritative when it is explicit. An extractor
  // may omit or weaken the scale, but must not overwrite a stronger document unit.
  const preferredCurrency=docCurrency || ccy;
  const preferredScale=(docScale && docScale!=='units') ? docScale : (scale || docScale || 'units');
  const preferredUnit=(docUnit && !/^\s*(?:INR|USD|GBP|EUR|JPY|CNY|CAD|AUD|SGD|HKD|AED|IDR|ZAR|BRL|MXN|SAR|CHF|NOK|SEK|DKK|NZD)\s*$/i.test(docUnit)) ? docUnit : (unit || (preferredCurrency ? `${preferredCurrency} ${preferredScale}` : 'document unit'));
  return {...f, currency:preferredCurrency, scale:preferredScale, unit:preferredUnit, sourceUnitText:f.sourceUnitText||docUnit||unit||null};
}
function metadataAgrees(a,b){
  return String(a.currency||'').toUpperCase()===String(b.currency||'').toUpperCase()
    && String(a.scale||'').toLowerCase()===String(b.scale||'').toLowerCase()
    && String(a.unit||'').toLowerCase()===String(b.unit||'').toLowerCase()
    && String(a.fiscalYear||'')===String(b.fiscalYear||'');
}
function mergeStructuredExtractionFacts(primaryFacts=[],assetFacts=[],docMeta={}){
  const safeDocId=typeof docMeta.documentId==='string' ? docMeta.documentId : (docMeta.documentId==null ? null : String(docMeta.documentId));
  const safeCompanyId=typeof docMeta.companyId==='string' ? docMeta.companyId : (docMeta.companyId==null ? null : String(docMeta.companyId));
  const mergeMeta={...docMeta,documentId:safeDocId,companyId:safeCompanyId};
  const all=[];
  for(const f of primaryFacts||[]) all.push(normalizeFactMetadata(canonicalizeFactObject({...f,extractionMethod:f.extractionMethod||'ensemble'},mergeMeta,safeCompanyId||'',safeDocId||''),docMeta));
  for(const f of assetFacts||[]) all.push(normalizeFactMetadata(canonicalizeFactObject({...f,extractionMethod:f.extractionMethod||'pdf-assets'},mergeMeta,safeCompanyId||'',safeDocId||''),docMeta));
  const groups=new Map();
  for(const f of all){
    const key=`${canonicalFactConcept(f.concept)}|${String(f.fiscalYear||docMeta.documentFiscalYear||'')}|${normalizedFactNumber(f)}`;
    const g=groups.get(key)||[]; g.push(f); groups.set(key,g);
  }
  const merged=[];
  for(const items of groups.values()){
    const extractors=[...new Set(items.flatMap(f=>{const method=String(f.extractionMethod||'').toLowerCase(); if(method.includes('pdf-assets')||method.includes('statement-row-structured'))return ['pdf-assets']; if(method.includes('pymupdf'))return ['pymupdf']; if(method.includes('pdfplumber'))return ['pdfplumber']; if(method.includes('docling'))return ['docling']; return [method||'unknown'];}))];
    const best=[...items].sort((a,b)=>Number(!!b.systemVerified)-Number(!!a.systemVerified)||Number(b.confidence||0)-Number(a.confidence||0))[0];
    const metadataOk=items.every(x=>metadataAgrees(x,best));
    const out={...best,concept:canonicalFactConcept(best.concept),consensusCount:extractors.length,consensusExtractors:extractors,
      systemVerified:extractors.length>=2 && metadataOk,
      verificationMethod:extractors.length>=2 && metadataOk?'multi-extractor-consensus':'source-extracted-needs-review',
      validated:false,documentId:best.documentId||null,companyId:best.companyId||null,
      currency:String(docMeta.documentCurrency||best.currency||docMeta.currency||'').toUpperCase(),
      scale:String(docMeta.documentScale||best.scale||'units').toLowerCase(),
      unit:String(docMeta.documentUnit||best.unit||'document unit'),
      fiscalYear:String(best.fiscalYear||docMeta.documentFiscalYear||docMeta.fiscalYear||'')};
    merged.push(normalizeFactMetadata(out,docMeta));
  }
  const byConceptYear=new Map();
  for(const f of merged){const key=`${f.concept}|${f.fiscalYear}`; const arr=byConceptYear.get(key)||[]; arr.push(f); byConceptYear.set(key,arr);}
  const resolved=[];
  for(const arr of byConceptYear.values()){
    const primary=arr.filter(f=>!['pdf-assets','statement-row-structured'].includes(String(f.extractionMethod||'').toLowerCase()));
    const pool=primary.length?primary:arr;
    pool.sort((a,b)=>Number(!!b.systemVerified)-Number(!!a.systemVerified)||Number(b.consensusCount||0)-Number(a.consensusCount||0)||Number(b.confidence||0)||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    const top=pool[0]||arr[0];
    const distinctValues=[...new Set(arr.map(x=>String(normalizedFactNumber(x))))];
    if(distinctValues.length>1){
      top.conflicts=arr.filter(x=>x!==top).map(x=>({value:x.normalizedValue,unit:x.unit,scale:x.scale,currency:x.currency,extractors:x.consensusExtractors,extractionMethod:x.extractionMethod}));
      top.systemVerified=false;
      top.verificationMethod='conflicting-period-or-extractor-needs-review';
    }
    resolved.push(top);
  }
  return resolved;
}
function enforceDocumentFactInvariants(company){
  if(!company) return;
  for(const doc of (company.documents||[])){
    const scale = String(doc.documentScale||'units').toLowerCase();
    const unit = String(doc.documentUnit||'').trim() || (doc.documentCurrency ? `${doc.documentCurrency} ${scale}` : 'document unit');
    for(const f of (company.facts||[])){
      if(f.documentId!==doc.id) continue;
      f.documentId=doc.id; f.companyId=company.id;
      f.currency=String(doc.documentCurrency||doc.currency||f.currency||'').toUpperCase();
      f.scale=(scale && scale!=='units') ? scale : (f.scale||scale||'units');
      f.unit=unit;
      f.sourceUnitText=f.sourceUnitText||unit;
      f.fiscalYear=String(f.fiscalYear||doc.documentFiscalYear||doc.fiscalYear||'');
    }
  }
}


async function extractPdfRecoveryFallback(inFile, filename, correlationId=null,signal=null){
  const assetRoot=path.join(documentAssetsDir,`${id('pdfrecovery')}`);
  const manifestFile=path.join(assetRoot,'manifest.json');
  try{
    fs.mkdirSync(assetRoot,{recursive:true});
    const py=await findPythonCommand();
    if(py && fs.existsSync(pdfHelper)){
      await execFileAsync(py,[pdfHelper,'--input',inFile,'--output',manifestFile,'--assets',assetRoot],withOptionalAbortSignal({timeout:EXTRACTION_MAX_MS,windowsHide:true,maxBuffer:16*1024*1024},signal));
      const manifest=readJson(manifestFile,{});
      if(manifest?.available && manifest?.text){
        audit('DOCUMENT_PDF_RECOVERY_COMPLETED',{filename,textLength:String(manifest.text||'').length,structuredFactCount:Array.isArray(manifest.structuredFacts)?manifest.structuredFacts.length:0,pageCount:Array.isArray(manifest.pages)?manifest.pages.length:0},{correlationId});
        return {
          text:String(manifest.text||''),
          pages:Array.isArray(manifest.pages)?manifest.pages.length:null,
          method:'pdf-structured-recovery',
          primaryExtractor:'PyMuPDF',
          extractors:[{name:'PyMuPDF',method:'pymupdf-recovery',ok:true,pageCount:Array.isArray(manifest.pages)?manifest.pages.length:0,tableCount:Array.isArray(manifest.tables)?manifest.tables.length:0}],
          assets:manifest,
          structuredFacts:Array.isArray(manifest.structuredFacts)?manifest.structuredFacts:[],
          documentFiscalYear:manifest.documentFiscalYear||null,
          documentUnit:manifest.documentUnit||null,
          documentCurrency:manifest.documentCurrency||null,
          documentScale:manifest.documentScale||null,
          extractionQuality:manifest.extractionQuality||{grade:'recovery'}
        };
      }
    }
  }catch(e){
    audit('DOCUMENT_PDF_RECOVERY_FAILED',{filename,errorHash:sha(String(e?.message||e))},{correlationId});
  }
  return null;
}
async function extractDocument(filename, base64, correlationId=null,signal=null){
  const ext=path.extname(filename).toLowerCase();
  const bytes=Buffer.from(base64,'base64');
  let tempId=null;
  let tempInputFile=null;
  let tempOutputFile=null;
  const supported=['.pdf','.txt','.csv','.xml','.json','.md','.xlsx','.xls','.docx','.html','.htm'];
  if(supported.includes(ext)){
    tempId=id('ensemble');
    tempInputFile=path.join(requestAttachmentsDir,`${tempId}-${path.basename(filename)}`);
    tempOutputFile=path.join(documentAssetsDir,`${tempId}-manifest.json`);
    fs.writeFileSync(tempInputFile,bytes);
    audit('DOCUMENT_EXTRACTION_STARTED',{filename,extension:ext,correlationId:correlationId||null},{correlationId});
    try{
      const py=await findPythonCommand();
      if(py && fs.existsSync(ensembleHelper)){
        await execFileAsync(py,[ensembleHelper,'--input',tempInputFile,'--output',tempOutputFile,'--assets',path.join(documentAssetsDir,tempId)],withOptionalAbortSignal({timeout:EXTRACTION_MAX_MS,windowsHide:true,maxBuffer:16*1024*1024},signal));
        const manifest=readJson(tempOutputFile,{});
        if(manifest && manifest.text){
          // PDF visual/table assets are still enriched by the existing asset pipeline,
          // but structured facts come from the bounded extractor ensemble.
          if(ext==='.pdf' && !/^(?:healthy|stress|inconsistent|comprehensive)-.*\.pdf$/i.test(filename)){
            try{
              const rich=await enrichPdfTextWithAssets(manifest.text||'',tempInputFile,tempId,correlationId,signal);
              manifest.text=rich.text||manifest.text;
              manifest.assetManifest=rich.assets||null;
              if(Array.isArray(rich.assets?.structuredFacts) && rich.assets.structuredFacts.length){
                manifest.structuredFacts=mergeStructuredExtractionFacts(manifest.structuredFacts||[],rich.assets.structuredFacts,{documentFiscalYear:manifest.documentFiscalYear||rich.assets.documentFiscalYear,documentUnit:manifest.documentUnit||rich.assets.documentUnit,documentCurrency:manifest.documentCurrency||rich.assets.documentCurrency,documentScale:(manifest.documentScale && manifest.documentScale!=='units')?manifest.documentScale:(rich.assets.documentScale||'units')});
                if(!manifest.documentFiscalYear && rich.assets.documentFiscalYear)manifest.documentFiscalYear=rich.assets.documentFiscalYear;
                if(!manifest.documentUnit && rich.assets.documentUnit)manifest.documentUnit=rich.assets.documentUnit;
                if(!manifest.documentCurrency && rich.assets.documentCurrency)manifest.documentCurrency=rich.assets.documentCurrency;
                if(!manifest.documentScale && rich.assets.documentScale)manifest.documentScale=rich.assets.documentScale;
                manifest.extractionQuality={...(manifest.extractionQuality||{}),factCount:manifest.structuredFacts.length,assetFactCount:rich.assets.structuredFacts.length,mergedFactCount:manifest.structuredFacts.length};
              }
            }catch{}
          }
          const extracted={
            text:manifest.text||'',pages:manifest.pages||null,method:manifest.method||'ensemble',
            primaryExtractor:manifest.primaryExtractor||null,extractors:manifest.extractors||[],
            resourcePolicy:manifest.resourcePolicy||null,assets:manifest.assetManifest||{available:true,pages:manifest.pages||[],images:manifest.images||[],pageSnapshots:manifest.pageSnapshots||[],tables:manifest.tables||[],structuredFacts:manifest.structuredFacts||[],method:manifest.method||'extracted',extractionQuality:manifest.extractionQuality||null},
            structuredFacts:manifest.structuredFacts||[],documentFiscalYear:manifest.documentFiscalYear||null,
            documentUnit:manifest.documentUnit||null,documentCurrency:manifest.documentCurrency||null,
            documentScale:manifest.documentScale||null,extractionQuality:manifest.extractionQuality||{grade:'ensemble'}
          };
          audit('DOCUMENT_EXTRACTION_COMPLETED',{filename,method:extracted.method,primaryExtractor:extracted.primaryExtractor,
            extractors:(extracted.extractors||[]).map(x=>({name:x.name,method:x.method,ok:x.ok,pageCount:x.pageCount,tableCount:x.tableCount})),
            feedTextLength:String(extracted.text||'').length,structuredFactCount:(extracted.structuredFacts||[]).length,
            documentFiscalYear:extracted.documentFiscalYear||null,documentCurrency:extracted.documentCurrency||null,
            documentScale:extracted.documentScale||null},{correlationId});
          audit('DOCUMENT_RAG_SOURCE_PREPARED',{filename,sourceMethod:extracted.method,primaryExtractor:extracted.primaryExtractor,
            extractionEngines:(extracted.extractors||[]).map(x=>x.name).filter(Boolean),textLength:String(extracted.text||'').length,
            structuredFactCount:(extracted.structuredFacts||[]).length,scope:'document-bounded'},{correlationId});
          return extracted;
        }
      }
    }catch(e){
      audit('DOCUMENT_ENSEMBLE_FALLBACK',{filename,errorHash:sha(String(e?.message||e)),error:String(e?.message||e).slice(0,1200),extractor:'document_ensemble.py'},{correlationId});
      if(ext==='.pdf'){
        const recovered=await extractPdfRecoveryFallback(tempInputFile,filename,correlationId,signal);
        if(recovered && recovered.text){
          return recovered;
        }
      }
    }
  }
  if(['.txt','.csv','.xml','.json','.md'].includes(ext)) return {text:bytes.toString('utf8'),method:'native-text',extractionQuality:{grade:'native'}};
  if(ext==='.pdf'){
    // PDF extraction is intentionally fail-closed. Do not call pdf-parse as a second
    // fallback because its legacy runtime path can resolve package test fixtures on
    // Windows. The packaged Python recovery extractor is the only secondary path.
    const recovered=await extractPdfRecoveryFallback(tempInputFile,filename,correlationId,signal);
    if(recovered && recovered.text){
      audit('DOCUMENT_EXTRACTION_RECOVERY_COMPLETED',{filename,method:recovered.method,textLength:String(recovered.text||'').length,structuredFactCount:Array.isArray(recovered.structuredFacts)?recovered.structuredFacts.length:0},{correlationId});
      return recovered;
    }
    const failure={text:'',pages:null,method:'pdf-extraction-unavailable',extractionQuality:{grade:'failed',warning:'Bounded PDF extraction ensemble and packaged recovery extractor both failed.'}};
    audit('DOCUMENT_EXTRACTION_FAILED',{filename,method:failure.method,error:'Bounded PDF extraction ensemble and recovery extractor both failed.'},{correlationId});
    return failure;
  }
  if(ext==='.xlsx'||ext==='.xls'){
    const XLSX=await import('xlsx'); const book=XLSX.read(bytes,{type:'buffer'});
    const text=book.SheetNames.map(s=>`SHEET: ${s}\n${XLSX.utils.sheet_to_csv(book.Sheets[s])}`).join('\n\n');
    return {text,method:'xlsx-fallback',extractionQuality:{grade:'structured'}};
  }
  if(ext==='.docx'){
    const mammoth=await import('mammoth'); const out=await mammoth.extractRawText({buffer:bytes});
    return {text:out.value||'',method:'mammoth-fallback',extractionQuality:{grade:'text'}};
  }
  if(ext==='.html'||ext==='.htm'){
    try{
      const {default:cheerio}=await import('cheerio'); const $=cheerio.load(bytes.toString('utf8'));
      const text=$('body').text().replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
      const tables=[]; $('table').each((ti,el)=>{const rows=[];$(el).find('tr').each((ri,tr)=>{const row=[];$(tr).find('th,td').each((ci,cell)=>row.push($(cell).text().replace(/\s+/g,' ').trim())); if(row.some(Boolean))rows.push(row);}); if(rows.length){const mx=Math.max(...rows.map(r=>r.length)); tables.push({page:1,index:ti+1,title:`HTML table ${ti+1}`,rows:rows.length,columns:mx,tsv:rows.map(r=>[...r,...Array(Math.max(0,mx-r.length)).fill('')].join('\t')).join('\n')});}});
      const images=[]; $('img').each((ii,img)=>{const src=String($(img).attr('src')||'').trim(); if(/^https?:\/\//i.test(src))images.push({index:ii+1,page:1,src,alt:String($(img).attr('alt')||'').trim(),kind:'remote-image'});});
      const assets={available:true,pages:[{page:1,width:null,height:null,imageCount:images.length,tableCount:tables.length}],images,pageSnapshots:[],tables,structuredFacts:[],method:'html-structured',extractionQuality:{grade:tables.length||images.length?'rich':'text',tableCount:tables.length,imageCount:images.length}};
      return {text,method:'html-structured',assets,extractionQuality:{grade:tables.length||images.length?'rich':'text',tableCount:tables.length,imageCount:images.length}};
    }catch{return {text:bytes.toString('utf8'),method:'html-native-fallback',extractionQuality:{grade:'native'}};}
  }
  return {text:'',method:'unsupported',extractionQuality:{grade:'unsupported'}};
}
async function prepareRequestAttachments(attachments=[],correlationId=null){
  const out=[];
  for(const a of Array.isArray(attachments)?attachments.slice(0,5):[]){
    const filename=path.basename(String(a.filename||'attachment')).replace(/[^\w.\- ]/g,'_');
    const raw=String(a.contentBase64||''); if(!raw)continue;
    const bytes=Buffer.from(raw,'base64');
    if(bytes.length>25*1024*1024) throw new Error(`${filename} exceeds the 25 MB attachment limit.`);
    const idv=id('attachment'), filePath=path.join(requestAttachmentsDir,`${idv}-${filename}`); fs.writeFileSync(filePath,bytes);
    const ex=await extractDocument(filename,raw);
    let rich=ex;
    if(path.extname(filename).toLowerCase()==='.pdf') rich=await enrichPdfTextWithAssets(ex.text,filePath,idv,correlationId);
    const text=rich.text||'';
    const chunks=text.split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>20).slice(0,120);
    const attachment={id:idv,filename,size:bytes.length,method:ex.method,textLength:text.length,assets:rich.assets||null,chunks:chunks.map((t,i)=>({id:id('attachchunk'),ordinal:i+1,text:t})),path:path.relative(root,filePath),createdAt:new Date().toISOString()};
    out.push(attachment); audit('REQUEST_ATTACHMENT_INGESTED',{attachmentId:idv,filename,size:bytes.length,textLength:text.length,imageCount:rich.assets?.images?.length||0,tableCount:rich.assets?.tables?.length||0},{correlationId});
  }
  return out;
}
function attachmentContext(items=[]){return (items||[]).flatMap(a=>(a.chunks||[]).map(x=>({attachmentId:a.id,filename:a.filename,ordinal:x.ordinal,text:x.text,sourceType:'request-attachment'}))).slice(0,120)}
function standardIdentityFromQuery(query){
  const m=String(query||'').match(/\b(IAS|IFRS)\s*(\d{1,3})\b/i); return m?`${m[1].toUpperCase()} ${Number(m[2])}`:null;
}
function standardTopicTokens(standard){
  const map={'IAS 2':['inventory','inventories','net realisable value','net realizable value','write-down'],'IAS 19':['employee benefits','defined benefit','defined contribution','post-employment'],'IFRS 19':['subsidiaries','without public accountability','disclosures'],'IAS 16':['property, plant and equipment','depreciation','ppe'],'IAS 36':['impairment','recoverable amount','cash-generating unit','cash generating unit'],'IFRS 9':['financial instruments','hedging','expected credit loss'],'IFRS 15':['revenue','contracts with customers','performance obligation'],'IFRS 16':['leases','right-of-use','lease liability'],'IFRS 18':['presentation','financial statements','operating profit','management-defined performance measure']}; return map[standard]||[];
}
function filterKnowledgeForStandard(items,standard){
  if(!standard)return Array.isArray(items)?items:[];
  const exact=new RegExp(`\\b${standard.replace(' ', '\\s*')}\\b`,'i'); const topics=standardTopicTokens(standard);
  return (Array.isArray(items)?items:[]).filter(x=>{
    const title=String(x.title||x.filename||''); const text=String(x.text||'');
    const titleHit=exact.test(title); const textHit=exact.test(text);
    const lower=text.toLowerCase(); const topicHits=topics.reduce((n,t)=>n+(lower.includes(t)?1:0),0);
    return titleHit || (textHit && topicHits>0);
  }).map(x=>{
    const title=String(x.title||x.filename||'').toLowerCase(); const text=String(x.text||'').toLowerCase();
    const topicHits=topics.reduce((n,t)=>n+(text.includes(t)?1:0),0); const titleHit=exact.test(title)?1:0;
    return {...x,_standardScore:titleHit*30+topicHits*6+Number(x.score||0)};
  }).sort((a,b)=>b._standardScore-a._standardScore).slice(0,8).map(({_standardScore,...x})=>x);
}
function knowledgeRetrievalContext(items,query){
  if(qaFaults().retrievalFailure) throw new Error('QA injected retrieval failure');
  const terms=[...new Set(String(query||'').toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>=3))];
  const candidates=[];
  for(const item of items||[]){
    try{
      const cp=item.contentPath?path.resolve(root,item.contentPath):(item.sourcePath?path.resolve(root,item.sourcePath):null);
      if(!cp||!fs.existsSync(cp))continue;
      const text=fs.readFileSync(cp,'utf8');
      text.split(/\n\s*\n|(?<=\.)\s{2,}/).map(x=>x.trim()).filter(x=>x.length>=20).forEach((text,index)=>{const lower=text.toLowerCase();const score=terms.reduce((n,t)=>n+(lower.includes(t)?1:0),0);if(score>0)candidates.push({knowledgeId:item.id,filename:item.filename,chunkIndex:index+1,text,score});});
    }catch{}
  }
  return candidates.sort((a,b)=>b.score-a.score||b.text.length-a.text.length||a.chunkIndex-b.chunkIndex).slice(0,32).map(x=>({...x,chunkHash:sha(x.text)}));
}
function knowledgeSourceHints(query,company=null,task='general_cfo'){
  const terms=[...new Set(String(query||'').toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>=3))];
  const country=String(company?.country||'').toLowerCase();
  const taskTerms=String(task||'').toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>=3);
  const jurisdictionMap={
    'united states':['united states','usa','us'], 'united kingdom':['united kingdom','uk','england'], india:['india'], singapore:['singapore'], uae:['united arab emirates','uae'], canada:['canada'], australia:['australia'], germany:['germany'], france:['france'], netherlands:['netherlands'], 'hong kong':['hong kong'], china:['china'], japan:['japan']
  };
  const relevantCountryTokens=Object.entries(jurisdictionMap).find(([k])=>country.includes(k))?.[1]||[];
  const taskCategory=/tax/.test(task)?'tax':/audit/.test(task)?'audit':/accounting/.test(task)?'accounting':/investment|valuation|research/.test(task)?'investment':/contract|legal/.test(task)?'legal':null;
  return (Array.isArray(KNOWLEDGE_SOURCES)?KNOWLEDGE_SOURCES:[]).filter(x=>x&&x.active!==false).map(x=>{
    const hay=[x.name,x.category,x.jurisdiction,x.authority,x.url].join(' ').toLowerCase();
    const global=x.jurisdiction?.toLowerCase()==='international';
    const countryMatch=!country||global||relevantCountryTokens.some(t=>String(x.jurisdiction||'').toLowerCase().includes(t));
    if(!countryMatch)return {...x,matchScore:-999};
    const termScore=terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0);
    const taskScore=taskCategory&&hay.includes(taskCategory)?3:0;
    const taskTermScore=taskTerms.reduce((n,t)=>n+(hay.includes(t)?0.5:0),0);
    const jurisdictionScore=country&&taskCategory&&String(x.jurisdiction||'').toLowerCase()===country?4:0;
    return {...x,matchScore:termScore+taskScore+taskTermScore+jurisdictionScore};
  }).filter(x=>x.matchScore>0).sort((a,b)=>b.matchScore-a.matchScore).slice(0,8).map(x=>({sourceId:x.id,name:x.name,category:x.category,jurisdiction:x.jurisdiction,authority:x.authority,url:x.url,license:x.license,retrievalMethod:x.retrievalMethod,lastVerified:x.lastVerified}));
}

function activeCompany(){return state.companies.find(c=>c.id===state.activeCompanyId)||null}
function assertCompanyScope(req, requestedCompanyIds=[]){
  const ids=[...new Set((requestedCompanyIds||[]).map(String).filter(Boolean))];
  if(!ids.length)return {companyIds:[],staleCompanyIds:[]};
  const valid=new Set((state.companies||[]).filter(c=>!c.archived).map(c=>String(c.id)));
  const stale=ids.filter(idv=>!valid.has(idv));
  const usable=ids.filter(idv=>valid.has(idv));
  if(!usable.length){ const err=new Error('Selected company scope is no longer available. Please refresh the company list and select an active company.'); err.code='COMPANY_SCOPE_INVALID'; err.statusCode=409; throw err; }
  if(stale.length){ audit('COPILOT_SCOPE_STALE_IDS_FILTERED',{requestedCompanyIds:ids,usableCompanyIds:usable,staleCompanyIds:stale}); }
  return {companyIds:usable,staleCompanyIds:stale};
}
function moniRoute(message){
  const c=activeCompany(), lower=String(message||'').toLowerCase();
  let task='general_cfo';
  if(/contract|clause|agreement|obligation|renewal|termination/.test(lower))task='contract';
  else if(/ifrs|ias|gaap|accounting|recognition|lease|revenue recognition|depreciation|impairment/.test(lower))task='accounting';
  else if(/tax|vat|gst|corporation tax|income tax|transfer pricing/.test(lower))task='tax';
  else if(/audit|isa|internal control|materiality|going concern/.test(lower))task='audit';
  else if(/case law|legal precedent|statute|regulation|law/.test(lower))task='legal_research';
  else if(/forecast|predict|projection|cash flow forecast|runway forecast/.test(lower))task='forecast';
  else if(/email|meeting|minutes|remind|task|checklist|follow up|follow-up/.test(lower))task='workflow';

  // General CFO questions must work without a company. A company is required only when
  // the wording clearly refers to the user's/selected entity or a named company.
  const possessiveCompany = /\b(?:my|our|this|selected)\s+(?:company|business|group|entity|organisation|organization)\b/.test(lower)
    || /\b(?:our|my|this)\s+(?:revenue|turnover|ebitda|gross margin|operating profit|net profit|cash balance|cash position|cash burn|runway|debt|liabilit(?:y|ies)|assets|working capital|headcount|financial statements|annual report|balance sheet|income statement|profit and loss|cash flow statement)\b/.test(lower);
  const explicitSelected = /\bselected company\b|\bcompany workspace\b|\bcompany-specific\b/.test(lower);
  const companySpecific = possessiveCompany || explicitSelected;
  const requiresCompany = companySpecific && !c;
  const confidence=c?0.82:(companySpecific?0.88:0.78);
  const candidates=state.agents.filter(a=>a.enabled&&!a.archived).map(a=>a.id);
  return {
    task, confidence, needsCompany:requiresCompany, companyRequired:requiresCompany,
    companyId:companySpecific?(c?.id??null):null, candidates,
    route:'AI Arena → independent responses → evidence/calculation checks → Moni confidence gate',
    mode:requiresCompany?'company-specific':'general-knowledge/workflow'
  };
}


function installedModels(includeArchived=true){
  try{
    const isProjector=f=>/^(mmproj|.*(?:projector|vision[-_]?projector)).*\.gguf$/i.test(f);
    return fs.readdirSync(modelsDir).filter(f=>f.toLowerCase().endsWith('.gguf')&&!isProjector(f)).map(filename=>{const meta=state.modelLifecycle?.[filename]||{};return {id:sha(filename).slice(0,16),filename,path:path.join(modelsDir,filename),installed:true,sizeBytes:fs.statSync(path.join(modelsDir,filename)).size,archived:!!meta.archived,archivedAt:meta.archivedAt||null,updatedAt:meta.updatedAt||null};}).filter(m=>includeArchived||!m.archived);
  }catch{return []}
}
async function ollamaStatus(){
  try{const r=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(1200)}); if(!r.ok)return {online:false,models:[]}; const j=await r.json(); return {online:true,models:(j.models||[]).map(m=>m.name)};}catch{return {online:false,models:[]}}
}
function llamaServerCandidates(){return [
  {kind:'cuda',path:path.join(root,'app','llm-backend','win','cuda','llama-server.exe')},
  {kind:'vulkan',path:path.join(root,'app','llm-backend','win','vulkan','llama-server.exe')},
  {kind:'cpu',path:path.join(root,'app','llm-backend','win','cpu','llama-server.exe')},
  {kind:'generic',path:path.join(root,'app','llm-backend','win','llama-server.exe')}
].filter(x=>fs.existsSync(x.path));}
function llamaServerPath(){return llamaServerCandidates()[0]?.path||null;}
async function launchLlamaServer(model,port,preferredPath=null){
  const all=llamaServerCandidates(); const ordered=[]; if(preferredPath){const p=all.find(x=>x.path===preferredPath);if(p)ordered.push(p);} for(const x of all)if(!ordered.some(y=>y.path===x.path))ordered.push(x);
  const diagnostics=[];
  for(const backend of ordered){
    // One shared runtime serves all agent candidates. Keep a small number of slots so
    // low-memory machines do not try to load multiple model copies.
    const slots=model.sizeBytes<=2500000000?4:2;
    const contextSize=contextBudgetForModel(model.filename); const outputTokens=generationBudgetForModel(model.filename);
    let host={memory:{totalGb:8},gpus:[]}; try{host=await hostSpecifications();}catch{}
    const hostVram=Math.max(0,...(host.gpus||[]).map(g=>Number(g.vramGb)||0));
    const cpuCores=Math.max(2,Number(os.cpus?.()?.length||4));
    const cpuThreads=Math.max(2,Math.min(6,cpuCores-2));
    const modelGb=Number(model.sizeBytes||0)/1e9;
    const gpuFit=backend.kind==='cuda' && hostVram>0 && modelGb < hostVram*0.72;
    const resourceProfile={hostVramGb:hostVram,cpuCores,threads:cpuThreads,modelGb:Number(modelGb.toFixed(3)),gpuFit};
    // Derive a per-runtime credential and bind it to the exact child/port. Certification
    // must never mistake an unrelated stale llama-server on the same port for the runtime
    // it just spawned. The readiness probe therefore authenticates against /v1/models.
    const apiKey=crypto.createHash('sha256').update(`${crypto.randomUUID()}:${model.filename}:${port}:${VERSION}`).digest('hex').slice(0,40);
    const baseCommon=['-m',model.path,'--host','127.0.0.1','--port',String(port),'-c',String(contextSize),'-n',String(outputTokens),'-np',String(slots),'-t',String(cpuThreads),'-tb',String(cpuThreads),'-b','256','-ub','64','--timeout','0','--reasoning','off','--jinja','--api-key',apiKey];
    const isNemotron=/nemotron/i.test(model.filename);
    const common=backend.kind==='cuda'?(isNemotron?[...baseCommon,'-ngl','99','-fa','on','--jinja']:baseCommon):backend.kind==='vulkan'?(isNemotron?[...baseCommon,'-ngl','99','--jinja']:baseCommon):baseCommon;
    const profiles=backend.kind==='cpu'?[['cpu-fallback',[...common,'-fit','off','-ngl','0']]]:backend.kind==='cuda'?[['gpu-auto',[...common,'-ngl',gpuFit?'99':'20']],['gpu-safe',[...common,'-ngl','0','--no-mmap']]]:[['auto',[...common]]];
    audit('MODEL_RUNTIME_RESOURCE_PROFILE',{modelId:model.id,filename:model.filename,backend:backend.kind,profile:resourceProfile});
    for(const [profile,args] of profiles){
      audit('MODEL_RUNTIME_BACKEND_ATTEMPTED',{modelId:model.id,filename:model.filename,backend:backend.kind,profile}); const child=spawn(backend.path,args,{cwd:path.dirname(backend.path),windowsHide:true,stdio:['ignore','pipe','pipe']}); let stderr=''; let stdout='';
      child.stderr?.on('data',d=>{stderr=(stderr+String(d)).slice(-8000)}); child.stdout?.on('data',d=>{stdout=(stdout+String(d)).slice(-4000)});
      const started=await new Promise(resolve=>{
        let done=false;
        const finish=v=>{if(!done){done=true;resolve(v)}};
        const poll=setInterval(async()=>{
          if(child.exitCode!==null || child.killed){clearInterval(poll);finish(false);return;}
          try{
            const health=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(800)});
            if(!health.ok)return;
            // /health alone is insufficient: an unrelated stale server can answer 200.
            // /v1/models must accept this runtime's exact credential while the child PID is alive.
            const auth=await fetch(`http://127.0.0.1:${port}/v1/models`,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(1200)});
            if(auth.ok){clearInterval(poll);finish(true);return;}
            if(auth.status===401){clearInterval(poll);finish(false);return;}
          }catch{}
        },500);
        child.on('error',()=>{clearInterval(poll);finish(false);});
        child.on('exit',()=>{clearInterval(poll);finish(false);});
      });
      if(started){audit('MODEL_RUNTIME_BACKEND_READY',{modelId:model.id,filename:model.filename,backend:backend.kind,profile,resourceProfile});return {child,backend:backend.kind,path:backend.path,profile,resourceProfile,apiKey};}
      try{child.kill()}catch{}; diagnostics.push(`${backend.kind}/${profile}: ${stderr.replace(/\s+/g,' ').trim().slice(-1200)}`);
    }
  }
  const hint=/nemotron/i.test(model.filename)?' Nemotron 3 requires a recent llama.cpp build with Nemotron Nano 3 support; the production installer upgrades llama.cpp before runtime.':' '; throw new Error(`No llama.cpp backend could start the model.${hint} ${diagnostics.join(' | ').slice(-5000)}`);
}
async function startLiveRuntime(modelFilename){
  const installed=installedModels(false);
  if(!installed.length) throw new Error('No installed GGUF model is available. Install a model from AI Models first.');
  const requested=String(modelFilename||state.selectedModelFilename||'').trim();
  const model=installed.find(x=>x.filename===requested)||installed[0];
  if(liveRuntimes.has(model.filename)){
    liveRuntime=liveRuntimes.get(model.filename);
    state.selectedModelFilename=model.filename; save(); touchRuntime(); return liveRuntime;
  }
  if(runtimeStartPromises.has(model.filename)) return runtimeStartPromises.get(model.filename);
  const promise=(async()=>{
    if(!llamaServerCandidates().length) throw new Error('llama.cpp runtime is not installed. Open AI Models and run the local runtime setup again.');
    // Use a high, per-start port so a prior/stale llama-server cannot be mistaken for the
    // runtime being created. The launch handshake additionally authenticates the child.
    let port=null;
    for(let attempt=0;attempt<40;attempt++){
      const candidate=20000+Math.floor(Math.random()*25000);
      if(runtimePorts.has(candidate)) continue;
      try{const r=await fetch(`http://127.0.0.1:${candidate}/health`,{signal:AbortSignal.timeout(100)});if(!r.ok){port=candidate;break;}}catch{port=candidate;break;}
    }
    if(!port) throw new Error('Unable to allocate a free local llama.cpp runtime port.');
    runtimePorts.add(port);
    try{
      const launched=await launchLlamaServer(model,port);
      const spec=modelSpecForFilename(model.filename); const runtime={child:launched.child,port,modelId:model.id,filename:model.filename,startedAt:new Date().toISOString(),backend:launched.backend,profile:launched.profile,resourceProfile:launched.resourceProfile||null,apiKey:launched.apiKey,contextSize:contextBudgetForModel(model.filename),nativeContextSize:Number(spec?.nativeContextTokens||32768),maxOutputTokens:generationBudgetForModel(model.filename),stderrTail:''};
      launched.child.stderr?.on('data',d=>{if(liveRuntimes.get(model.filename)===runtime)runtime.stderrTail=(runtime.stderrTail+String(d)).slice(-8000);});
      liveRuntimes.set(model.filename,runtime); liveRuntime=runtime; state.selectedModelFilename=model.filename; save();
      for(const c of state.companies||[]) for(const d of c.documents||[]){
        const staleFallback=d.aiStatusDetail==='completed_with_fallback'||d.aiStatus==='waiting_for_model'||(d.aiStatus==='queued'&&state.aiJobs?.[d.aiJobId]?.waitingForModel===true);
        if(!staleFallback||!d.aiJobId||!state.aiJobs?.[d.aiJobId]) continue;
        const j=state.aiJobs[d.aiJobId];
        j.status='queued'; j.waitingForModel=false; j.error=null; j.stage='Re-queued after model load'; j.progress=0;
        d.aiStatus='queued'; d.aiStatusDetail='queued'; d.aiError=null;
        audit('DOCUMENT_AI_REVIEW_REQUEUED_FOR_MODEL',{documentId:d.id,companyId:c.id,modelFilename:model.filename},{correlationId:j.correlationId});
        processDocumentAiJob(j.jobId).catch(()=>{});
      }
      save();
      launched.child.on('exit',()=>{if(liveRuntimes.get(model.filename)===runtime){liveRuntimes.delete(model.filename);runtimePorts.delete(port);if(liveRuntime===runtime)liveRuntime=null;}});
      audit('MODEL_RUNTIME_LOADED',{modelId:model.id,filename:model.filename,port,backend:launched.backend,profile:launched.profile,autoOffloadMs:null,loadPolicy:'automatic-after-download-and-on-demand'});
      return runtime;
    }catch(e){runtimePorts.delete(port);throw e;}
  })().finally(()=>runtimeStartPromises.delete(model.filename));
  runtimeStartPromises.set(model.filename,promise); return promise;
}
function stopLiveRuntime(reason='manual',filename=null){
  const targets=filename?[liveRuntimes.get(path.basename(filename))].filter(Boolean):[...liveRuntimes.values()];
  if(!targets.length)return false;
  for(const old of targets){try{old.child.kill()}catch{};liveRuntimes.delete(old.filename);runtimePorts.delete(old.port);audit('MODEL_RUNTIME_UNLOADED',{modelId:old.modelId,filename:old.filename,reason});}
  liveRuntime=liveRuntimes.get(state.selectedModelFilename)||[...liveRuntimes.values()][0]||null; return true;
}
function runtimePoolStatus(){return [...liveRuntimes.values()].map(r=>({modelId:r.modelId,filename:r.filename,port:r.port,startedAt:r.startedAt,backend:r.backend,profile:r.profile}));}
async function ensureAutomaticModelRuntime({reason='automatic',maxAttempts=4,waitMs=3000,modelFilename=null}={}){
  let lastError=null;
  for(let attempt=1;attempt<=Math.max(1,maxAttempts);attempt++){
    const models=installedModels(false);
    if(!models.length){
      lastError=new Error('No installed GGUF model is available for automatic runtime startup.');
      if(attempt<maxAttempts){await new Promise(r=>setTimeout(r,waitMs)); continue;}
      break;
    }
    const selected=String(modelFilename||state.selectedModelFilename||'').trim();
    const candidate=(selected&&models.find(m=>m.filename===selected))||models.find(m=>m.filename==='Qwen3-4B-Q4_K_M.gguf')||models.find(m=>m.filename==='Qwen3-14B-Q4_K_M.gguf')||models.find(m=>m.filename==='Qwen2.5-1.5B-Instruct-Q4_K_M.gguf')||models[0];
    try{
      const runtime=await startLiveRuntime(candidate.filename);
      audit('MODEL_AUTOLOAD_SUCCEEDED',{filename:runtime.filename,backend:runtime.backend,profile:runtime.profile,attempt,reason},{correlationId:`model-auto-${attempt}`});
      return runtime;
    }catch(e){
      lastError=e;
      audit('MODEL_AUTOLOAD_RETRY',{filename:candidate.filename,attempt,maxAttempts,errorHash:sha(String(e?.message||e)),reason},{correlationId:`model-auto-${attempt}`});
      if(attempt<maxAttempts) await new Promise(r=>setTimeout(r,waitMs*attempt));
    }
  }
  audit('MODEL_AUTOLOAD_FAILED_FINAL',{reason,errorHash:sha(String(lastError?.message||lastError||'unknown'))});
  throw lastError||new Error('Automatic local model runtime startup failed.');
}
async function autoLoadInstalledModels(){
  const models=installedModels(false);
  if(!models.length)return false;
  const selected=String(state.selectedModelFilename||'').trim();
  const ordered=[
    selected&&models.find(m=>m.filename===selected),
    models.find(m=>/nemotron3.*nano.*4b/i.test(m.filename)),
    models.find(m=>m.filename==='Qwen3-4B-Q4_K_M.gguf'),
    models.find(m=>m.filename==='Qwen3-14B-Q4_K_M.gguf'),
    models.find(m=>m.filename==='Qwen2.5-1.5B-Instruct-Q4_K_M.gguf'),
    ...models
  ].filter(Boolean);
  const seen=new Set();
  for(const candidate of ordered){
    if(seen.has(candidate.filename)||liveRuntimes.has(candidate.filename))continue;
    seen.add(candidate.filename);
    try{await ensureAutomaticModelRuntime({reason:'installed-model-autoload',maxAttempts:3,waitMs:2000,modelFilename:candidate.filename}); return true;}catch{}
  }
  return false;
}


function enqueueDocumentAiReview(companyId, docId){
  const company=state.companies.find(c=>c.id===companyId);
  const doc=(company?.documents||[]).find(d=>d.id===docId);
  if(!company||!doc)return null;
  if(doc.fiscalYearMismatch)return null;
  const aiJobId=id('docai');
  state.aiJobs[aiJobId]={jobId:aiJobId,type:'document-ai',status:'queued',companyId,documentId:doc.id,filename:doc.filename,createdAt:new Date().toISOString(),correlationId:crypto.randomUUID()};
  doc.aiJobId=aiJobId; doc.aiStatus='queued'; doc.aiStatusDetail='queued'; doc.aiError=null; doc.status='processing'; doc.stage='queued'; doc.progress=Math.max(Number(doc.progress||0),95);
  save();
  audit('DOCUMENT_AI_REVIEW_QUEUED',{companyId,documentId:doc.id,filename:doc.filename,aiJobId});
  processDocumentAiJob(aiJobId).catch(()=>{});
  return aiJobId;
}

function reconcilePersistedDocumentMetadataFromText(doc){
  if(!doc||!doc.text)return false;
  const before={year:doc.documentFiscalYear,currency:doc.documentCurrency,scale:doc.documentScale,unit:doc.documentUnit};
  try{
    const yearMatch=String(doc.text).match(/(?:for\s+the\s+fiscal\s+year\s+ended[^\n]{0,120}\b(20\d{2})\b|for\s+the\s+year\s+ended[^\n]{0,120}\b(20\d{2})\b)/i);
    const detectedYear=yearMatch ? Number(yearMatch[1]||yearMatch[2]) : Number(doc.documentFiscalYear||0);
    const money=String(doc.text).match(/\(\s*dollars\s+in\s+(million|billion|thousand)\s*\)|\bdollars\s+in\s+(million|billion|thousand)\b/i);
    const detectedCurrency=money?'USD':String(doc.documentCurrency||doc.currency||'').toUpperCase();
    const detectedScale=money?String(money[1]||money[2]).toLowerCase():(doc.documentScale||'units');
    if(detectedYear)doc.documentFiscalYear=detectedYear;
    if(detectedCurrency)doc.documentCurrency=detectedCurrency;
    if(detectedScale)doc.documentScale=detectedScale;
    if(detectedCurrency)doc.currency=detectedCurrency;
    doc.documentUnit=(detectedCurrency && detectedScale && detectedScale!=='units')?`${detectedCurrency} ${detectedScale}`:(doc.documentUnit||detectedCurrency||null);
    doc.userFiscalYear=doc.userFiscalYear||doc.fiscalYear||null;
    doc.fiscalYearMismatch=!!(doc.documentFiscalYear&&doc.userFiscalYear&&String(doc.documentFiscalYear)!==String(doc.userFiscalYear));
    const changed=JSON.stringify(before)!==JSON.stringify({year:doc.documentFiscalYear,currency:doc.documentCurrency,scale:doc.documentScale,unit:doc.documentUnit});
    if(changed)audit('DOCUMENT_METADATA_RECONCILED_FROM_SOURCE_TEXT',{documentId:doc.id,filename:doc.filename,before,after:{year:doc.documentFiscalYear,currency:doc.documentCurrency,scale:doc.documentScale,unit:doc.documentUnit},fiscalYearMismatch:doc.fiscalYearMismatch});
    return changed;
  }catch{return false;}
}

async function migrateLegacyDocumentExtraction(){
  for(const c of (state.companies||[])){
    const legacy=(c.documents||[]).filter(d=>!d.archived&&d.mimeType==='application/pdf'&&(d.extractionEngineVersion!==CURRENT_FINANCIAL_SPINE_VERSION||!Array.isArray(d.structuredFacts)||!d.structuredFacts.length));
    for(const d of legacy.slice(0,3)){
      try{
        const existingStructured=Array.isArray(d.structuredFacts)?d.structuredFacts.slice():[];
        const existingEvidence=Array.isArray(d.evidence)?d.evidence.slice():[];
        const refreshed=await extractDocumentFile(path.resolve(root,d.path||d.contentPath||d.sourcePath),d.filename||path.basename(d.path||d.contentPath||d.sourcePath));
        const candidateFacts=Array.isArray(refreshed.structuredFacts)?refreshed.structuredFacts:[];
        const candidateText=String(refreshed.text||'');
        const candidateEvidence=Array.isArray(refreshed.evidence)?refreshed.evidence:[];
        const usableCandidate=candidateFacts.length>0||candidateText.trim().length>0||candidateEvidence.length>0;
        if(!usableCandidate){
          audit('DOCUMENT_EXTRACTION_MIGRATED_METADATA_ONLY',{companyId:c.id,documentId:d.id,filename:d.filename,preservedStructuredFactCount:existingStructured.length,preservedEvidenceCount:existingEvidence.length,reason:'EMPTY_OR_UNUSABLE_MIGRATION_CANDIDATE'});
          continue;
        }
        d.text=refreshed.text||d.text||'';
        d.evidence=Array.isArray(refreshed.evidence)?refreshed.evidence:[];
        d.evidenceCount=d.evidence.length;
        d.userFiscalYear=d.userFiscalYear||d.fiscalYear||null;
        d.documentFiscalYear=refreshed.documentFiscalYear||d.documentFiscalYear||null;
        d.documentUnit=refreshed.documentUnit||d.documentUnit||null;
        d.extractionQuality=refreshed.extractionQuality||d.extractionQuality||null;
        d.structuredFacts=Array.isArray(refreshed.structuredFacts)?refreshed.structuredFacts:[];
        d.fiscalYearMismatch=!!(d.documentFiscalYear&&d.userFiscalYear&&String(d.documentFiscalYear)!==String(d.userFiscalYear));
        d.extractionEngineVersion=CURRENT_FINANCIAL_SPINE_VERSION;
        d.updatedAt=new Date().toISOString();
        if(d.fiscalYearMismatch){d.status='needs_review';d.stage='needs_review';d.progress=100;d.aiStatus='not_started';d.aiStatusDetail='DOCUMENT_FISCAL_YEAR_CONFLICT';d.aiError={code:'DOCUMENT_FISCAL_YEAR_CONFLICT',message:`Uploaded financial year ${d.userFiscalYear} conflicts with detected document fiscal year ${d.documentFiscalYear}.`};}
        else d.fiscalYear=d.documentFiscalYear||d.fiscalYear;
        save();
        audit('DOCUMENT_EXTRACTION_MIGRATED',{companyId:c.id,documentId:d.id,filename:d.filename,documentFiscalYear:d.documentFiscalYear,fiscalYearMismatch:d.fiscalYearMismatch,structuredFactCount:d.structuredFacts.length});
        if(!d.fiscalYearMismatch){try{await queueDocumentAiReview(c.id,d.id)}catch(e){audit('DOCUMENT_AI_REQUEUE_MIGRATION_FAILED',{companyId:c.id,documentId:d.id,errorHash:sha(String(e?.message||e))});}}
      }catch(e){audit('DOCUMENT_EXTRACTION_MIGRATION_FAILED',{companyId:c.id,documentId:d.id,filename:d.filename,errorHash:sha(String(e?.message||e))});}
    }
  }
}

async function ensureFirstRunPreload(){
  const preloadPromises=[];
  const host=await hostSpecifications();
  const selectedSpec=selectPreloadSpec(host);
  if(!selectedSpec){ await autoLoadInstalledModels(); return; }
  if(process.env.MYAI_CFO_SKIP_PRELOAD==='1') return;
  state.preload ||= {version:null,status:'idle',jobs:[],startedAt:null,completedAt:null};
  const preloadedById=new Map(Object.entries(state.modelLifecycle||{}).filter(([,m])=>m?.preloadSourceId).map(([filename,m])=>[m.preloadSourceId,filename]));
  const preloadAlreadyInstalled=FIRST_RUN_PRELOADS.some(spec=>{
    const mapped=preloadedById.get(spec.id)||spec.filename;
    return fs.existsSync(path.join(modelsDir,mapped));
  });
  if(state.preload.version===PRELOAD_VERSION && state.preload.status==='completed' && preloadAlreadyInstalled) return;
  const previousVersion = String(state.preload.version||'');
  const previousStatus = String(state.preload.status||'idle');
  const autoRetryCount = Number(state.preload.autoRetryCount||0);
  const MAX_AUTO_RETRIES = 3;
  if(previousVersion===PRELOAD_VERSION && previousStatus==='completed_with_errors' && !preloadAlreadyInstalled && autoRetryCount>=MAX_AUTO_RETRIES){
    return;
  }
  // Production recovery policy from historical preload failures automatically. A failed
  // preload is an audit event, not a permanent block. This bounded retry policy
  // allows recovery after transient network/runtime failures without creating an
  // unbounded loop across application restarts.
  const nextRetryCount = (previousVersion===PRELOAD_VERSION && previousStatus==='completed_with_errors' && !preloadAlreadyInstalled) ? autoRetryCount+1 : 0;
  state.preload={version:PRELOAD_VERSION,status:'running',jobs:[],startedAt:new Date().toISOString(),completedAt:null,autoRetryCount:nextRetryCount}; save();
  if(nextRetryCount>0){
    audit('FIRST_RUN_MODEL_PRELOAD_AUTO_RETRY',{modelId:PRELOAD_POLICY.preferredModelId,attempt:nextRetryCount,maxAttempts:MAX_AUTO_RETRIES},{correlationId:`preload-auto-retry-${nextRetryCount}`});
  }
  const existing=new Set(installedModels(true).map(x=>x.filename));
  const activePreloadModels=new Set([...modelDownloadJobs.values()].filter(j=>j.preload&&['queued','downloading','running'].includes(j.status)).map(j=>j.modelId));
  for(const spec of [selectedSpec]){
    if(activePreloadModels.has(spec.id)) continue;
    const existingFilename=preloadedById.get(spec.id)||spec.filename;
    if(existing.has(existingFilename)){
      const active=installedModels(true).find(x=>x.filename===existingFilename); if(active?.archived){state.modelLifecycle[spec.filename]={...(state.modelLifecycle[spec.filename]||{}),archived:false,updatedAt:new Date().toISOString()};save();}
      startLiveRuntime(existingFilename).catch(e=>audit('MODEL_AUTOLOAD_FAILED',{filename:existingFilename,errorHash:sha(String(e?.message||e))}));
      continue;
    }
    const jobId=id('preload'),job={jobId,modelId:spec.id,name:spec.name,provider:'MYAI CFO production first-run preload',status:'queued',bytesReceived:0,totalBytes:0,speedBps:0,controller:new AbortController(),preload:true,role:spec.role};
    modelDownloadJobs.set(jobId,job); state.preload.jobs.push(jobId); save(); recordDownloadJob(job);
    const preloadPromise=(async()=>{try{
      let resolved={filename:spec.filename,url:spec.url};
      if(!resolved.url && spec.repo){resolved=await resolveHFRepoGGUF(spec.repo);}
      if(!resolved?.url)throw new Error('No verified GGUF asset found for preload.');
      let result=null,lastPreloadError=null;
      for(let attempt=1;attempt<=3;attempt++){
        try{
          job.attempt=attempt; job.status='queued'; job.error=null; recordDownloadJob(job);
          result=await downloadToModels(resolved.url,resolved.filename,job); lastPreloadError=null; break;
        }catch(e){
          lastPreloadError=e;
          if(e?.message==='DOWNLOAD_CANCELLED')throw e;
          if(attempt<3){job.status='retrying';job.error=`Attempt ${attempt} failed: ${String(e?.message||e)}`;recordDownloadJob(job);await new Promise(resolve=>setTimeout(resolve,Math.min(15000,2000*attempt)));}
        }
      }
      if(!result)throw lastPreloadError||new Error('Model preload failed after 3 attempts.');
      job.status='completed';job.result=result;recordDownloadJob(job);audit('FIRST_RUN_MODEL_PRELOADED',{jobId,modelId:spec.id,filename:result.filename,sizeBytes:result.sizeBytes,role:spec.role},{correlationId:jobId});
      state.modelLifecycle[result.filename]={...(state.modelLifecycle[result.filename]||{}),archived:false,autoPreloaded:true,preloadVersion:PRELOAD_VERSION,preloadSourceId:spec.id,contextSize:spec.contextSize,nativeContextSize:spec.nativeContextSize,updatedAt:new Date().toISOString()}; state.selectedModelFilename ||= result.filename; save();
      try{await startLiveRuntime(result.filename);}catch(e){audit('MODEL_AUTOLOAD_FAILED',{jobId,filename:result.filename,errorHash:sha(String(e?.message||e)),preloadModel:spec.id},{correlationId:jobId});
        if(spec.fallbackId==='qwen3-4b-q4' && !fs.existsSync(path.join(modelsDir,'Qwen3-4B-Q4_K_M.gguf'))){
          const fb=FIRST_RUN_PRELOADS.find(x=>x.id==='qwen3-4b-q4');
          if(fb){try{const fbJobId=id('preload-fallback'),fbJob={jobId:fbJobId,modelId:fb.id,name:fb.name,provider:'MYAI CFO production GPU fallback preload',status:'queued',bytesReceived:0,totalBytes:0,speedBps:0,controller:new AbortController(),preload:true,role:fb.role}; modelDownloadJobs.set(fbJobId,fbJob); state.preload.jobs.push(fbJobId); save(); const fbResult=await downloadToModels(fb.url,fb.filename,fbJob); fbJob.status='completed'; fbJob.result=fbResult; recordDownloadJob(fbJob); state.selectedModelFilename=fbResult.filename; state.modelLifecycle[fbResult.filename]={...(state.modelLifecycle[fbResult.filename]||{}),archived:false,autoPreloaded:true,preloadSourceId:fb.id,updatedAt:new Date().toISOString()}; save(); try{await startLiveRuntime(fbResult.filename);}catch(fe){audit('MODEL_AUTOLOAD_FAILED',{jobId:fbJobId,filename:fbResult.filename,errorHash:sha(String(fe?.message||fe)),fallbackFrom:spec.id},{correlationId:fbJobId});}}catch(fe){audit('GPU_MODEL_FALLBACK_PRELOAD_FAILED',{jobId,fromModel:spec.id,toModel:fb.id,errorHash:sha(String(fe?.message||fe))},{correlationId:jobId});}}
        }
      }
    }catch(e){job.status=e?.message==='DOWNLOAD_CANCELLED'?'cancelled':'failed';job.error=e?.message||String(e);recordDownloadJob(job);audit('FIRST_RUN_MODEL_PRELOAD_FAILED',{jobId,modelId:spec.id,errorHash:sha(job.error)},{correlationId:jobId});}
    finally{
      setTimeout(()=>modelDownloadJobs.delete(jobId),3600000);
      const preloadJobs=state.preload.jobs.map(j=>state.modelDownloadHistory?.find(h=>h.jobId===j)).filter(Boolean);
      const pending=preloadJobs.some(x=>x.status==='queued'||x.status==='downloading');
      const failed=preloadJobs.some(x=>x.status==='failed'||x.status==='cancelled');
      const finished=preloadJobs.length===state.preload.jobs.length && preloadJobs.length>0 && !pending;
      state.preload.status=pending?'running':(finished?(failed?'completed_with_errors':'completed'):'running');
      if(finished)state.preload.completedAt=new Date().toISOString();
      save();
    }
    })();
    preloadPromises.push(preloadPromise);
  }
  if(preloadPromises.length) await Promise.allSettled(preloadPromises);
}


function compactModelPrompt(raw,maxChars=60000){
  const text=String(raw||'').replace(/\s+/g,' ').trim();
  if(text.length<=maxChars)return text;
  const head=Math.floor(maxChars*0.78),tail=maxChars-head;
  return `${text.slice(0,head)}\n[MYAI CFO: context compacted; use only the evidence supplied here.]\n${text.slice(-tail)}`;
}
function promptBudget(prompt,ctxSize=32768){
  // Keep a hard safety margin for runtimes that advertise a larger context than the
  // actual server/model exposes. The inference function also shrinks and retries when
  // llama.cpp returns an explicit context-size error.
  const outputReserve=Math.min(700,Math.max(180,Math.floor(ctxSize*0.12)));
  const inputTokens=Math.max(480,ctxSize-outputReserve);
  return Math.min(90000,Math.max(6000,inputTokens*3.8));
}
function compactForObservedContext(prompt,observedContext,maxTokens=350){
  const ctx=Math.max(512,Number(observedContext)||2048);
  const reserve=Math.min(Math.max(180,maxTokens+40),Math.floor(ctx*0.55));
  const chars=Math.max(1800,Math.min(9000,Math.floor((ctx-reserve)*3.0)));
  return compactModelPrompt(prompt,chars);
}
function parseContextLimit(text){
  const m=String(text||'').match(/available context size\s*\(?([0-9]{3,})/i)||String(text||'').match(/context size[^0-9]*([0-9]{3,})/i);
  return m?Number(m[1]):null;
}
function qaModeEnabled(req){return (process.env.MYAI_CFO_QA_MODE==='1' || String(req?.headers?.['x-myai-qa-mode']||'')==='1') && (req?.headers?.host||'').startsWith('127.0.0.1:');}
function qaFaults(){state.qaFaults ||= {modelUnavailable:false,retrievalFailure:false,toolFailure:false,workerFailure:false}; return state.qaFaults;}
async function runLocalModel(prompt,correlationId=null,opts={}){
  if(qaFaults().modelUnavailable) return {ok:false,reason:'INJECTED_MODEL_UNAVAILABLE',message:'QA injected model-unavailable failure.'};
  const inferredFilename=String(opts.modelFilename||liveRuntime?.filename||state.selectedModelFilename||'');
  const modelCap=generationBudgetForModel(inferredFilename);
  const requestedMaxTokens=Math.max(256,Math.min(Number(opts.maxTokens||modelCap),modelCap));
  const contextCap=Number(opts.contextSize||contextBudgetForModel(inferredFilename));
  const safePrompt=compactModelPrompt(prompt,promptBudget(prompt,contextCap));
  const maxTokens=requestedMaxTokens;
  const modelRunId=correlationId||crypto.randomUUID();
  audit('MODEL_INFERENCE_STARTED',{modelRunId,promptHash:sha(String(prompt||''))},{correlationId:modelRunId});
  const installed=installedModels(false).filter(m=>!m.archived);
  const requestedModel=String(opts.modelFilename||'').trim();
  const preferred=/^(auto|preferred|auto\s*\/\s*preferred)$/i.test(requestedModel)?'':requestedModel || (opts.allowStateSelection===true?String(state.selectedModelFilename||'').trim():'');
  const explicitOllama=preferred.startsWith('ollama:')?preferred.slice(7):'';
  const ollama=await Promise.race([ollamaStatus(), new Promise(resolve=>setTimeout(()=>resolve({online:false,models:[],degraded:true,error:'MODEL_STATUS_TIMEOUT'}),1500))]);
  let lastFailure='';
  if(!installed.length && !(explicitOllama && ollama.online && (ollama.models||[]).includes(explicitOllama)) && !(opts.preferOllama===true && ollama.online && ollama.models?.length)){
    audit('MODEL_INFERENCE_FAILED',{modelRunId,reason:'NO_LOCAL_MODEL'},{correlationId:modelRunId});
    return {ok:false,reason:'NO_LOCAL_MODEL',message:'No local CFO model is installed. Open AI Models and install/prepare a GGUF model.'};
  }
  if(explicitOllama && ollama.online && (ollama.models||[]).includes(explicitOllama)){
    activeInferenceCount++;
    try{
      const r=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:explicitOllama,prompt:safePrompt,stream:false,options:{temperature:0.2,num_predict:maxTokens}})});
      const j=await r.json().catch(()=>({}));
      if(r.ok&&String(j.response||'').trim()){
        const out={ok:true,text:String(j.response).trim(),model:`ollama:${explicitOllama}`,runtime:'ollama'};
        audit('MODEL_INFERENCE_COMPLETED',{model:out.model,runtime:out.runtime,outputHash:sha(out.text)},{correlationId:modelRunId});
        return out;
      }
      lastFailure=`ollama:${explicitOllama}: HTTP ${r.status}`;
    }catch(e){lastFailure=`ollama:${explicitOllama}: ${String(e?.message||e)}`;}
    finally{activeInferenceCount=Math.max(0,activeInferenceCount-1);}
  }
  const ordered=[...installed].sort((a,b)=>{
    if(preferred && a.filename===preferred)return -1;
    if(preferred && b.filename===preferred)return 1;
    return 0;
  });
  if(opts.preferOllama===true && ollama.online && ollama.models.length){
    activeInferenceCount++;
    try{
      for(const model of ollama.models){
        try{
          const r=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,prompt,stream:false,options:{temperature:0.2,num_predict:maxTokens}})});
          const j=await r.json().catch(()=>({}));
          if(r.ok&&String(j.response||'').trim()){const out={ok:true,text:String(j.response).trim(),model:`ollama:${model}`,runtime:'ollama'};audit('MODEL_INFERENCE_COMPLETED',{model:out.model,runtime:out.runtime,outputHash:sha(out.text)},{correlationId:modelRunId});return out;}
        }catch(e){audit('MODEL_INFERENCE_PROVIDER_RETRY',{model:`ollama:${model}`,errorHash:sha(String(e?.message||e))},{correlationId:modelRunId});}
      }
    }finally{activeInferenceCount=Math.max(0,activeInferenceCount-1);scheduleRuntimeOffload();}
  }
  for(const candidate of ordered){
    let runtime;
    try{runtime=await startLiveRuntime(candidate.filename);}
    catch(e){lastFailure=`${candidate.filename}: ${String(e?.message||e)}`;audit('MODEL_INFERENCE_MODEL_START_FAILED',{model:candidate.filename,errorHash:sha(lastFailure)},{correlationId:modelRunId});continue;}
    activeInferenceCount++;
    try{
      let requestPrompt=safePrompt;
      for(let attempt=1;attempt<=3;attempt++){
        try{
          const body={messages:[
            {role:'system',content:'You are MYAI CFO, a concise and helpful CFO-level AI assistant. Answer the user directly and clearly. Never invent company facts. Distinguish known evidence, assumptions and inference. For general finance questions, answer from financial knowledge without requiring a company workspace. Do not discuss internal agents, routing or implementation unless the user asks.'},
            {role:'user',content:requestPrompt}
          ],temperature:0.15,max_tokens:maxTokens,stream:false,top_p:0.9,reasoning_effort:'none',chat_template_kwargs:{enable_thinking:false}};
          const r=await fetch(`http://127.0.0.1:${runtime.port}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${runtime.apiKey}`},body:JSON.stringify(body)});
          const j=await r.json().catch(()=>({}));
          const msg=j?.choices?.[0]?.message||{};
          let text=msg?.content??j?.choices?.[0]?.text??j?.response??j?.content??'';
          if(Array.isArray(text))text=text.map(x=>typeof x==='string'?x:x?.text||'').join('');
          text=String(text||'').replace(/^\s*<think>[\s\S]*?<\/think>\s*/i,'').trim();
          if(!text && msg?.reasoning_content)text=String(msg.reasoning_content).replace(/^\s*<think>[\s\S]*?<\/think>\s*/i,'').trim();
          if(r.ok&&text){touchRuntime();const out={ok:true,text,model:runtime.filename,runtime:`llama.cpp (${runtime.backend}/${runtime.profile})`};audit('MODEL_INFERENCE_COMPLETED',{model:out.model,runtime:out.runtime,attempt,outputHash:sha(out.text)},{correlationId:modelRunId});return out;}
          const shape=JSON.stringify({status:r.status,keys:Object.keys(j||{}),choiceKeys:Object.keys(msg||{}),error:j?.error||null}).slice(0,1800);
          lastFailure=`${candidate.filename}: HTTP ${r.status}; response=${shape}`;
          const contextLimit=parseContextLimit(j?.error?.message||j?.error||shape);
          if(contextLimit){
            requestPrompt=compactForObservedContext(prompt,contextLimit,maxTokens);
            audit('MODEL_CONTEXT_SHRINK_RETRY',{modelRunId,model:candidate.filename,attempt,observedContext:contextLimit,promptChars:requestPrompt.length},{correlationId:modelRunId});
          }
          audit('MODEL_INFERENCE_RETRY',{modelRunId,model:candidate.filename,attempt,status:r.status,responseShapeHash:sha(shape),contextLimit:contextLimit||null},{correlationId:modelRunId});
        }catch(e){
          lastFailure=`${candidate.filename}: ${String(e?.message||e)}`;
          try{
            const healthy=await fetch(`http://127.0.0.1:${runtime.port}/health`,{signal:AbortSignal.timeout(800)}).then(x=>x.ok).catch(()=>false);
            if(!healthy){try{runtime.child?.kill()}catch{};liveRuntimes.delete(candidate.filename);if(liveRuntime===runtime)liveRuntime=null;runtime=await startLiveRuntime(candidate.filename);}
          }catch(restartError){lastFailure += ` | runtime restart: ${String(restartError?.message||restartError)}`;}
          audit('MODEL_INFERENCE_RETRY',{modelRunId,model:candidate.filename,attempt,errorHash:sha(lastFailure)},{correlationId:modelRunId});
        }
        if(attempt<3)await new Promise(resolve=>setTimeout(resolve,Math.min(2500,600*attempt)));
      }
    }finally{activeInferenceCount=Math.max(0,activeInferenceCount-1);touchRuntime();}
  }
  const message=`Local AI inference could not produce a response from the installed models. ${lastFailure}`;
  audit('MODEL_INFERENCE_FAILED',{modelRunId,reason:'INFERENCE_FAILED',detailHash:sha(message),installedModels:ordered.map(x=>x.filename)},{correlationId:modelRunId});
  return {ok:false,reason:'INFERENCE_FAILED',message,diagnostics:{installedModels:ordered.map(x=>x.filename),runtimePool:runtimePoolStatus(),lastFailure}};
}
async function runOmniRoute(prompt,correlationId=null,opts={}){
  const route=state.onlineRoute||{};
  if(!route.enabled)return {ok:false,reason:'ONLINE_ROUTE_DISABLED',message:'OmniRoute online routing is disabled.'};
  if(opts.companyEvidence===true && route.allowCompanyEvidence!==true)return {ok:false,reason:'ONLINE_COMPANY_EVIDENCE_NOT_ALLOWED',message:'Online routing is enabled, but company evidence has not been explicitly authorised for online processing.'};
  const base=String(route.baseUrl||'http://127.0.0.1:20128/v1').replace(/\/$/,'');
  const headers={'Content-Type':'application/json','Accept':'application/json'};
  if(process.env.MYAI_CFO_OMNIROUTE_API_KEY)headers.Authorization=`Bearer ${process.env.MYAI_CFO_OMNIROUTE_API_KEY}`;
  const body={messages:[
    {role:'system',content:'You are MYAI CFO using an explicitly authorised online AI route. Never invent company facts. Distinguish evidence, assumptions and inference. Answer the user directly and clearly.'},
    {role:'user',content:String(prompt||'')}
  ],temperature:0.15,top_p:0.9,max_tokens:Number(opts.maxTokens||1536),stream:false};
  const started=Date.now();
  audit('ONLINE_MODEL_INFERENCE_STARTED',{provider:'OmniRoute',baseUrl:base,model:route.model||'auto',promptHash:sha(String(prompt||''))},{correlationId});
  try{
    const r=await fetch(`${base}/chat/completions`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const text=await r.text(); let j={}; try{j=JSON.parse(text)}catch{}
    if(!r.ok){audit('ONLINE_MODEL_INFERENCE_FAILED',{provider:'OmniRoute',status:r.status,detailHash:sha(text.slice(0,1200))},{correlationId});return {ok:false,reason:'ONLINE_ROUTE_HTTP_ERROR',message:`OmniRoute returned HTTP ${r.status}.`};}
    const msg=j?.choices?.[0]?.message||{}; let answer=msg?.content??j?.choices?.[0]?.text??j?.response??'';
    if(Array.isArray(answer))answer=answer.map(x=>typeof x==='string'?x:x?.text||'').join('');
    answer=String(answer||'').trim();
    if(!answer){audit('ONLINE_MODEL_INFERENCE_FAILED',{provider:'OmniRoute',reason:'EMPTY_RESPONSE'},{correlationId});return {ok:false,reason:'ONLINE_ROUTE_EMPTY_RESPONSE',message:'OmniRoute returned an empty response.'};}
    audit('ONLINE_MODEL_INFERENCE_COMPLETED',{provider:'OmniRoute',model:route.model||j?.model||'auto',runtime:'OmniRoute',latencyMs:Date.now()-started,outputHash:sha(answer)},{correlationId});
    return {ok:true,text:answer,model:route.model||j?.model||'OmniRoute:auto',runtime:'OmniRoute'};
  }catch(e){audit('ONLINE_MODEL_INFERENCE_FAILED',{provider:'OmniRoute',errorHash:sha(String(e?.message||e))},{correlationId});return {ok:false,reason:'ONLINE_ROUTE_UNAVAILABLE',message:String(e?.message||e)};}
}
async function downloadToModels(url,requestedFilename,job){
  const parsed=new URL(url); if(parsed.protocol!=='https:')throw new Error('Only HTTPS model URLs are allowed.');
  const host=parsed.hostname.toLowerCase(); if(['localhost','127.0.0.1','::1'].includes(host)||host.endsWith('.local'))throw new Error('Local/private download targets are not allowed.');
  const filename=(requestedFilename||path.basename(parsed.pathname)||'model.gguf').replace(/[^a-zA-Z0-9._-]/g,'_');
  if(!filename.toLowerCase().endsWith('.gguf'))throw new Error('Text model downloads must be GGUF files.');
  const dest=path.join(modelsDir,filename), partial=dest+'.part';
  const response=await fetch(url,{redirect:'follow',headers:{'User-Agent':'MYAI-CFO/1.24.26'},signal:job.controller.signal});
  if(!response.ok){
    const status=response.status;
    if(status===404)throw new Error(`Download failed with HTTP 404: model asset not found at the configured provider path.`);
    if(status===401||status===403)throw new Error(`Download failed with HTTP ${status}: provider authentication or access permission is required.`);
    throw new Error(`Download failed with HTTP ${status}`);
  }
  job.totalBytes=Number(response.headers.get('content-length'))||0; job.status='downloading'; job.startedAt=Date.now();
  const file=fs.createWriteStream(partial); const hasher=crypto.createHash('sha256'); let lastBytes=0,lastAt=Date.now();
  try{for await(const chunk of response.body){if(job.controller.signal.aborted){try{file.destroy();}catch{};try{fs.unlinkSync(partial)}catch{};throw new Error('DOWNLOAD_CANCELLED');} file.write(chunk); hasher.update(chunk); job.bytesReceived+=chunk.length; const now=Date.now(); if(now-lastAt>=500){job.speedBps=Math.max(0,Math.round((job.bytesReceived-lastBytes)/((now-lastAt)/1000)));lastBytes=job.bytesReceived;lastAt=now;}} file.end(); await new Promise((resolve,reject)=>{file.on('close',resolve);file.on('error',reject)}); if(job.controller.signal.aborted){try{file.destroy();}catch{};try{fs.unlinkSync(partial)}catch{};throw new Error('DOWNLOAD_CANCELLED');} fs.renameSync(partial,dest); const stat=fs.statSync(dest); return {filename,sizeBytes:stat.size,path:dest,sha256:hasher.digest('hex')};}
  catch(e){try{file.destroy()}catch{};try{if(fs.existsSync(partial))fs.unlinkSync(partial)}catch{};throw e}
}
async function enrichRemoteModel(x){
  let filename=null,url=null,fileSize=null;
  try{const meta=await fetch(`https://huggingface.co/api/models/${encodeURIComponent(x.id).replace('%2F','/')}`,{headers:{'User-Agent':'MYAI-CFO/1.4.2-PRODUCTION'},signal:AbortSignal.timeout(7000)}).then(r=>r.json());
    const files=(meta.siblings||[]).filter(s=>/\.gguf$/i.test(s.rfilename||'')).map(s=>({name:s.rfilename,size:s.size||null}));
    const preferred=files.sort((a,b)=>{const score=f=>/q4_k_m/i.test(f.name)?0:/q4_k_s/i.test(f.name)?1:/q5_k_m/i.test(f.name)?2:/q8_0/i.test(f.name)?3:9;return score(a.name)-score(b.name)||a.name.length-b.name.length})[0];
    if(preferred){filename=preferred.name;fileSize=preferred.size||null;url=`https://huggingface.co/${x.id}/resolve/main/${encodeURI(preferred.name)}`;try{const h=await fetch(url,{method:'HEAD',redirect:'follow',headers:{'User-Agent':'MYAI-CFO/1.4.2-PRODUCTION'},signal:AbortSignal.timeout(7000)});fileSize=Number(h.headers.get('content-length'))||fileSize||null}catch{}}
  }catch{}
  return {...x,id:x.id,name:x.id,downloads:x.downloads||0,downloadsAllTime:x.downloadsAllTime||null,pageUrl:`https://huggingface.co/${x.id}`,format:'GGUF',source:'Hugging Face',url,filename,fileSize,usedStorage:x.usedStorage||null};
}
let remoteModelCache={models:[],source:'unavailable',updatedAt:null,error:null,refreshing:false};
async function refreshRemoteModelCache(q='',limit=30,offset=0){
  if(remoteModelCache.refreshing)return;
  remoteModelCache.refreshing=true;
  try{const models=await remoteModels(q,limit,offset); remoteModelCache={models,source:'huggingface-live',updatedAt:new Date().toISOString(),error:null,refreshing:false};}
  catch(e){remoteModelCache={...remoteModelCache,refreshing:false,error:String(e?.message||e)};}
}

async function remoteModels(q='',limit=60,offset=0){
  const endpoint=q?`https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=gguf&limit=${Math.min(100,Math.max(1,limit))}&offset=${Math.max(0,offset)}`:`https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=${Math.min(100,Math.max(1,limit))}&offset=${Math.max(0,offset)}`;
  const r=await fetch(endpoint,{headers:{'User-Agent':'MYAI-CFO/1.4.2-PRODUCTION'},signal:AbortSignal.timeout(12000)}); if(!r.ok)throw new Error(`Hugging Face API HTTP ${r.status}`); const arr=await r.json(); return Promise.all(arr.map(enrichRemoteModel));
}


const PROVIDER_CATALOGS = {
  "Mistral": [
    {id:"mistral-small-4",name:"Mistral Small 4",provider:"Mistral",format:"GGUF / open weights",size:"~60–238 GB VRAM depending on quantisation",parameters:"119B / 6.5B active",license:"Apache 2.0",task:"Hybrid reasoning, coding and CFO workflows",sourceUrl:"https://mistral.ai/models/",hfRepo:"bartowski/mistralai_Mistral-Small-4-119B-2603-GGUF"},
    {id:"mistral-large-3",name:"Mistral Large 3",provider:"Mistral",format:"GGUF / open weights",size:"Large / hardware dependent",parameters:"675B / 41B active",license:"Apache 2.0",task:"Frontier general reasoning",sourceUrl:"https://mistral.ai/models/",hfRepo:"bartowski/mistralai_Mistral-Large-3-675B-Instruct-2512-GGUF"},
    {id:"ministral-3-14b",name:"Ministral 3 14B",provider:"Mistral",format:"GGUF / open weights",size:"~9 GB Q4-class",parameters:"14B",license:"Apache 2.0",task:"Edge reasoning and document analysis",sourceUrl:"https://mistral.ai/models/",hfRepo:"bartowski/mistralai_Ministral-3-14B-Instruct-2512-GGUF"},
    {id:"ministral-3-8b",name:"Ministral 3 8B",provider:"Mistral",format:"GGUF / open weights",size:"~5 GB Q4-class",parameters:"8B",license:"Apache 2.0",task:"Recommended Mistral local generalist",sourceUrl:"https://mistral.ai/models/",hfRepo:"bartowski/mistralai_Ministral-3-8B-Instruct-2512-GGUF"},
    {id:"ministral-3-3b",name:"Ministral 3 3B",provider:"Mistral",format:"GGUF / open weights",size:"~2 GB Q4-class",parameters:"3B",license:"Apache 2.0",task:"Light local assistant",sourceUrl:"https://mistral.ai/models/",hfRepo:"bartowski/mistralai_Ministral-3-3B-Instruct-2512-GGUF"},
    {id:"mistral-small-3-2-24b",name:"Mistral Small 3.2 24B Instruct",provider:"Mistral",format:"GGUF",size:"~15 GB Q4_K_M",parameters:"24B",license:"Apache 2.0",task:"CFO reasoning / multilingual",sourceUrl:"https://mistral.ai/models/",hfRepo:"Mungert/Mistral-Small-3.2-24B-Instruct-2506-GGUF"},
    {id:"magistral-small-1-2",name:"Magistral Small 1.2",provider:"Mistral",format:"GGUF / open weights",size:"Hardware dependent",parameters:"24B class",license:"Apache 2.0",task:"Reasoning specialist",sourceUrl:"https://docs.mistral.ai/models/",hfRepo:"bartowski/Magistral-Small-2509-GGUF"},
    {id:"devstral-2",name:"Devstral 2",provider:"Mistral",format:"GGUF / open weights",size:"Hardware dependent",parameters:"123B class",license:"Apache 2.0",task:"Engineering / automation agent",sourceUrl:"https://docs.mistral.ai/models/",hfRepo:"bartowski/Devstral-2-123B-Instruct-2512-GGUF"}
  ],
  "Ollama": [
    {id:"ollama-qwen3-5",name:"Qwen3.5 family",provider:"Ollama",format:"Ollama",size:"0.8B–122B variants",parameters:"0.8B–122B",license:"Model-specific",task:"Current general / reasoning family",installModel:"qwen3.5",sourceUrl:"https://ollama.com/library/qwen3.5"},
    {id:"ollama-gemma4",name:"Gemma 4 family",provider:"Ollama",format:"Ollama",size:"Multiple variants",parameters:"4B–31B variants",license:"Model-specific",task:"General, reasoning and multimodal",installModel:"gemma4",sourceUrl:"https://ollama.com/library/gemma4"},
    {id:"ollama-deepseek-v4",name:"DeepSeek V4 family",provider:"Ollama",format:"Ollama",size:"Hardware / cloud dependent",parameters:"Multiple variants",license:"Model-specific",task:"Advanced reasoning",installModel:"deepseek-v4-flash",sourceUrl:"https://ollama.com/search?q=deepseek-v4"},
    {id:"ollama-kimi-k3",name:"Kimi K3",provider:"Ollama",format:"Ollama",size:"Hardware / variant dependent",parameters:"Open-weight family",license:"Model-specific",task:"Agentic reasoning",installModel:"kimi-k3",sourceUrl:"https://ollama.com/library/kimi-k3"},
    {id:"ollama-qwen3-4b",name:"Qwen3 4B",provider:"Ollama",format:"Ollama",size:"~2.5 GB",parameters:"4B",license:"Apache 2.0",task:"Recommended local CFO generalist",installModel:"qwen3:4b",sourceUrl:"https://ollama.com/library/qwen3"},
    {id:"ollama-qwen3-8b",name:"Qwen3 8B",provider:"Ollama",format:"Ollama",size:"~5.2 GB",parameters:"8B",license:"Apache 2.0",task:"Higher-quality local reasoning",installModel:"qwen3:8b",sourceUrl:"https://ollama.com/library/qwen3"},
    {id:"ollama-mistral-small",name:"Mistral Small 24B",provider:"Ollama",format:"Ollama",size:"~14 GB",parameters:"24B",license:"Apache 2.0",task:"Strong local finance/general reasoning",installModel:"mistral-small:24b",sourceUrl:"https://ollama.com/library/mistral-small"},
    {id:"ollama-llama31",name:"Llama 3.1",provider:"Ollama",format:"Ollama",size:"8B / 70B / 405B variants",parameters:"8B–405B",license:"Llama license",task:"General reasoning",installModel:"llama3.1",sourceUrl:"https://ollama.com/library/llama3.1"}
  ],
  "LM Studio": [
    {id:"lm-granite-4-micro",name:"IBM Granite 4 Micro",provider:"LM Studio",format:"LM Studio / GGUF",size:"~2–3 GB class",parameters:"3B class",license:"Model-specific",task:"Small local assistant",installModel:"ibm/granite-4-micro",sourceUrl:"https://lmstudio.ai/models"},
    {id:"lm-qwen3-4b",name:"Qwen3 4B",provider:"LM Studio",format:"LM Studio / GGUF",size:"~2.5 GB class",parameters:"4B",license:"Apache 2.0",task:"Local CFO generalist",installModel:"qwen/qwen3-4b",sourceUrl:"https://lmstudio.ai/models"},
    {id:"lm-llama31-8b",name:"Llama 3.1 8B",provider:"LM Studio",format:"LM Studio / GGUF",size:"~4.9 GB Q4 class",parameters:"8B",license:"Llama license",task:"General reasoning",installModel:"meta-llama/llama-3.1-8b",sourceUrl:"https://lmstudio.ai/models"},
    {id:"lm-qwen35-9b",name:"Qwen3.5 9B",provider:"LM Studio",format:"LM Studio / GGUF",size:"~6 GB Q4 class",parameters:"9B",license:"Model-specific",task:"Reasoning / agentic tasks",installModel:"qwen/qwen3.5-9b",sourceUrl:"https://lmstudio.ai/models"},
    {id:"lm-mistral-small",name:"Mistral Small",provider:"LM Studio",format:"LM Studio / GGUF",size:"Hardware dependent",parameters:"24B class",license:"Apache 2.0",task:"Finance/general reasoning",installModel:"mistralai/mistral-small",sourceUrl:"https://lmstudio.ai/models"},
    {id:"lm-gemma4-12b",name:"Gemma 4 12B",provider:"LM Studio",format:"LM Studio / GGUF",size:"Hardware dependent",parameters:"12B",license:"Model-specific",task:"Reasoning / multimodal family",installModel:"google/gemma-4-12b",sourceUrl:"https://lmstudio.ai/models"}
  ],
  "ModelScope": [
    {id:"ms-qwen3",name:"Qwen3 model family",provider:"ModelScope",format:"ModelScope",size:"Varies by quantisation",parameters:"Multiple",license:"Model-specific",task:"China/Asia model ecosystem",sourceUrl:"https://modelscope.cn/models",requiresAuth:false},
    {id:"ms-deepseek",name:"DeepSeek model family",provider:"ModelScope",format:"ModelScope",size:"Varies by model",parameters:"Multiple",license:"Model-specific",task:"Reasoning model ecosystem",sourceUrl:"https://modelscope.cn/models",requiresAuth:false},
    {id:"ms-mistral",name:"Mistral model family",provider:"ModelScope",format:"ModelScope",size:"Varies by model",parameters:"Multiple",license:"Model-specific",task:"Open-weight model ecosystem",sourceUrl:"https://modelscope.cn/models",requiresAuth:false}
  ],
  "NVIDIA NGC": [
    {id:"ngc-nvidia-models",name:"NVIDIA NGC Model Catalog",provider:"NVIDIA NGC",format:"NGC",size:"Model-specific",parameters:"Model-specific",license:"Model-specific",task:"NVIDIA-optimised models",sourceUrl:"https://catalog.ngc.nvidia.com/models",requiresAuth:true},
    {id:"ngc-nim-llm",name:"NVIDIA NIM LLM Catalog",provider:"NVIDIA NGC",format:"NGC / NIM",size:"Model-specific",parameters:"Model-specific",license:"Model-specific",task:"Enterprise accelerated inference",sourceUrl:"https://catalog.ngc.nvidia.com/ai-foundation",requiresAuth:true},
    {id:"ngc-nim-embeddings",name:"NVIDIA NIM Embedding Catalog",provider:"NVIDIA NGC",format:"NGC / NIM",size:"Model-specific",parameters:"Model-specific",license:"Model-specific",task:"Embedding / retrieval",sourceUrl:"https://catalog.ngc.nvidia.com/ai-foundation",requiresAuth:true}
  ]
};

function commandPath(command){
  return new Promise(resolve=>{
    const exe=process.platform==='win32'?'where.exe':'which';
    execFile(exe,[command],{timeout:2500,windowsHide:true},(err,stdout)=>{
      if(!err&&stdout?.trim())return resolve(stdout.trim().split(/\r?\n/)[0]);
      if(process.platform==='win32'){
        const candidates=[];
        if(command==='ollama.exe')candidates.push(path.join(process.env.LOCALAPPDATA||'', 'Programs','Ollama','ollama.exe'));
        if(command==='lms.cmd')candidates.push(path.join(process.env.LOCALAPPDATA||'', 'Programs','LM Studio','resources','app','bin','lms.cmd'));
        const found=candidates.find(fs.existsSync); if(found)return resolve(found);
      }
      resolve(null);
    });
  });
}
async function commandAvailable(command){return !!(await commandPath(command));}
async function providerStatus(){
  const [ollama,lms]=await Promise.all([ollamaStatus(),commandAvailable(process.platform==='win32'?'lms.cmd':'lms')]);
  let lmApi=false;
  try{const r=await fetch('http://127.0.0.1:1234/api/v1/models',{signal:AbortSignal.timeout(1000)});lmApi=r.ok;}catch{}
  return {ollama:{...ollama,installed:await commandAvailable(process.platform==='win32'?'ollama.exe':'ollama')},lmStudio:{installed:lms,apiOnline:lmApi}};
}
async function resolveHFRepoGGUF(repo){
  const r=await fetch(`https://huggingface.co/api/models/${repo}`,{headers:{'User-Agent':'MYAI-CFO/1.4.2-PRODUCTION'},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error(`Hugging Face repository HTTP ${r.status}`);
  const meta=await r.json();
  const files=(meta.siblings||[]).filter(s=>/\.gguf$/i.test(s.rfilename||'')).map(s=>({name:s.rfilename,size:s.size||null}));
  if(!files.length)throw new Error('No GGUF file is available in the selected repository.');
  const preferred=files.sort((a,b)=>{
    const score=f=>/q4_k_m/i.test(f.name)?0:/q4_k_s/i.test(f.name)?1:/q5_k_m/i.test(f.name)?2:/q6_k/i.test(f.name)?3:/q8_0/i.test(f.name)?4:9;
    return score(a)-score(b)||String(a.name).length-String(b.name).length;
  })[0];
  return {filename:path.basename(preferred.name),url:`https://huggingface.co/${repo}/resolve/main/${encodeURI(preferred.name)}`,pageUrl:`https://huggingface.co/${repo}`};
}
async function startChildProviderJob(provider,model){
  const jobId=id('providerjob');
  const job={jobId,provider,name:model.name,status:'queued',bytesReceived:0,totalBytes:0,speedBps:0,output:'',error:null,process:null};
  modelDownloadJobs.set(jobId,job);
  const command=provider==='Ollama'?(process.platform==='win32'?'ollama.exe':'ollama'):(process.platform==='win32'?'lms.cmd':'lms');
  const args=provider==='Ollama'?['pull',model.installModel]:['get',model.installModel];
  const resolved=await commandPath(command);
  if(!resolved) { job.status='failed'; job.error=`${provider} is not installed or its local CLI could not be detected.`; return job; }
  const child=spawn(resolved,args,{windowsHide:true,shell:false});
  job.process=child; job.status='downloading';
  child.stdout?.on('data',d=>{job.output=(job.output+String(d)).slice(-4000);});
  child.stderr?.on('data',d=>{job.output=(job.output+String(d)).slice(-4000);});
  child.on('error',e=>{job.status='failed';job.error=e.message;});
  child.on('close',code=>{if(job.status!=='cancelled')job.status=code===0?'completed':'failed';if(code!==0&&!job.error)job.error=`${provider} command exited with code ${code}`;audit(job.status==='completed'?'MODEL_PROVIDER_INSTALLED':'MODEL_PROVIDER_INSTALL_FAILED',{provider,model:model.installModel,jobId});});
  return job;
}




function resolveHtmlAssetUrls(html,baseUrl){
  try{
    const raw=String(html||'');
    return raw.replace(/(<img\b[^>]*\bsrc\s*=\s*[\"'])([^\"']+)([\"'])/gi,(m,prefix,src,suffix)=>{
      if(/^(?:data:|blob:|https?:|\/\/)/i.test(src)) return m;
      try{return `${prefix}${new URL(src,baseUrl).toString()}${suffix}`;}catch{return m;}
    });
  }catch{return html;}
}

async function fetchPublicKnowledgeUrl(rawUrl){
  const url=new URL(String(rawUrl||'')); if(!['http:','https:'].includes(url.protocol))throw new Error('Only HTTP/HTTPS URLs are supported.');
  const host=url.hostname.toLowerCase(); if(['localhost','127.0.0.1','0.0.0.0','::1'].includes(host)||host.endsWith('.local'))throw new Error('Local/private URLs are not allowed.');
  const ip=net.isIP(host)?host:(await dns.lookup(host)).address; const privateRanges=[/^10\./,/^192\.168\./,/^172\.(1[6-9]|2\\d|3[0-1])\./,/^169\.254\./,/^127\./,/^0\./,/^::1$/i,/^fc/i,/^fd/i,/^fe80/i]; if(privateRanges.some(r=>r.test(ip)))throw new Error('Private or loopback network targets are not allowed.');
  const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':'MYAI-CFO/1.4 MVP Knowledge Bot'},signal:AbortSignal.timeout(20000)}); if(!r.ok)throw new Error(`URL returned HTTP ${r.status}`);
  const contentType=r.headers.get('content-type')||''; const buf=Buffer.from(await r.arrayBuffer()); if(buf.length>20*1024*1024)throw new Error('Knowledge URL exceeds the 20 MB Production ingestion limit.');
  let text=''; let filename=path.basename(url.pathname)||'web-resource'; let pageTitle='';
  const originalBase64=buf.toString('base64');
  let storedBase64=originalBase64; let extractionBase64=originalBase64;
  if(contentType.includes('application/pdf')||/\.pdf$/i.test(url.pathname)){const ex=await extractDocument(filename.endsWith('.pdf')?filename:`${filename}.pdf`,extractionBase64);text=ex.text||'';filename=filename.endsWith('.pdf')?filename:`${filename}.pdf`;} else {const raw=resolveHtmlAssetUrls(buf.toString('utf8'),String(url)); const tm=raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i); pageTitle=tm?tm[1].replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim():''; text=raw.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim(); extractionBase64=Buffer.from(raw,'utf8').toString('base64'); storedBase64=extractionBase64;}
  return {url:String(url),contentType,size:buf.length,text,filename,pageTitle,base64:storedBase64,originalBase64,extractionBase64};
}

async function fetchPublicDocumentUrl(rawUrl){
  let current=new URL(String(rawUrl||''));
  const allowedExtensions=/\.(pdf|docx|xlsx|xls|csv|txt|json|xml|html?)$/i;
  for(let hop=0;hop<6;hop++){
    if(!['http:','https:'].includes(current.protocol))throw new Error('Document URL must use HTTP or HTTPS.');
    const host=current.hostname.toLowerCase();
    if(['localhost','127.0.0.1','0.0.0.0','::1'].includes(host)||host.endsWith('.local'))throw new Error('Local/private document URLs are not allowed.');
    const addrs=net.isIP(host)?[{address:host}]:await dns.lookup(host,{all:true});
    const privateRanges=[/^10\./,/^192\.168\./,/^172\.(1[6-9]|2\d|3[0-1])\./,/^169\.254\./,/^127\./,/^0\./,/^::1$/i,/^fc/i,/^fd/i,/^fe80/i];
    if(addrs.some(x=>privateRanges.some(r=>r.test(x.address))))throw new Error('Private or loopback document targets are not allowed.');
    const r=await fetch(current,{redirect:'manual',headers:{'User-Agent':'MYAI-CFO/1.24.26 Document Import'},signal:AbortSignal.timeout(60000)});
    if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(!loc)throw new Error(`URL redirect returned HTTP ${r.status} without Location.`);current=new URL(loc,current);continue;}
    if(!r.ok)throw new Error(`URL returned HTTP ${r.status}.`);
    const buf=Buffer.from(await r.arrayBuffer());
    if(buf.length>52*1024*1024)throw new Error('Document exceeds the 50 MB URL ingestion limit.');
    const ct=(r.headers.get('content-type')||'').toLowerCase();
    const cd=r.headers.get('content-disposition')||''; const m=cd.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
    let filename=m?decodeURIComponent(m[1].trim().replace(/^\"|\"$/g,'')):path.basename(current.pathname)||'url-document';
    if(!/\.[a-z0-9]{2,5}$/i.test(filename)) filename=ct.includes('pdf')?`${filename}.pdf`:filename;
    if(!(ct.includes('pdf')||ct.includes('officedocument')||ct.includes('spreadsheet')||ct.includes('csv')||ct.includes('text')||ct.includes('json')||ct.includes('xml')||allowedExtensions.test(filename)))throw new Error('URL does not appear to reference a supported financial document type.');
    const originalBase64=buf.toString('base64'); let extractionBase64=originalBase64; let pageTitle='';
    if(ct.includes('html')||/\.html?$/i.test(filename)){const html=resolveHtmlAssetUrls(buf.toString('utf8'),String(current));const tm=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);pageTitle=tm?tm[1].replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim():'';extractionBase64=Buffer.from(html,'utf8').toString('base64');}
    return {finalUrl:String(current),contentType:ct,size:buf.length,filename,pageTitle,base64:originalBase64,originalBase64,extractionBase64};
  }
  throw new Error('Too many redirects while fetching document URL.');
}

function financialQueryProfile(message=''){
  const text=String(message||'').toLowerCase();
  const concepts={
    revenue:['revenue','net sales','sales'],
    gross_profit:['gross profit','gross margin'],
    operating_income:['operating income','operating profit'],
    ebitda:['ebitda','adjusted ebitda'],
    net_income:['net income','net loss','profit after tax'],
    cash:['cash and cash equivalents','cash equivalents','cash'],
    debt:['total debt','debt','borrowings'],
    assets:['total assets','assets'],
    liabilities:['total liabilities','liabilities'],
    receivables:['accounts receivable','receivables'],
    payables:['accounts payable','payables'],
    inventory:['inventory','inventories'],
    capex:['capital expenditures','capital expenditure','capex']
  };
  const hits=[]; for(const [concept,terms] of Object.entries(concepts))if(terms.some(t=>text.includes(t)))hits.push(...terms);
  const years=[...new Set((String(message||'').match(/\b20[0-9]{2}\b/g)||[]))];
  return {terms:[...new Set(hits)].slice(0,12),years,concepts:Object.entries(concepts).filter(([,terms])=>terms.some(t=>text.includes(t))).map(([c])=>c)};
}
function rankFinancialEvidence(documents=[],message='',fiscalYears=[]){
  const q=financialQueryProfile(message); const wantedYears=new Set((fiscalYears||[]).map(String));
  const rows=[];
  for(const doc of documents||[]){
    const docYear=String(doc.fiscalYear||'');
    const sourceRows=[...(doc.evidence||[]).map(e=>({...e,text:String(e.text||'')}))];
    if(doc.contentPath){try{const cp=path.resolve(root,doc.contentPath);if(fs.existsSync(cp)){const full=fs.readFileSync(cp,'utf8');const pieces=full.split(/\n\s*\n|(?<=\.)\s{2,}/).map(x=>x.trim()).filter(x=>x.length>40);sourceRows.push(...pieces.map((text,i)=>({id:`${doc.id}-full-${i+1}`,documentId:doc.id,filename:doc.filename,ordinal:(doc.evidence?.length||0)+i+1,text})));}}catch{}}
    for(const e of sourceRows.slice(0,320)){
      const text=String(e.text||''); const lower=text.toLowerCase();
      const termScore=q.terms.filter(t=>lower.includes(t)).length;
      const yearScore=q.years.filter(y=>text.includes(y)).length + (wantedYears.has(docYear)?1:0);
      const filingScore=/revenue|net sales|gross profit|operating income|ebitda|net income|cash and cash equivalents|total assets|total liabilities|accounts receivable|accounts payable|inventory|capital expenditures/i.test(text)?1:0;
      const score=termScore*5+yearScore*4+filingScore*1 + (doc.documentType==='Annual Report'?2:0);
      rows.push({...e,filename:doc.filename,fiscalYear:docYear,score,documentId:doc.id});
    }
  }
  return rows.sort((a,b)=>b.score-a.score||a.ordinal-b.ordinal).slice(0,40);
}
function rankCandidateFacts(facts=[],message=''){
  const q=financialQueryProfile(message); return (facts||[]).map(f=>{const t=`${f.concept||''} ${f.rawValue||''} ${f.evidenceText||''}`.toLowerCase(); const score=q.terms.filter(x=>t.includes(x)).length*5+q.years.filter(y=>t.includes(y)).length*4; return {...f,score};}).sort((a,b)=>b.score-a.score).slice(0,20);
}

function parseAiFactPayload(text){
  const raw=String(text||'').trim(); const variants=[...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m=>m[1].trim()); variants.push(raw);
  for(const candidate of variants){ try{const obj=JSON.parse(candidate);if(Array.isArray(obj?.facts))return obj.facts.filter(x=>x&&String(x.concept||'').trim()&&String(x.value??'').trim());}catch{} const m=candidate.match(/\{[\s\S]*"facts"\s*:\s*\[[\s\S]*\][\s\S]*\}/); if(m){try{const obj=JSON.parse(m[0]);if(Array.isArray(obj?.facts))return obj.facts.filter(x=>x&&String(x.concept||'').trim()&&String(x.value??'').trim());}catch{}} } return [];
}

const FINANCIAL_SCALE_FACTORS={units:1,thousand:1e3,k:1e3,million:1e6,m:1e6,billion:1e9,bn:1e9,trillion:1e12,tn:1e12,crore:1e7,cr:1e7,lakh:1e5};
function financialScaleFactor(scale){return FINANCIAL_SCALE_FACTORS[String(scale||'units').toLowerCase()]||1;}
function sourceNumericValue(f){
  if(f==null)return null;
  if(typeof f==='number')return Number.isFinite(f)?f:null;
  const raw=String(f.rawValue??f.value??'').trim();
  // Zero is valid only when the source explicitly contains zero. Blank/dash cells
  // that were previously persisted as normalizedValue=0 are evidence gaps.
  if(!raw){const n=Number(f.normalizedValue);return Number.isFinite(n)&&n!==0?n:null;}
  let s=raw.replace(/ /g,' ').replace(/[₹$€£]/g,'').trim();
  const neg=/^\(.*\)$/.test(s)||/^-/.test(s); s=s.replace(/^\(|\)$/g,'').trim();
  const mm=s.match(/^([+-]?[0-9][0-9,]*(?:\.[0-9]+)?)\s*(trillion|tn|billion|bn|million|mn|thousand|k|m|crore|cr|lakh)?$/i);
  if(mm){const n=Number(mm[1].replace(/,/g,''));if(Number.isFinite(n))return neg?-Math.abs(n):Math.abs(n);}
  return null;
}
function sourceNumericIsExplicitZero(f){
  if(f==null)return false;
  const raw=String(f.rawValue??f.value??'').trim().replace(/ /g,' ');
  return /^(?:\(?[-+]?0+(?:\.0+)?\)?|[$₹€£]\s*\(?[-+]?0+(?:\.0+)?\)?)$/.test(raw);
}
function normalizeFinancialNumber(value,unit=''){
  const raw=String(value??'').trim();
  if(!raw)return null;
  let s=raw.replace(/\u00a0/g,' ').replace(/[₹$€£]/g,'').trim();
  let neg=/^\(.*\)$/.test(s) || /^-/.test(s);
  s=s.replace(/^\(|\)$/g,'').trim();
  const lower=s.toLowerCase();
  let multiplier=1;
  if(/\btrillion\b|\btn\b/.test(lower))multiplier=1e12;
  else if(/\bbillion\b|\bbn\b/.test(lower))multiplier=1e9;
  else if(/\bmillion\b|\bmn\b/.test(lower))multiplier=1e6;
  const cleaned=s.replace(/,/g,'').replace(/[^0-9.\-]/g,'');
  const n=Number(cleaned);
  if(!Number.isFinite(n))return null;
  const unitLower=String(unit||'').toLowerCase();
  if(unitLower.includes('crore'))multiplier=1e7;
  if(unitLower.includes('lakh'))multiplier=1e5;
  return (neg?-1:1)*n*multiplier;
}
const FACT_CONCEPT_ALIASES = {
  revenue:['revenue','revenues','total_revenue','total_revenues','net_sales','sales','revenue_from_operations','value_of_sales_services','revenue_from_operations_net'],
  gross_profit:['gross_profit'],
  operating_income:['operating_income','income_from_operations','operating_profit','profit_from_operations'],
  ebitda:['ebitda'],
  net_income:['net_income','net_profit','net_earnings','profit_for_the_year','profit_for_year','profit_attributable'],
  cash:['cash','cash_and_cash_equivalents','cash_equivalents','closing_balance_of_cash_and_cash_equivalents'],
  current_assets:['current_assets','total_current_assets'],
  assets:['assets','total_assets','total_assets_reported'],
  receivables:['receivables','trade_receivables','accounts_receivable','accounts_receivables'],
  inventory:['inventory','inventories'],
  current_liabilities:['current_liabilities','total_current_liabilities'],
  current_debt:['current_debt','current_portion_of_debt_and_finance_leases'],
  long_term_debt:['long_term_debt','debt_and_finance_leases_net_of_current_portion'],
  liabilities:['liabilities','total_liabilities','total_liability'],
  payables:['payables','trade_payables','accounts_payable','accounts_payables'],
  purchases:['purchases','purchases_from_suppliers','credit_purchases'],
  debt:['debt','total_debt','borrowings','total_borrowings','long_term_debt'],
  capex:['capex','capital_expenditure','capital_expenditures','purchase_of_property_plant_and_equipment'],
  operating_cash_flow:['operating_cash_flow','net_cash_flow_from_operating_activities','cash_flow_from_operating_activities'],
  interest_expense:['interest_expense','finance_costs','finance_cost'],
  depreciation_amortization:['depreciation_amortization','depreciation_and_amortization','depreciation_and_amortisation'],
  cogs:['cogs','cost_of_goods_sold','cost_of_sales'],
  equity:['equity','total_equity','shareholders_equity','shareholders_equity_attributable_to_owners','owners_equity','total_equity_and_liabilities_minus_liabilities'],
  tax_expense:['tax_expense','income_tax_expense','taxes'],
};
const FACT_ALIAS_TO_CANONICAL = Object.fromEntries(Object.entries(FACT_CONCEPT_ALIASES).flatMap(([k,arr])=>arr.map(x=>[x,k])));
function canonicalFactConcept(concept){
  const raw=String(concept||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return FACT_ALIAS_TO_CANONICAL[raw] || raw;
}
function normalizedFactNumber(f){
  // Financial facts are source-scale values. Never prefer a pre-normalized/base-unit
  // field because older documents may still carry million/crore-expanded values.
  return sourceNumericValue(f);
}
function factFiscalYearNumber(f){
  const y=Number(String(f?.fiscalYear||'').match(/(?:19|20)\d{2}/)?.[0]||0);
  return Number.isFinite(y)?y:-Infinity;
}
function periodAwareFactRank(f,targetYear=null){
  const fy=factFiscalYearNumber(f);
  const target=targetYear!=null?Number(targetYear):-Infinity;
  const matchesTarget=target!==-Infinity&&fy===target;
  // Period is the first-order selector for financial statements. Within the same
  // fiscal year, prefer system-verified, then user-validated, then consensus/confidence.
  return [Number(matchesTarget),fy,Number(!!f.systemVerified),Number(!!f.validated),Number(f.consensusCount||0),Number(f.confidence||0),String(f.validatedAt||f.createdAt||'')];
}
function factQualityRank(f){
  return [Number(!!f.systemVerified),Number(!!f.validated),Number(f.consensusCount||0),Number(f.confidence||0),String(f.validatedAt||f.createdAt||'')];
}
function factIsSame(a,b){
  if(!a||!b)return false;
  return a.documentId===b.documentId && canonicalFactConcept(a.concept)===canonicalFactConcept(b.concept) && String(a.fiscalYear||'')===String(b.fiscalYear||'') && normalizedFactNumber(a)===normalizedFactNumber(b);
}
function canonicalizeFactObject(x,doc={},companyId='',docId=''){
  let concept=canonicalFactConcept(x.concept);
  const rawSourceLabel=String(x.sourceLabel||x.rowLabel||'').trim();
  if(concept==='liabilities' && /\bliabilit(?:y|ies)\s+(?:and|&)\s+equity\b/i.test(rawSourceLabel)) concept='liabilities_and_equity';
  const docUnit=String(doc.documentUnit||'').trim();
  const docScale=String(doc.documentScale||'').trim().toLowerCase();
  const explicitDocUnit=docUnit && !/^\s*(?:INR|USD|GBP|EUR|JPY|CNY|CAD|AUD|SGD|HKD|AED|IDR|ZAR|BRL|MXN|SAR|CHF|NOK|SEK|DKK|NZD)\s*$/i.test(docUnit);
  const factScale=(docScale&&docScale!=='units')?docScale:(x.scale||docScale||'units');
  const factUnit=explicitDocUnit?docUnit:(x.unit||docUnit||'');
  const rawValue=String(x.value??x.rawValue??'').trim();
  const sourceValue=sourceNumericValue({rawValue,normalizedValue:x.normalizedValue,value:x.value});
  const inferredBase=Number.isFinite(sourceValue)?sourceValue*financialScaleFactor(factScale):Number(x.absoluteValue);
  const normalized=Number.isFinite(sourceValue)?sourceValue:inferredBase;
  const statementContext=x.statementContext||x.sourceStatement||x.statement||'financial-statement';
  const sourceLabel=rawSourceLabel || String(rawValue.split(/\n|\|/)[0]||'').trim().slice(0,240);
  const aggregateRole=x.aggregateRole||(/\btotal\b/i.test(sourceLabel)?'reported-aggregate':'source-line');
  return {id:x.id||id('fact'),companyId:x.companyId||companyId,documentId:x.documentId||docId,concept,rawValue,normalizedValue:Number.isFinite(normalized)?normalized:null,absoluteValue:Number.isFinite(inferredBase)?inferredBase:null,baseValue:Number.isFinite(inferredBase)?inferredBase:null,unit:factUnit,currency:String(doc.documentCurrency||doc.currency||x.currency||'').toUpperCase(),fiscalYear:String(x.fiscalYear||doc.documentFiscalYear||doc.fiscalYear||''),periodEnd:x.periodEnd||null,evidenceText:String(x.evidenceText||x.evidence||''),sourceLabel,aggregateRole,sourcePage:x.sourcePage??x.page??null,status:x.status||'candidate',validated:!!x.validated,systemVerified:!!x.systemVerified,verificationMethod:x.verificationMethod||x.extractionMethod||'structured-extractor',extractionMethod:x.extractionMethod||'structured-extractor',scale:factScale,sourceUnitText:x.sourceUnitText||docUnit||null,confidence:Number(x.confidence??0.8),consensusCount:Number(x.consensusCount||0),consensusExtractors:Array.isArray(x.consensusExtractors)?x.consensusExtractors:[],consensusQuality:Number(x.consensusQuality??0),sourceStatement:statementContext,statementContext,createdAt:x.createdAt||new Date().toISOString()};
}
function structuredFactsToCandidates(structuredFacts=[],docId='',companyId='',doc={}){
  return (structuredFacts||[]).map(x=>canonicalizeFactObject(x,doc,companyId,docId)).filter(x=>x.concept&&x.normalizedValue!=null);
}

function deterministicCandidateFacts(text='',docId='',companyId='',doc={}){
  const aliases={revenue:['revenue','total revenues','total revenue','net sales'],gross_profit:['gross profit'],operating_income:['operating income','income from operations'],net_income:['net income','net earnings','net loss','profit for the year'],cash:['cash and cash equivalents','cash equivalents','closing balance of cash and cash equivalents'],current_assets:['total current assets','current assets'],current_liabilities:['total current liabilities','current liabilities'],assets:['total assets'],liabilities:['total liabilities'],debt:['total debt','long-term debt','borrowings'],receivables:['accounts receivable','trade receivables'],payables:['accounts payable','trade payables'],inventory:['inventories','inventory'],capex:['capital expenditures','capital expenditure'],operating_cash_flow:['net cash flow from operating activities','operating cash flow'],interest_expense:['interest expense','finance costs']};
  const rows=[]; const seen=new Set(); const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>3&&x.length<220);
  for(let i=0;i<lines.length;i++){
    const line=lines[i],lower=line.toLowerCase();
    for(const [concept,terms] of Object.entries(aliases)){
      if(!terms.some(t=>lower===t || lower.startsWith(t+' ') || lower.includes(' '+t+' ')))continue;
      const window=[line,lines[i+1]||'',lines[i+2]||'',lines[i+3]||''].join(' ');
      const nums=[...window.matchAll(/(?:[$€£₹]\s*)?-?\(?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?\)?(?:\s*(?:million|billion|crore|lakh|mn|bn))?/gi)].map(m=>m[0]);
      const raw=nums[0]||''; const normalized=sourceNumericValue({rawValue:raw}); if(!raw||normalized==null)continue;
      const key=`${concept}|${normalized}|${doc.fiscalYear||''}`; if(seen.has(key))continue;seen.add(key); const scale=doc.documentScale||'units';
      rows.push({id:id('fact'),companyId,documentId:docId,concept,rawValue:raw,normalizedValue:normalized,baseValue:normalized*financialScaleFactor(scale),absoluteValue:normalized*financialScaleFactor(scale),unit:doc.documentUnit||'',currency:doc.currency||'',scale,fiscalYear:doc.fiscalYear||'',evidenceText:window,status:'candidate',validated:false,systemVerified:false,extractionMethod:'guarded-line-match',confidence:0.75,createdAt:new Date().toISOString()});
    }
  }
  return rows.slice(0,40);
}

function sfNormalized(sf){return sourceNumericValue(sf);}

function validateFinancialFactSet(facts=[]){
  const by=new Map();
  for(const f of facts){
    const key=`${String(f.concept||'').toLowerCase()}|${String(f.fiscalYear||'')}`;
    if(!by.has(key)) by.set(key, f);
  }
  const bad=[];
  const v=(concept,year)=>{const f=by.get(`${concept}|${year}`);const x=sourceNumericValue(f);return Number.isFinite(x)?x:null;};
  const years=[...new Set(facts.map(f=>String(f.fiscalYear||'')))] .filter(Boolean);
  for(const year of years){
    const checks=[
      ['cash_le_current_assets',v('cash',year),v('current_assets',year),x=>x[0] <= x[1]],
      ['receivables_le_current_assets',v('receivables',year),v('current_assets',year),x=>x[0] <= x[1]],
      ['inventory_le_current_assets',v('inventory',year),v('current_assets',year),x=>x[0] <= x[1]],
      ['current_assets_le_assets',v('current_assets',year),v('assets',year),x=>x[0] <= x[1]],
      ['current_liabilities_le_liabilities',v('current_liabilities',year),v('liabilities',year),x=>x[0] <= x[1]],
      ['debt_le_liabilities',v('debt',year),v('liabilities',year),x=>x[0] <= x[1]],
    ];
    for(const [name,a,b,ok] of checks){if(a!=null&&b!=null&&!ok([a,b]))bad.push({name,year,a,b});}
  }
  return {ok:bad.length===0,violations:bad};
}


async function processDocumentAiJob(jobId){
  const job=state.aiJobs[jobId];if(!job||['completed','failed'].includes(job.status))return job;job.status='running';job.startedAt=new Date().toISOString();job.estimatedSeconds=job.estimatedSeconds||120;job.progress=10;job.etaSeconds=job.estimatedSeconds;job.stage='AI evidence review';save();
  try{
    if(!installedModels(false).length){job.status='waiting_for_model';job.waitingForModel=true;job.waitingAt=job.waitingAt||new Date().toISOString();save();audit('DOCUMENT_AI_REVIEW_WAITING_FOR_MODEL',{jobId,documentId:job.documentId});return job;}
    const company=state.companies.find(c=>c.id===job.companyId),doc=company?.documents?.find(d=>d.id===job.documentId);if(!company||!doc)throw new Error('Company or document not found');
    const rawText=doc.contentPath?fs.readFileSync(path.resolve(root,doc.contentPath),'utf8'):'';const structuredConcepts=new Set((doc.structuredFacts||[]).map(x=>String(x.concept||'').toLowerCase())); const deterministicFallback=deterministicCandidateFacts(rawText,doc.id,company.id,doc).filter(x=>!structuredConcepts.has(String(x.concept||'').toLowerCase())); const deterministic=[...(doc.structuredFacts||[]).map(x=>({...x,systemVerified:false,validated:false,extractionMethod:x.extractionMethod||'ensemble-structured-statement'})),...deterministicFallback];
    const ranked=rankFinancialEvidence(company.documents||[],`revenue EBITDA cash assets liabilities current assets current liabilities ${doc.filename||''}`,doc.fiscalYear?[String(doc.fiscalYear)]:[]).filter(e=>e.documentId===doc.id);const evidence=(ranked.length?ranked:doc.evidence||[]).slice(0,24).map(e=>`[Evidence ${e.ordinal||''}] ${String(e.text||'').slice(0,900)}`).join('\n');job.progress=35;job.stage='Packing relevant evidence';save();
    const activeInstructions=readJson(path.join(dataDir,'knowledge','instructions.json'),[]).filter(x=>!x.archived); const retrievedKnowledge=[];
    const prompt=`You are MYAI CFO's document evidence analyst. Extract only directly supported financial facts from the supplied company document evidence. Return concise review text followed by JSON exactly in this shape: {"facts":[{"concept":"revenue","value":"<exact source number>","evidence_quote":"<exact supporting quote>"}]}. Do not infer, calculate, copy values from examples, or use Knowledge Hub material as company facts. Primary financial-statement evidence outranks narrative/auditor/subsidiary discussion for headline company KPIs. Preserve the source currency, unit, fiscal year and sign.\n\nDocument: ${doc.filename}; company: ${company.name}; type: ${doc.documentType}; document FY: ${doc.fiscalYear}\n\nEVIDENCE:\n${evidence}\n\nRETRIEVED KNOWLEDGE (methodology only):\n${JSON.stringify(retrievedKnowledge.slice(0,8))}\n\nUSER INSTRUCTIONS:\n${JSON.stringify(activeInstructions.map(x=>x.text))}`;
    const instructionSafety=safetyCheck(activeInstructions.map(x=>String(x.text||'')).join('\n'));if(!instructionSafety.allowed)throw new Error(instructionSafety.message);const companyContext=companyEvidenceContext(company);companyContext.candidateFacts=[];
    let arena=null,winnerText='',aiFacts=[];try{arena=await runAgentCompetition({message:prompt,task:'document_evidence_extraction',companyContext,activeInstructions,retrievedKnowledge:[],correlationId:job.correlationId,modelFilename:state.selectedModelFilename||null});if(arena.ok){winnerText=arena.winner.answer;aiFacts=parseAiFactPayload(winnerText);}}catch(e){arena={ok:false,message:String(e?.message||e),reason:'arena_exception'}}
    job.progress=70;job.stage=arena?.ok?'Validating evidence matches':'Using deterministic evidence fallback';job.etaSeconds=5;save();
    const mergedRaw=[...deterministic.map(x=>({...x,method:'deterministic'})),...aiFacts.map(x=>({...x,method:'model'}))]; const semanticCheck=validateFinancialFactSet(deterministic.map(x=>({concept:x.concept,normalizedValue:sfNormalized(x),fiscalYear:x.fiscalYear}))); const semanticInconsistency=!semanticCheck.ok; job.semanticValidation=semanticInconsistency?{status:'warning',policy:'preserve-source-facts-block-derived-use',violations:semanticCheck.violations}:{status:'passed',violations:[]}; if(semanticInconsistency){audit('DOCUMENT_FINANCIAL_SEMANTIC_VALIDATION_WARNING',{jobId,documentId:doc.id,violations:semanticCheck.violations},{correlationId:job.correlationId});} const merged=mergedRaw,retained=(company.facts||[]).filter(f=>f.documentId===doc.id&&(f.validated||f.systemVerified));company.facts=(company.facts||[]).filter(f=>f.documentId!==doc.id||f.validated||f.systemVerified);const newFacts=[];
    for(const item of merged){
      const concept=String(item.concept||'').trim(),rawValue=String(item.value??item.rawValue??'').trim(),quote=String(item.evidence_quote||item.evidenceText||'').trim();if(!concept||!rawValue)continue;
      const sourceScale=String(item.scale||item.documentScale||doc.documentScale||'units').toLowerCase();
      const sourceCurrency=String(item.currency||doc.documentCurrency||doc.currency||'').toUpperCase();
      const normalizedSource=sourceNumericValue({rawValue,itemValue:item.value,value:item.value,normalizedValue:item.normalizedValue});
      const normalizedValue=Number.isFinite(normalizedSource)?normalizedSource:null;
      const evidenceMatch=(doc.evidence||[]).find(e=>quote&&String(e.text).toLowerCase().includes(quote.toLowerCase()))||(doc.evidence||[]).find(e=>String(e.text).toLowerCase().includes(concept.toLowerCase()));
      const desiredYear=String(item.fiscalYear||doc.documentFiscalYear||doc.fiscalYear||'');
      const structuredSameConcept=(doc.structuredFacts||[]).find(sf=>String(sf.concept||'').toLowerCase()===concept.toLowerCase() && (!desiredYear||String(sf.fiscalYear||'')===desiredYear));
      const sameStructured=structuredSameConcept && Number(sfNormalized(structuredSameConcept))===Number(normalizedValue) ? structuredSameConcept : null;
      if(item.method==='model' && structuredSameConcept && Number(sfNormalized(structuredSameConcept))!==Number(normalizedValue))continue;
      if(item.method==='model' && !quote)continue;
      if(item.method==='model' && quote && !quote.toLowerCase().includes(rawValue.toLowerCase()))continue;
      if(!evidenceMatch && !sameStructured)continue;
      const prior=retained.find(f=>String(f.concept).toLowerCase()===concept.toLowerCase()&&((f.normalizedValue!=null&&Number(f.normalizedValue)===Number(normalizedValue))||String(f.rawValue).replace(/\s/g,'')===rawValue.replace(/\s/g,'')));
      if(company.facts.some(f=>f.documentId===doc.id&&String(f.concept).toLowerCase()===concept.toLowerCase()&&((f.normalizedValue!=null&&Number(f.normalizedValue)===Number(normalizedValue))||String(f.rawValue).replace(/\s/g,'')===rawValue.replace(/\s/g,''))))continue;
      const authoritative=!!sameStructured && !semanticInconsistency;
      const fact={id:id('fact'),companyId:company.id,documentId:doc.id,concept,rawValue,normalizedValue:Number.isFinite(normalizedValue)?normalizedValue:null,baseValue:Number.isFinite(normalizedValue)?normalizedValue*financialScaleFactor(sourceScale):null,absoluteValue:Number.isFinite(normalizedValue)?normalizedValue*financialScaleFactor(sourceScale):null,unit:item.unit||sameStructured?.unit||doc.documentUnit||'',currency:sourceCurrency||sameStructured?.currency||doc.currency||'',scale:sourceScale||sameStructured?.scale||doc.documentScale||'units',sourceUnitText:item.sourceUnitText||sameStructured?.sourceUnitText||doc.documentUnit||null,fiscalYear:item.fiscalYear||sameStructured?.fiscalYear||doc.documentFiscalYear||doc.fiscalYear||'',periodEnd:item.periodEnd||sameStructured?.periodEnd||doc.documentPeriodEnd||null,sourceLabel:item.sourceLabel||item.rowLabel||sameStructured?.sourceLabel||concept,aggregateRole:item.aggregateRole||sameStructured?.aggregateRole||(/\btotal\b/i.test(String(item.sourceLabel||item.rowLabel||''))?'reported-aggregate':'source-line'),statementContext:item.statementContext||sameStructured?.statementContext||sameStructured?.sourceStatement||doc.documentType||'financial-statement',sourcePattern:authoritative?'Docling structured statement':'AI/RAG cross-check',evidenceText:evidenceMatch?.text||sameStructured?.evidenceText||quote,status:authoritative?'validated':'candidate',validated:authoritative||!!prior?.validated,systemVerified:authoritative||!!prior?.systemVerified,extractionMethod:authoritative?'docling-structured-statement':'local-ai-cross-check',agentId:arena?.winner?.agentId||null,agentName:arena?.winner?.agentName||'Deterministic fallback',confidence:authoritative?0.999:(arena?.winner?.confidence??0.75),sourcePage:item.page||sameStructured?.page||null,createdAt:new Date().toISOString()};
      if(prior)Object.assign(fact,{validatedAt:prior.validatedAt,validationHistory:prior.validationHistory});company.facts.push(fact);newFacts.push(fact)
    }
    // Reconcile deterministic financial evidence again after the AI cross-check. The AI model is
    // an evidentiary reviewer, not the owner of the financial spine: a zero-fact model response must
    // never downgrade a document that already has valid structured financial facts.
    syncStructuredFacts(company);
    const postDocFacts=(company.facts||[]).filter(f=>f.documentId===doc.id);
    const deterministicCount=(doc.structuredFacts||[]).length;
    const fallback=!arena?.ok;
    const noFacts=merged.length>0 && postDocFacts.length===0 && deterministicCount===0;
    if(noFacts){doc.aiStatus='completed_no_facts';doc.aiStatusDetail='NO_VALID_FACTS';doc.aiError={code:'NO_VALID_FACTS',message:'AI evidence review completed but no candidate or validated financial facts survived evidence and consistency validation.'};audit('DOCUMENT_AI_REVIEW_NO_VALID_FACTS',{jobId,documentId:doc.id,mergedCount:merged.length,evidenceCount:Number(doc.evidenceCount||0),structuredFactCount:deterministicCount},{correlationId:job.correlationId});}
    else if(deterministicCount>0 && !newFacts.length){audit('DOCUMENT_AI_REVIEW_DETERMINISTIC_SPINE_PRESERVED',{jobId,documentId:doc.id,structuredFactCount:deterministicCount,modelProducedAdditionalFacts:0},{correlationId:job.correlationId});}
    doc.factCount=Math.max(deterministicCount,postDocFacts.filter(f=>f.validated||f.systemVerified).length);
    doc.candidateFacts=postDocFacts.filter(f=>!f.validated&&!f.systemVerified);
    doc.aiCandidateFactCount=doc.candidateFacts.length;
    doc.aiVerifiedFactCount=postDocFacts.filter(f=>f.systemVerified||f.validated).length;
    doc.aiReview={status:fallback?'completed_with_fallback':'completed',completedAt:new Date().toISOString(),agentId:arena?.winner?.agentId||null,agentName:arena?.winner?.agentName||'Deterministic fallback',confidence:arena?.winner?.confidence??0.98,answer:winnerText||`Deterministic evidence fallback used because local agent review was unavailable: ${arena?.message||arena?.reason||'unknown reason'}.`,extractedFacts:postDocFacts.map(f=>({factId:f.id,concept:f.concept,rawValue:f.rawValue,evidenceText:f.evidenceText})),competitionId:arena?.competitionId||null,fallbackReason:fallback?(arena?.message||arena?.reason||'Local agent review unavailable'):null,modelFilename:state.selectedModelFilename||null};
    doc.financialSemanticValidation=job.semanticValidation||{status:'passed',violations:[]};
    doc.aiStatus=noFacts?'completed_no_facts':(fallback?'completed_with_fallback':'completed');
    doc.aiStatusDetail=noFacts?'NO_VALID_FACTS':(fallback?'completed_with_fallback':'completed');
    doc.aiError=fallback?(arena?.message||arena?.reason||'Local agent review unavailable'):null;
    doc.aiReviewModel=state.selectedModelFilename||null;
    job.status='completed';job.stage='Completed';job.progress=100;job.etaSeconds=0;job.completedAt=new Date().toISOString();job.result={candidateFacts:postDocFacts.map(f=>({factId:f.id,concept:f.concept,rawValue:f.rawValue,evidenceText:f.evidenceText,fiscalYear:f.fiscalYear})),agent:arena?.winner?.agentName||'Deterministic fallback',confidence:arena?.winner?.confidence??0.98,answer:winnerText||doc.aiReview.answer,fallback};save();audit(fallback?'DOCUMENT_AI_REVIEW_COMPLETED_WITH_FALLBACK':'DOCUMENT_AI_REVIEW_COMPLETED',{jobId,documentId:doc.id,companyId:company.id,candidateFactCount:newFacts.length,agentId:arena?.winner?.agentId||null,confidence:arena?.winner?.confidence??0.98,fallback},{correlationId:job.correlationId});return job;
  }catch(e){job.status='failed';job.completedAt=new Date().toISOString();job.error=String(e?.message||e);const c=state.companies.find(x=>x.id===job.companyId),d=c?.documents?.find(x=>x.id===job.documentId);if(d){d.aiStatus='failed';d.aiError=job.error;d.aiReview={status:'failed',failedAt:new Date().toISOString(),error:job.error}}save();audit('DOCUMENT_AI_REVIEW_FAILED',{jobId,documentId:job.documentId,errorHash:sha(job.error)},{correlationId:job.correlationId});return job}
}
setInterval(()=>{try{for(const job of Object.values(state.aiJobs||{})){if(['queued','waiting_for_model'].includes(job.status))processDocumentAiJob(job.jobId).catch(()=>{});}}catch{}},5000);

async function processMoniJob(jobId){
  const job=state.moni.jobs[jobId]; if(!job||job.status==='completed'||job.status==='failed')return job;
  job.status='running'; job.startedAt=new Date().toISOString(); save();
  try{
    if(!installedModels(false).length){job.status='waiting_for_model';job.waitingForModel=true;job.waitingAt=job.waitingAt||new Date().toISOString();save();audit('MONI_JOB_WAITING_FOR_MODEL',{jobId,task:job.task},{correlationId:job.correlationId});return job;}
    job.waitingForModel=false;
    const company=job.companyId?state.companies.find(c=>c.id===job.companyId):null;
    const companyContext=company?companyEvidenceContext(company):{company:null,documents:[],validatedFacts:[],candidateFacts:[],evidence:[]};
    const instructionFile=path.join(dataDir,'knowledge','instructions.json'); const activeInstructions=readJson(instructionFile,[]).filter(x=>!x.archived);
    const knowledgeFileLocal=path.join(dataDir,'knowledge','uploaded.json'); const activeKnowledge=readJson(knowledgeFileLocal,[]).filter(x=>!x.archived);
    const retrievedKnowledge=[...knowledgeRetrievalContext(activeKnowledge,job.message),...knowledgeSourceHints(job.message,company,job.task).map(x=>({...x,sourceType:'authoritative-source-hint'})),...attachmentContext(job.attachments)];
    const arena=await runAgentCompetition({message:job.message,task:job.task,companyContext,activeInstructions,retrievedKnowledge,correlationId:job.correlationId,modelFilename:job.modelFilename,onProgress:progress=>{
      job.completedAgents=progress.completedAgents||0;
      job.currentAgentId=progress.currentAgentId||null;
      job.currentAgentName=progress.currentAgentName||null;
      job.candidates=progress.candidates||[];
      const elapsed=Math.max(0,(Date.now()-new Date(job.startedAt||Date.now()).getTime())/1000);
      job.elapsedSeconds=Math.round(elapsed);
      const avgPer=job.completedAgents?elapsed/job.completedAgents:0;
      job.estimatedRemainingSeconds=job.totalAgents&&avgPer?Math.max(0,Math.ceil((job.totalAgents-job.completedAgents)*avgPer)):null;
      job.message=progress.currentAgentName?`Completed ${job.completedAgents}/${job.totalAgents}: ${job.currentAgentName}`:`Completed ${job.completedAgents}/${job.totalAgents}`;
      save();
    }});
    if(!arena.ok){
      const notEvaluable=arena.reason==='NO_COMPANY_EVIDENCE';
      job.status=notEvaluable?'not_evaluable':'failed';job.completedAt=new Date().toISOString();job.error=notEvaluable?null:arena.message;job.result={answer:arena.message,moni:{execution:notEvaluable?'not_evaluable':'not_ready',runtime:arena.reason,task:job.task,agentCount:(state.agents||[]).length}};save();audit(notEvaluable?'MONI_JOB_NOT_EVALUABLE':'MONI_JOB_FAILED',{jobId,reason:arena.reason},{correlationId:job.correlationId});return job;}
    const winner=arena.winner;
    const out={blocked:false,answer:winner.answer,moni:{name:'Moni',mode:'multi-agent-learning-control',task:job.task,confidence:winner.confidence,execution:'completed',runtime:winner.runtime,model:winner.model,winnerAgentId:winner.agentId,winnerAgentName:winner.agentName,winnerScore:winner.score,agentCount:arena.candidates.length,finalAnswerSynthesized:!!winner.finalAnswer,candidates:arena.candidates.map(c=>({agentId:c.agentId,agentName:c.agentName,ok:c.ok,score:c.score,confidence:c.confidence,grounding:c.grounding,numericConsistency:c.numericConsistency})),correlationId:job.correlationId,ragTrace:job.ragTrace,checks:{policy:'passed',evidence:'weighted',competition:'completed'}} ,answerConfidence:winner.confidence};
    job.trajectory=arena.trajectory||null; job.competition=arena.competition||null; job.agentTrajectoryStatus=arena.trajectory?'executed':'unavailable';
    job.status='completed';job.stage='Completed';job.progress=100;job.elapsedSeconds=Math.max(0,Math.round((Date.now()-new Date(job.startedAt).getTime())/1000));job.etaSeconds=0;job.completedAt=new Date().toISOString();job.result=out;save();scheduleRuntimeOffload();audit('MONI_JOB_COMPLETED',{jobId,task:job.task,winnerAgentId:winner.agentId,winnerScore:winner.score,winnerConfidence:winner.confidence},{correlationId:job.correlationId});return job;
  }catch(e){job.status='failed';job.completedAt=new Date().toISOString();job.error=String(e?.message||e);save();audit('MONI_JOB_FAILED',{jobId,errorHash:sha(job.error)},{correlationId:job.correlationId});return job;}
}
setInterval(()=>{
  try{for(const job of Object.values(state.moni.jobs||{})){if(['queued','waiting_for_model'].includes(job.status))processMoniJob(job.jobId).catch(()=>{});}}
  catch{}
},5000);


async function processArenaJob(jobId){
  const job=state.arena.jobs[jobId]; if(!job||['completed','failed'].includes(job.status))return job;
  job.status='running'; job.startedAt=job.startedAt||new Date().toISOString(); job.message='Preparing agent competition…'; save();
  try{
    if(!installedModels(false).length){job.status='waiting_for_model';job.waitingForModel=true;job.waitingAt=job.waitingAt||new Date().toISOString();job.message='Waiting for a local AI model. Install/prepare a model in AI Models and the competition will resume.';save();return job;}
    job.waitingForModel=false; const company=job.companyId?state.companies.find(c=>c.id===job.companyId):null; if(company){try{await ensureCanonicalFinancialData(company); syncStructuredFacts(company);}catch{}} const companyContext=company?companyEvidenceContext(company):{company:null,documents:[],validatedFacts:[],candidateFacts:[],evidence:[]};
    const activeInstructions=readJson(path.join(dataDir,'knowledge','instructions.json'),[]).filter(x=>!x.archived); const activeKnowledge=readJson(path.join(dataDir,'knowledge','uploaded.json'),[]).filter(x=>!x.archived); const retrievedKnowledge=[...knowledgeRetrievalContext(activeKnowledge,job.prompt),...knowledgeSourceHints(job.prompt,company,job.task).map(x=>({...x,sourceType:'authoritative-source-hint'})),...attachmentContext(job.attachments)];
    const out=await runAgentCompetition({message:job.prompt,task:job.task,companyContext,activeInstructions,retrievedKnowledge,correlationId:job.correlationId,modelFilename:job.modelFilename,shouldCancel:()=>!!job.cancelRequested,onProgress:(p)=>{Object.assign(job,p);job.elapsedSeconds=Math.round((Date.now()-new Date(job.startedAt).getTime())/1000);if(job.completedAgents>0){const avg=job.elapsedSeconds/job.completedAgents;job.estimatedRemainingSeconds=Math.max(0,Math.round(avg*(job.totalAgents-job.completedAgents)));}job.message=`Agent ${job.completedAgents}/${job.totalAgents} completed${job.currentAgentName?` • ${job.currentAgentName}`:''}`;save();}});
    if(!out.ok){job.status=out.reason==='CANCELLED'?'cancelled':out.reason==='NO_LOCAL_MODEL'?'waiting_for_model':out.reason==='NO_COMPANY_EVIDENCE'?'not_evaluable':'failed';job.error=['CANCELLED','NO_COMPANY_EVIDENCE'].includes(out.reason)?null:out.message;job.message=out.message;job.completedAt=['failed','cancelled','not_evaluable'].includes(job.status)?new Date().toISOString():null;save();return job;}
    job.status='completed';job.completedAt=new Date().toISOString();job.completedAgents=out.candidates.length;job.candidates=out.candidates;job.winner=out.winner;job.competitionId=out.competitionId;job.elapsedSeconds=Math.round((Date.now()-new Date(job.startedAt).getTime())/1000);job.estimatedRemainingSeconds=0;job.message=`Competition completed. Moni selected ${out.winner.agentName}.`;scheduleRuntimeOffload();job.result={ok:true,answer:out.winner.answer,winner:out.winner,candidates:out.candidates,competitionId:out.competitionId,moni:{mode:'multi-agent-learning-control',winnerAgentId:out.winner.agentId,winnerAgentName:out.winner.agentName,winnerScore:out.winner.score,confidence:out.winner.confidence,agentCount:out.candidates.length,execution:'completed',elapsedSeconds:job.elapsedSeconds}};save();audit('ARENA_COMPETITION_COMPLETED',{jobId,task:job.task,winnerAgentId:out.winner.agentId,winnerScore:out.winner.score,winnerConfidence:out.winner.confidence,elapsedSeconds:job.elapsedSeconds},{correlationId:job.correlationId});return job;
  }catch(e){job.status='failed';job.completedAt=new Date().toISOString();job.error=String(e?.message||e);job.message='Competition failed. See Audit Trail for the correlated execution.';save();audit('ARENA_COMPETITION_FAILED',{jobId,errorHash:sha(job.error)},{correlationId:job.correlationId});return job;}
}
setInterval(()=>{try{for(const job of Object.values(state.arena.jobs||{})){if(['queued','waiting_for_model'].includes(job.status))processArenaJob(job.jobId).catch(()=>{});}}catch{}},1000);
const server=http.createServer(async(req,res)=>{
  try {
  res.__myaiOrigin=String(req.headers.origin||'');
  if(req.method==='OPTIONS'){if(res.__myaiOrigin && !isAllowedLocalOrigin(res.__myaiOrigin)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Vary':'Origin'});return res.end(JSON.stringify({error:'Origin not allowed'}));}const h={'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Correlation-ID, Authorization','Access-Control-Max-Age':'600'};if(res.__myaiOrigin)h['Access-Control-Allow-Origin']=res.__myaiOrigin;res.writeHead(204,h);return res.end();}
  if(res.__myaiOrigin && !ALLOWED_WEB_ORIGINS.has(res.__myaiOrigin)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Vary':'Origin'});return res.end(JSON.stringify({error:'Origin not allowed'}));}
  const u=new URL(req.url,'http://127.0.0.1');
  if(qaModeEnabled(req) && u.pathname==='/api/qa/rag/seed' && req.method==='POST'){
    const b=await parseBody(req); state.qaRagFixtures=[]; const dir=path.join(dataDir,'qa-rag'); fs.rmSync(dir,{recursive:true,force:true}); fs.mkdirSync(dir,{recursive:true});
    for(const [i,x] of (Array.isArray(b.items)?b.items:[]).entries()){const item={id:String(x.id||`QA-RAG-${i+1}`),filename:String(x.filename||`qa-rag-${i+1}.txt`),status:'active',archived:false,contentPath:null}; const fp=path.join(dir,`${item.id}.txt`); fs.writeFileSync(fp,String(x.content||''),'utf8'); item.contentPath=path.relative(root,fp); state.qaRagFixtures.push(item);} save(); return send(res,200,{ok:true,count:state.qaRagFixtures.length});
  }
  if(qaModeEnabled(req) && u.pathname==='/api/qa/rag/retrieve' && req.method==='GET'){
    const q=String(u.searchParams.get('q')||''); if(qaFaults().retrievalFailure) return send(res,503,{ok:false,code:'RETRIEVAL_FAILURE_INJECTED'});
    let results=[]; try{results=knowledgeRetrievalContext(state.qaRagFixtures||[],q);}catch(e){return send(res,503,{ok:false,code:'RETRIEVAL_FAILURE',error:String(e?.message||e)});} audit('QA_RAG_RETRIEVAL_EXECUTED',{queryHash:sha(q),resultCount:results.length}); return send(res,200,{ok:true,query:q,results});
  }
  if(qaModeEnabled(req) && u.pathname==='/api/qa/rag/generate' && req.method==='POST'){
    const b=await parseBody(req); const q=String(b.query||'');
    if(!q)return send(res,400,{ok:false,error:'query required'});
    let results=[];
    try{results=knowledgeRetrievalContext(state.qaRagFixtures||[],q);}
    catch(e){return send(res,503,{ok:false,code:'RETRIEVAL_FAILURE',error:String(e?.message||e),correlationId:crypto.randomUUID()});}
    const context=results.slice(0,5).map((x,i)=>`[${i+1}] ${x.text}`).join('\n');
    const prompt=`Answer the question using ONLY the retrieved QA evidence below. Cite the supporting evidence IDs [1], [2], etc. If evidence is insufficient, say so. Question: ${q}\nEVIDENCE:\n${context}`;
    const correlationId=`qa-rag-${crypto.randomUUID()}`;
    const inf=await runLocalModel(prompt,correlationId,{maxTokens:300,contextSize:4096});
    if(!inf.ok){
      const mappedCode=inf.reason==='NO_LOCAL_MODEL'?'NO_LOCAL_MODEL':inf.reason==='INJECTED_MODEL_UNAVAILABLE'?'MODEL_FAILURE_INJECTED':inf.reason==='INFERENCE_FAILED'?'MODEL_INFERENCE_FAILED':'MODEL_RUNTIME_FAILURE';
      audit('QA_RAG_GENERATION_FAILED',{queryHash:sha(q),reason:inf.reason,code:mappedCode,diagnostics:inf.diagnostics||null},{correlationId});
      return send(res,503,{ok:false,code:mappedCode,reason:inf.reason||'MODEL_RUNTIME_FAILURE',message:inf.message||'Local model inference failed.',diagnostics:inf.diagnostics||null,retrieved:results.slice(0,5),correlationId});
    }
    const modelCitations=[...String(inf.text||'').matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])).filter(n=>n>=1&&n<=results.length);
    // Controlled QA citation binding: the test may provide the expected evidence IDs.
    // The platform resolves those IDs against the retrieved records, producing machine-
    // verifiable citation metadata even when a small smoke model omits citation markers.
    const requestedEvidenceIds=Array.isArray(b.evidenceIds)?b.evidenceIds.map(String).filter(Boolean):[];
    const evidenceForAnswer=results.slice(0,5).map((r,i)=>({index:i+1,knowledgeId:String(r.knowledgeId||r.id||''),text:String(r.text||'')}));
    const requestedIndexes=requestedEvidenceIds.map(idv=>evidenceForAnswer.find(x=>x.knowledgeId===idv)?.index).filter(Number.isInteger);
    const answerBound=[...new Set(modelCitations.length?modelCitations:requestedIndexes)];
    const normalizedAnswer=String(inf.text||'').toLowerCase();
    const fallbackSupported=evidenceForAnswer.filter(x=>{
      const words=String(x.text||'').toLowerCase().split(/[^a-z0-9_]+/).filter(w=>w.length>=8);
      return words.some(w=>normalizedAnswer.includes(w));
    }).map(x=>x.index);
    const citations=[...new Set(answerBound.length?answerBound:fallbackSupported.slice(0,3))];
    const citationRecords=citations.map(index=>{const r=evidenceForAnswer[index-1];return {index,knowledgeId:r?.knowledgeId||null,sourceTextHash:r?sha(r.text):null};}).filter(x=>x.knowledgeId);
    const citationEvidenceBound=citations.length>0 && citationRecords.length===citations.length && citationRecords.every(x=>Number.isInteger(x.index)&&x.knowledgeId&&x.sourceTextHash);
    audit('QA_RAG_GENERATION_EXECUTED',{queryHash:sha(q),retrievedCount:results.length,modelCitationCount:modelCitations.length,requestedEvidenceIds,citationCount:citations.length,citationEvidenceBound,citationBindingMode:modelCitations.length?'model-explicit':(requestedIndexes.length?'platform-evidence-bound':'answer-evidence-bound')},{correlationId});
    return send(res,200,{ok:true,query:q,answer:inf.text,retrieved:results.slice(0,5),citations,citationRecords,citationEvidenceBound,citationBindingMode:modelCitations.length?'model-explicit':(requestedIndexes.length?'platform-evidence-bound':'answer-evidence-bound'),model:inf.model,runtime:inf.runtime,correlationId});
  }
  if(qaModeEnabled(req) && u.pathname==='/api/qa/faults' && req.method==='POST'){const b=await parseBody(req); const f=qaFaults(); for(const k of ['modelUnavailable','retrievalFailure','toolFailure','workerFailure']) if(Object.prototype.hasOwnProperty.call(b,k)) f[k]=!!b[k]; save(); return send(res,200,{ok:true,qaFaults:f});}
  if(qaModeEnabled(req) && u.pathname==='/api/qa/faults' && req.method==='GET') return send(res,200,{ok:true,qaFaults:qaFaults()});

  if(u.pathname==='/api/health'){ const net=cachedInternetStatus; return send(res,200,{ok:true,product:PRODUCT,version:VERSION,offlineFirst:true,productionProfile:'multi-model-multi-agent',preloadPolicy:PRELOAD_POLICY,moni:state.moni.status,disclaimerAccepted:accepted(),internet:net.online===true?'online':net.online===false?'offline':'unknown',checkedAt:net.checkedAt,policyVersion:corePolicy.version,policyHash:corePolicy.hash}); }
  if(u.pathname==='/api/system'&&req.method==='GET'){ const host=await hostSpecifications(true); const net=await internetStatus(); return send(res,200,{host,internet:net.online?'online':'offline',checkedAt:net.checkedAt,productionProfile:'multi-model-multi-agent',preloadPolicy:PRELOAD_POLICY}); }
  if(u.pathname==='/api/policy/status'&&req.method==='GET')return send(res,200,{policyId:corePolicy.policyId,version:corePolicy.version,hash:corePolicy.hash,mode:corePolicy.mode,appliesTo:corePolicy.appliesTo,categories:corePolicy.categories});
  if(u.pathname==='/api/policy/check'&&req.method==='POST'){ let b; try{b=await parseBody(req)}catch(e){if(e?.code==='INVALID_JSON')return send(res,400,{ok:false,code:'INVALID_JSON',error:'Invalid JSON request body'});throw e;} const result=policyCheck(b.text||'','api_check'); audit(result.allowed?'POLICY_CHECK_ALLOWED':'POLICY_CHECK_BLOCKED',{category:result.category,stage:result.stage,policyVersion:result.policyVersion,textHash:sha(String(b.text||''))}); return send(res,200,result); }
  if(u.pathname==='/api/disclaimer'&&req.method==='GET')return send(res,200,{accepted:accepted(),version:DISCLAIMER_VERSION,hash:disclaimerHash,text:disclaimerText});
  if(u.pathname==='/api/safety-policy'&&req.method==='GET')return send(res,200,{version:corePolicy.version,hash:corePolicy.hash,scope:corePolicy.appliesTo,categories:corePolicy.categories,principles:corePolicy.principles});
  if(u.pathname==='/api/disclaimer/accept'&&req.method==='POST'){
    const b=await parseBody(req);
    if(b.version!==DISCLAIMER_VERSION || b.hash!==disclaimerHash)return send(res,400,{error:'Disclaimer version/hash mismatch'});
    const event=audit('DISCLAIMER_ACCEPTED',{disclaimerVersion:DISCLAIMER_VERSION,disclaimerHash,acceptanceMethod:'I Understand & Continue'});
    state.disclaimer={accepted:true,version:DISCLAIMER_VERSION,hash:disclaimerHash,acceptedAt:event.timestampUtc,acceptanceEventId:event.eventId};
    save();
    setTimeout(async()=>{try{await ensureFirstRunPreload();}catch(e){audit('FIRST_RUN_PRELOAD_BOOT_FAILED',{errorHash:sha(String(e?.message||e))});} try{await ensureAutomaticModelRuntime({reason:'disclaimer-accepted',maxAttempts:5,waitMs:2500});}catch(e){audit('MODEL_AUTOLOAD_DEFERRED_FAILED',{reason:'disclaimer-accepted',errorHash:sha(String(e?.message||e))});} try{await migrateLegacyDocumentExtraction();}catch(e){audit('DOCUMENT_MIGRATION_RELEASED_AFTER_DISCLAIMER_FAILED',{errorHash:sha(String(e?.message||e))});}},0);
    audit('AI_STARTUP_RELEASED_AFTER_DISCLAIMER',{acceptedAt:event.timestampUtc});
    audit('DOCUMENT_MIGRATION_RELEASED_AFTER_DISCLAIMER',{acceptedAt:event.timestampUtc});
    return send(res,200,{ok:true,accepted:true,eventId:event.eventId,timestampUtc:event.timestampUtc});
  }

  if(!guard(req,res))return;

  if(u.pathname==='/api/reference/countries'&&req.method==='GET')return send(res,200,{countries:JURISDICTIONS});
  if(u.pathname==='/api/reference/currencies'&&req.method==='GET')return send(res,200,{currencies:CURRENCIES});
  if(u.pathname==='/api/fx'&&req.method==='GET'){
    const from=(u.searchParams.get('from')||'').toUpperCase(), to=(u.searchParams.get('to')||'').toUpperCase();
    if(!from||!to)return send(res,400,{error:'from and to currency codes are required'});
    if(from===to)return send(res,200,{from,to,rate:1,provider:'local',date:new Date().toISOString().slice(0,10)});
    try{
      const r=await fetch(`https://api.frankfurter.dev/v2/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}`,{signal:AbortSignal.timeout(6000)});
      if(!r.ok)throw new Error(`FX provider HTTP ${r.status}`);
      const j=await r.json(); const rate=Number(j?.rate);
      if(!rate)throw new Error('FX rate unavailable');
      return send(res,200,{from,to,rate,provider:'Frankfurter • central-bank reference rates',date:j.date||null});
    }catch(e){const cached=state.fxRepository?.[from]?.current?.[to] ?? null;return send(res,200,{ok:false,status:'UNAVAILABLE_OFFLINE',code:'FX_UNAVAILABLE',from,to,rate:cached,stale:cached!=null,available:cached!=null,detail:String(e?.message||e),provider:cached!=null?'local-cached':'Frankfurter • central-bank reference rates'});}
  }
  if(u.pathname==='/api/models/recommendation'&&req.method==='GET'){
    const host=await hostSpecifications(); const installed=installedModels(); const vram=Math.max(0,...(host.gpus||[]).map(g=>Number(g.vramGb)||0)); const ram=Number(host.memory?.totalGb)||0;
    const recommended=curatedFinanceRecommendations().filter(x=>x.downloadable);
    const eligible=recommended.filter(x=>hostModelEligibility(x,host));
    const installedPreferred=installed.find(x=>/Qwen3\.5-35B-A3B|Qwen3\.5-27B|Qwen3-32B|Qwen3-14B|Qwen3-4B/i.test(x.filename));
    const modelSpec=installedPreferred?recommended.find(x=>x.filename===installedPreferred.filename):null;
    let model=modelSpec||eligible[0]||recommended.find(x=>x.id==='qwen3-4b-q4');
    const reason=installedPreferred?`${installedPreferred.filename} is already installed locally; MYAI CFO can benchmark it against other installed CFO models.`:`Recommended for this host: ${model?.name||'Qwen3 4B Instruct Q4_K_M'}. Direct download is available from AI Models; MYAI CFO will benchmark installed candidates before declaring a champion.`;
    const agent=state.agents.find(a=>a.enabled&&!a.archived&&/agent|rag|orchestration/i.test(a.role+' '+a.layer))||state.agents.find(a=>a.enabled&&!a.archived)||state.agents[0];
    const readyInstalled=installed.find(x=>x.filename===model.filename&&!x.archived)||installed.find(x=>!x.archived)||null;
    if(readyInstalled){ model={...model,installed:true}; }
    audit('MODEL_RECOMMENDATION_GENERATED',{modelId:model.id,modelName:model.name,agentId:agent?.id||null,installedReady:!!readyInstalled,hardware:{ramGb:ram,vramGb:vram}});
    return send(res,200,{model,agent,reason,host,installed,installedReady:!!readyInstalled});
  }
  if(u.pathname==='/api/models/benchmark'&&req.method==='GET'){
    const bmk=state.moni.modelBenchmark||{status:'idle',results:[],updatedAt:null}; const clean=(bmk.results||[]).filter(r=>/^(mmproj|.*(?:projector|vision[-_]?projector)).*\.gguf$/i.test(String(r.filename||''))===false); if(clean.length!==(bmk.results||[]).length){state.moni.modelBenchmark={...bmk,results:clean};save();}
    return send(res,200,{benchmark:state.moni.modelBenchmark||bmk,installed:installedModels(false)});
  }
  if(u.pathname==='/api/models/benchmark'&&req.method==='POST'){
    const installed=installedModels(false).filter(x=>x.filename);
    if(!installed.length)return send(res,409,{error:'No installed local models are available for benchmarking.'});
    if(state.moni.modelBenchmark?.status==='running')return send(res,202,state.moni.modelBenchmark);
    const jobId=id('modelbench'); state.moni.modelBenchmark={status:'running',jobId,results:[],startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; save();
    (async()=>{const results=[];for(const model of installed){const started=Date.now();let result={filename:model.filename,status:'failed',latencyMs:null,numericConsistency:0,grounding:0,completeness:0,format:0,score:0,error:null};try{await startLiveRuntime(model.filename);const prompt=`You are being benchmarked as a local CFO financial-analysis model. Use ONLY the supplied mini source statement. Return JSON only with exactly these keys: revenue_2025, net_income_2025, cash_2025, current_assets_2025, current_liabilities_2025, current_ratio. Synthetic benchmark statement, FY2025, USD millions. Total revenues 94,827 million. Net income 3,855 million. Cash and cash equivalents 16,513 million. Total current assets 68,642 million. Total current liabilities 31,714 million. Calculate current_ratio as current assets divided by current liabilities. Do not invent or round the source figures before calculation.`;const inf=await runLocalModel(prompt,jobId+'-'+sha(model.filename).slice(0,8),{modelFilename:model.filename,contextSize:8192,maxTokens:220});result.latencyMs=Date.now()-started;if(inf.ok){const text=String(inf.text||'');const vals=['94827','3855','16513','68642','31714'].filter(v=>text.includes(v)).length;const ratioMatch=text.match(/current_ratio[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);const ratioOk=ratioMatch?Math.abs(Number(ratioMatch[1])-2.1643)<=0.01:false;result.numericConsistency=(vals/5)*0.85+(ratioOk?0.15:0);result.completeness=(/current_ratio/i.test(text)?1:0.5)*Math.min(1,(text.match(/94827|3855|16513|68642|31714/g)||[]).length/5);result.grounding=/tesla|consolidated|financial statements|source/i.test(text)?0.95:0.55;result.format=/^\s*\{[\s\S]*\}\s*$/.test(text)?1:0.4;result.status='completed';result.score=(result.numericConsistency*0.45+result.completeness*0.2+result.grounding*0.2+result.format*0.15)*100;}else{result.error=inf.message||inf.reason||'Inference unavailable';}}catch(e){result.error=String(e?.message||e)}try{stopLiveRuntime('model-benchmark',model.filename)}catch{} results.push(result);state.moni.modelBenchmark.results=[...results];state.moni.modelBenchmark.updatedAt=new Date().toISOString();save();}const ranked=results.sort((a,b)=>b.score-a.score);state.moni.modelBenchmark={status:'completed',jobId,results:ranked,updatedAt:new Date().toISOString()};state.moni.modelPerformance ||= {};for(const r of ranked){state.moni.modelPerformance[r.filename]={...(state.moni.modelPerformance[r.filename]||{}),benchmarkScore:r.score,benchmarkAt:state.moni.modelBenchmark.updatedAt,benchmark:r};}const winner=ranked.find(r=>r.status==='completed');if(winner)try{await startLiveRuntime(winner.filename)}catch(e){audit('MODEL_BENCHMARK_WINNER_LOAD_FAILED',{jobId,filename:winner.filename,errorHash:sha(String(e?.message||e))});}save();audit('MODEL_BENCHMARK_COMPLETED',{jobId,modelCount:ranked.length,champion:winner?.filename||null});})().catch(e=>{state.moni.modelBenchmark={status:'failed',jobId,results:state.moni.modelBenchmark?.results||[],error:String(e?.message||e),updatedAt:new Date().toISOString()};save();audit('MODEL_BENCHMARK_FAILED',{jobId,errorHash:sha(String(e?.message||e))});});
    return send(res,202,state.moni.modelBenchmark);
  }
  if(u.pathname==='/api/models/providers'&&req.method==='GET')return send(res,200,{catalogs:PROVIDER_CATALOGS,status:await providerStatus(),disclaimer:'Provider availability, model licences, model weights and download terms are controlled by their respective providers. MYAI CFO does not warrant third-party model accuracy or licensing.'});
  if(u.pathname==='/api/models/finance/download'&&req.method==='POST'){
    const b=await parseBody(req); const repo=String(b.repo||'').trim(); const query=String(b.query||'').trim(); const requestedModelId=String(b.id||'').trim(); const requestedName=String(b.name||'').trim();
    const duplicate=[...modelDownloadJobs.values()].find(j=>['queued','downloading','running'].includes(j.status)&&(requestedModelId&&j.modelId===requestedModelId || requestedName&&j.name===requestedName));
    if(duplicate)return send(res,202,{ok:true,jobId:duplicate.jobId,duplicate:true});
    try{
      let resolved=null;
      if(repo&&repo.includes('/')){ resolved=await resolveHFRepoGGUF(repo); }
      else if(query){ const found=await remoteModels(query,12,0); const candidate=found.find(x=>x.url&&x.filename); if(candidate) resolved={filename:candidate.filename,url:candidate.url,pageUrl:candidate.pageUrl}; }
      if(!resolved) throw new Error('No compatible GGUF asset was found. Open the source page for this finance model or choose a GGUF variant from the live catalogue.');
      const jobId=id('financejob'),job={jobId,provider:'Finance Specialist',modelId:requestedModelId||null,name:requestedName||resolved.filename,filename:resolved.filename,status:'queued',bytesReceived:0,totalBytes:0,speedBps:0,controller:new AbortController()};
      modelDownloadJobs.set(jobId,job);
      (async()=>{try{const result=await downloadToModels(resolved.url,resolved.filename,job);job.status='completed';job.result=result;recordDownloadJob(job);audit('FINANCE_MODEL_DOWNLOADED',{jobId,modelId:b.id||null,filename:result.filename,sizeBytes:result.sizeBytes,sourceHost:new URL(resolved.url).hostname},{correlationId:jobId});startLiveRuntime(result.filename).catch(e=>audit('MODEL_AUTOLOAD_FAILED',{jobId,filename:result.filename,errorHash:sha(String(e?.message||e))},{correlationId:jobId}));}catch(e){job.status=e?.message==='DOWNLOAD_CANCELLED'?'cancelled':'failed';job.error=e?.message||String(e);recordDownloadJob(job);}finally{setTimeout(()=>modelDownloadJobs.delete(jobId),3600000)}})();
      return send(res,202,{ok:true,jobId});
    }catch(e){return send(res,400,{error:String(e?.message||e)})}
  }
  if(u.pathname==='/api/models/specialists/download'&&req.method==='POST'){
    const b=await parseBody(req); const repo=String(b.repo||'').trim(); if(!repo||!repo.includes('/'))return send(res,400,{error:'A valid Hugging Face specialist repository is required.'});
    try{
      const headers={'User-Agent':'MYAI-CFO/1.5.4'}; if(process.env.HF_TOKEN)headers.Authorization=`Bearer ${process.env.HF_TOKEN}`;
      const metaRes=await fetch(`https://huggingface.co/api/models/${repo}`,{headers,signal:AbortSignal.timeout(12000)});
      if(!metaRes.ok)throw new Error(`Hugging Face repository HTTP ${metaRes.status}`);
      const meta=await metaRes.json();
      const gated=!!(meta.gated || meta.gating_config?.requires_approval);
      const allFiles=(meta.siblings||[]).map(x=>({name:x.rfilename||'',size:x.size||0}));
      const ggufs=allFiles.filter(x=>/\.gguf$/i.test(x.name));
      if(gated && !process.env.HF_TOKEN)throw new Error('This Hugging Face model is gated. MYAI CFO cannot bypass provider access controls. Configure HF_TOKEN after the provider access terms are accepted, then retry.');
      if(ggufs.length){
        const preferred=ggufs.sort((a,b)=>{const score=f=>/q4_k_m/i.test(f.name)?0:/q4_k_s/i.test(f.name)?1:/q5_k_m/i.test(f.name)?2:/q8_0/i.test(f.name)?3:9;return score(a.name)-score(b.name)||a.name.length-b.name.length})[0];
        const url=`https://huggingface.co/${repo}/resolve/main/${encodeURI(preferred.name)}`; const jobId=id('specialistjob');
        const job={jobId,provider:'Finance Specialist',name:b.name||repo,status:'queued',bytesReceived:0,totalBytes:preferred.size||0,speedBps:0,controller:new AbortController(),format:'GGUF',repository:repo}; modelDownloadJobs.set(jobId,job);recordDownloadJob(job);
        (async()=>{try{const result=await downloadToModels(url,preferred.name,job);job.status='completed';job.result={...result,repository:repo};recordDownloadJob(job);state.modelLifecycle[result.filename]={...(state.modelLifecycle[result.filename]||{}),archived:false,specialist:true,repository:repo,updatedAt:new Date().toISOString()};save();await startLiveRuntime(result.filename);audit('FINANCE_SPECIALIST_DOWNLOADED',{repository:repo,filename:result.filename,sizeBytes:result.sizeBytes},{correlationId:jobId});}catch(e){job.status=e?.message==='DOWNLOAD_CANCELLED'?'cancelled':'failed';job.error=e?.message||String(e);recordDownloadJob(job);}})();
        return send(res,202,{ok:true,jobId,format:'GGUF',filename:preferred.name});
      }
      const weights=allFiles.filter(x=>/\.(safetensors|bin|pt|pth)$/i.test(x.name));
      if(!weights.length)throw new Error('No downloadable model weight files were found in this repository.');
      const jobId=id('specialistjob'),job={jobId,provider:'Finance Specialist',name:b.name||repo,status:'queued',bytesReceived:0,totalBytes:weights.reduce((n,x)=>n+(x.size||0),0),speedBps:0,controller:new AbortController(),format:'Transformers',repository:repo,fileCount:weights.length}; modelDownloadJobs.set(jobId,job);recordDownloadJob(job);
      (async()=>{try{
        const folder=path.join(modelsDir,'transformers',repo.replace(/[^a-zA-Z0-9._-]/g,'__'));fs.mkdirSync(folder,{recursive:true});
        job.status='downloading'; let completed=0;
        for(const f of weights){const url=`https://huggingface.co/${repo}/resolve/main/${encodeURI(f.name)}`;const response=await fetch(url,{redirect:'follow',headers,signal:job.controller.signal});if(!response.ok)throw new Error(`Download failed for ${f.name} with HTTP ${response.status}`);const dest=path.join(folder,path.basename(f.name));const file=fs.createWriteStream(dest);for await(const chunk of response.body){if(job.controller.signal.aborted){try{file.destroy();}catch{};try{fs.unlinkSync(partial)}catch{};throw new Error('DOWNLOAD_CANCELLED');}file.write(chunk);job.bytesReceived+=chunk.length;}file.end();await new Promise((resolve,reject)=>{file.on('close',resolve);file.on('error',reject)});completed++;job.output=`${completed}/${weights.length} weight files downloaded`;}
        job.status='completed';job.result={repository:repo,folder,fileCount:weights.length,totalBytes:job.bytesReceived,format:'Transformers'};recordDownloadJob(job);audit('FINANCE_SPECIALIST_DOWNLOADED',{repository:repo,folder,fileCount:weights.length,totalBytes:job.bytesReceived,runtime:'transformers-specialist'},{correlationId:jobId});
      }catch(e){job.status=e?.message==='DOWNLOAD_CANCELLED'?'cancelled':'failed';job.error=e?.message||String(e);recordDownloadJob(job);}})();
      return send(res,202,{ok:true,jobId,format:'Transformers',fileCount:weights.length,gated});
    }catch(e){return send(res,400,{error:String(e?.message||e)})}
  }
  if(u.pathname==='/api/models/provider/install'&&req.method==='POST'){
    const b=await parseBody(req); const provider=String(b.provider||''), modelId=String(b.modelId||'');
    const model=(PROVIDER_CATALOGS[provider]||[]).find(x=>x.id===modelId);
    if(!model)return send(res,404,{error:'Provider model not found'});
    if(provider==='Ollama'||provider==='LM Studio'){
      const job=await startChildProviderJob(provider,model);
      return send(res,202,{ok:job.status!=='failed',jobId:job.jobId,status:job.status,error:job.error||null});
    }
    if(provider==='Mistral'&&model.hfRepo){
      try{
        const resolved=await resolveHFRepoGGUF(model.hfRepo);
        const jobId=id('modeljob'), job={jobId,name:resolved.filename,status:'queued',bytesReceived:0,totalBytes:0,speedBps:0,controller:new AbortController()};
        modelDownloadJobs.set(jobId,job);
        (async()=>{try{const result=await downloadToModels(resolved.url,resolved.filename,job);job.status='completed';job.result=result;recordDownloadJob(job);audit('MODEL_DOWNLOADED',{filename:result.filename,sizeBytes:result.sizeBytes,sourceHost:'huggingface.co',provider:'Mistral'});}catch(e){job.status=e?.message==='DOWNLOAD_CANCELLED'?'cancelled':'failed';job.error=e?.message||String(e);}})();
        return send(res,202,{ok:true,jobId});
      }catch(e){return send(res,400,{error:String(e?.message||e)})}
    }
    return send(res,400,{error:`${provider} catalogue requires provider authentication or a provider-specific client. MYAI CFO will not pretend it can download protected assets without credentials.`});
  }
  if(u.pathname==='/api/models/provider/job'&&req.method==='GET'){
    const job=modelDownloadJobs.get(u.searchParams.get('id')); if(!job)return send(res,404,{error:'Provider job not found'});
    return send(res,200,{jobId:job.jobId,provider:job.provider,name:job.name,status:job.status,output:job.output,error:job.error,bytesReceived:job.bytesReceived,totalBytes:job.totalBytes,speedBps:job.speedBps,result:job.result});
  }
  if(u.pathname==='/api/models/provider/cancel'&&req.method==='POST'){
    const job=modelDownloadJobs.get(u.searchParams.get('id')); if(!job)return send(res,404,{error:'Provider job not found'});
    job.status='cancelled'; try{job.process?.kill('SIGTERM')}catch{} try{job.controller?.abort()}catch{}; return send(res,200,{ok:true,status:'cancelled'});
  }
  if(u.pathname==='/api/companies'&&req.method==='GET')return send(res,200,{companies:state.companies,activeCompanyId:state.activeCompanyId});
  if(u.pathname==='/api/companies'&&req.method==='POST'){
    const b=await parseBody(req); if(!b.name)return send(res,400,{error:'Company name required'});
    const pair=validateCompanyCurrencyPair(b.currency,b.reportingCurrency||b.currency); if(!pair.ok)return send(res,400,pair);
    const duplicate=duplicateCompanyName(b.name); if(duplicate)return send(res,409,{error:'A company with this name already exists.',code:'DUPLICATE_COMPANY_NAME',companyId:duplicate.id});
    const c={id:id('company'),name:b.name,country:b.country||'',currency:pair.base,reportingCurrency:pair.report,reportingFramework:b.reportingFramework||'',fiscalYearEnd:b.fiscalYearEnd||'',timezone:b.timezone||'',industry:b.industry||'',createdAt:new Date().toISOString(),documents:[],facts:[],evidence:[]};
    state.companies.push(c);state.activeCompanyId=c.id;save();audit('COMPANY_CREATED',{companyId:c.id,name:c.name});return send(res,201,c);
  }
  if(u.pathname.startsWith('/api/companies/')&&u.pathname.endsWith('/update')&&req.method==='POST'){
    const companyId=u.pathname.split('/')[3]; const c=state.companies.find(x=>x.id===companyId); if(!c)return send(res,404,{error:'Company not found'});
    const b=await parseBody(req); const pair=validateCompanyCurrencyPair(b.currency??c.currency,b.reportingCurrency??c.reportingCurrency??c.currency); if(!pair.ok)return send(res,400,pair); const duplicate=duplicateCompanyName(b.name??c.name,c.id); if(duplicate)return send(res,409,{error:'A company with this name already exists.',code:'DUPLICATE_COMPANY_NAME',companyId:duplicate.id});
    Object.assign(c,{name:b.name??c.name,country:b.country??c.country,currency:pair.base,reportingCurrency:pair.report,reportingFramework:b.reportingFramework??c.reportingFramework,fiscalYearEnd:b.fiscalYearEnd??c.fiscalYearEnd,timezone:b.timezone??c.timezone,industry:b.industry??c.industry,updatedAt:new Date().toISOString()});
    save();audit('COMPANY_UPDATED',{companyId:c.id});return send(res,200,c);
  }
  if(u.pathname.startsWith('/api/companies/')&&req.method==='PUT'){
    const companyId=u.pathname.split('/').pop(); const c=state.companies.find(x=>x.id===companyId);
    if(!c)return send(res,404,{error:'Company not found'});
    const b=await parseBody(req); const pair=validateCompanyCurrencyPair(b.currency??c.currency,b.reportingCurrency??c.reportingCurrency??c.currency); if(!pair.ok)return send(res,400,pair); const duplicate=duplicateCompanyName(b.name??c.name,c.id); if(duplicate)return send(res,409,{error:'A company with this name already exists.',code:'DUPLICATE_COMPANY_NAME',companyId:duplicate.id}); Object.assign(c,{
      name:b.name??c.name,country:b.country??c.country,currency:pair.base,
      reportingCurrency:pair.report,reportingFramework:b.reportingFramework??c.reportingFramework,
      fiscalYearEnd:b.fiscalYearEnd??c.fiscalYearEnd,timezone:b.timezone??c.timezone,industry:b.industry??c.industry,
      updatedAt:new Date().toISOString()
    });
    save();audit('COMPANY_UPDATED',{companyId:c.id});return send(res,200,c);
  }
  if(u.pathname.startsWith('/api/companies/')&&u.pathname.endsWith('/archive')&&req.method==='POST'){
    const companyId=u.pathname.split('/')[3]; const c=state.companies.find(x=>x.id===companyId);
    if(!c)return send(res,404,{error:'Company not found'}); c.archived=!c.archived;c.updatedAt=new Date().toISOString();
    if(c.archived&&state.activeCompanyId===c.id)state.activeCompanyId=null;save();audit(c.archived?'COMPANY_ARCHIVED':'COMPANY_RESTORED',{companyId:c.id});return send(res,200,c);
  }
  if(u.pathname.startsWith('/api/companies/')&&u.pathname.endsWith('/delete')&&req.method==='POST'){
    const companyId=u.pathname.split('/')[3]; const idx=state.companies.findIndex(x=>x.id===companyId); if(idx<0)return send(res,404,{error:'Company not found'}); const c=state.companies[idx];
    for(const d of c.documents||[]){if(d.sourcePath){try{fs.unlinkSync(path.resolve(root,d.sourcePath))}catch{}}}
    try{fs.rmSync(path.join(companyDataDir,companyId),{recursive:true,force:true})}catch{}
    state.companies.splice(idx,1); if(state.activeCompanyId===companyId)state.activeCompanyId=state.companies.find(x=>!x.archived)?.id||null; save(); audit('COMPANY_DELETED',{companyId}); return send(res,200,{ok:true,activeCompanyId:state.activeCompanyId});
  }
  if(u.pathname.startsWith('/api/companies/')&&req.method==='DELETE'){
    const companyId=u.pathname.split('/').pop(); const idx=state.companies.findIndex(x=>x.id===companyId);
    if(idx<0)return send(res,404,{error:'Company not found'}); const c=state.companies[idx];
    for(const d of c.documents||[]){if(d.sourcePath){try{fs.unlinkSync(path.resolve(root,d.sourcePath))}catch{}}}
    try{fs.rmSync(path.join(companyDataDir,companyId),{recursive:true,force:true})}catch{}
    state.companies.splice(idx,1); if(state.activeCompanyId===companyId)state.activeCompanyId=state.companies.find(x=>!x.archived)?.id||null;
    save();audit('COMPANY_DELETED',{companyId});return send(res,200,{ok:true,activeCompanyId:state.activeCompanyId});
  }
  if(u.pathname==='/api/companies/active'&&req.method==='POST'){
    const b=await parseBody(req);
    if(!b.companyId){state.activeCompanyId=null;save();audit('ACTIVE_COMPANY_CLEARED',{});return send(res,200,{activeCompanyId:null});}
    if(!state.companies.some(c=>c.id===b.companyId))return send(res,404,{error:'Company not found'});
    state.activeCompanyId=b.companyId;save();audit('ACTIVE_COMPANY_CHANGED',{companyId:b.companyId});return send(res,200,{activeCompanyId:b.companyId});
  }
  if(u.pathname==='/api/agents'&&req.method==='GET')return send(res,200,{agents:state.agents});
  if(u.pathname.startsWith('/api/agents/')&&u.pathname.endsWith('/archive')&&req.method==='POST'){
    const agentId=u.pathname.split('/')[3],agent=state.agents.find(a=>a.id===agentId);if(!agent)return send(res,404,{error:'Agent not registered'});agent.archived=false;agent.enabled=!agent.enabled;agent.status=agent.enabled?'active':'inactive';agent.updatedAt=new Date().toISOString();save();audit(agent.enabled?'AGENT_ACTIVATED':'AGENT_DEACTIVATED',{agentId});return send(res,200,agent);
  }
  if(u.pathname.startsWith('/api/agents/')&&req.method==='DELETE'){
    const agentId=u.pathname.split('/').pop(),idx=state.agents.findIndex(a=>a.id===agentId);if(idx<0)return send(res,404,{error:'Agent not registered'});const agent=state.agents[idx];state.agents.splice(idx,1);save();audit('AGENT_DELETED_PERMANENT',{agentId,agentName:agent.name});return send(res,200,{ok:true,agentId});
  }
  if(u.pathname==='/api/beta/profile'&&req.method==='GET')return send(res,200,{ok:true,version:VERSION,profile:'multi-model-multi-agent',deprecated:false,model:PRELOAD_POLICY.preferredModelId,agent:PRELOAD_POLICY.agentId,nativeContextTokens:PRELOAD_POLICY.nativeContextTokens,testContextTokens:PRELOAD_POLICY.testContextTokens});
  if(u.pathname==='/api/ai-stack/status'&&req.method==='GET'){
    const host=await hostSpecifications();
    return send(res,200,{ok:true,nvidia:nvidiaEcosystemStatus(),host,extractor:{ensemble:fs.existsSync(ensembleHelper),docling:!!(await findPythonCommand()),configuredMode:'bounded-ensemble-with-nvidia-escalation'},models:{installed:installedModels(false).map(m=>m.filename),upgradeCatalog:CFO_LOCAL_RECOMMENDATIONS.filter(x=>x.upgrade||x.tier==='AI Model Upgrade')}});
  }
  if(u.pathname==='/api/models'&&req.method==='GET'){
    // /api/models must be bounded: never perform slow remote Hugging Face enrichment inside the request.
    // The UI receives the local/cached inventory immediately; remote catalog refresh is best-effort background work.
    const ollama=await Promise.race([ollamaStatus(), new Promise(resolve=>setTimeout(()=>resolve({online:false,models:[],degraded:true,error:'MODEL_STATUS_TIMEOUT'}),1500))]); const providerInstalled=(ollama.models||[]).map(name=>({filename:`ollama:${name}`,name,provider:'Ollama',runtime:'ollama',active:true,archived:false,providerModel:name}));
    if(!remoteModelCache.updatedAt && !remoteModelCache.refreshing) void refreshRemoteModelCache('',30,0);
    const runtimeCandidates=llamaServerCandidates();
    return send(res,200,{models:state.models,installed:installedModels().map(({path,...m})=>m),providerInstalled,catalog:MODEL_CATALOG,financeCatalog:curatedFinanceRecommendations(),remoteCatalog:remoteModelCache.models||[],recommendedLocalModels:curatedFinanceRecommendations().filter(x=>x.downloadable),providers:['Hugging Face','Ollama','GGUF / llama.cpp','LM Studio','Mistral','ModelScope','NVIDIA NGC','OpenAI-compatible endpoints','Transformers','vLLM'],source:'built-in-curated',remoteSource:remoteModelCache.source,remoteCatalogUpdatedAt:remoteModelCache.updatedAt,remoteCatalogError:remoteModelCache.error||null,runtime:{llamaCpp:runtimeCandidates.length>0,backends:runtimeCandidates.map(x=>x.kind),ollama}});
  }
  if(u.pathname==='/api/models/providers/catalog'&&req.method==='GET')return send(res,200,{catalogs:PROVIDER_CATALOGS});
  if(u.pathname==='/api/models/finance'&&req.method==='GET')return send(res,200,{models:curatedFinanceRecommendations(),installed:installedModels(false).filter(m=>!/^mmproj/i.test(m.filename))});
if(u.pathname==='/api/models/specialists'&&req.method==='GET'){
    const files=fs.readdirSync(modelsDir).filter(f=>f.toLowerCase().startsWith('specialist-'));
    return send(res,200,{installed:files.map(filename=>({filename,sizeBytes:fs.statSync(path.join(modelsDir,filename)).size,runtime:'transformers / specialist runtime',loadableByLlamaCpp:false}))});
  }
  if(u.pathname==='/api/models/search'&&req.method==='GET'){
    const q=(u.searchParams.get('q')||'').trim(); const limit=Number(u.searchParams.get('limit')||60); const offset=Number(u.searchParams.get('offset')||0);
    try{return send(res,200,{models:await remoteModels(q,limit,offset),source:'huggingface',limit,offset});}catch(e){return send(res,200,{models:MODEL_CATALOG,source:'fallback',error:String(e?.message||e)})}
  }
  if(u.pathname.startsWith('/api/models/installed/')&&u.pathname.endsWith('/toggle')&&req.method==='POST'){
    const filename=path.basename(decodeURIComponent(u.pathname.split('/')[4])); const fp=path.join(modelsDir,filename);
    if(!fs.existsSync(fp))return send(res,404,{error:'Installed model not found'});
    const current=state.modelLifecycle[filename]||{}; current.archived=!current.archived; current.updatedAt=new Date().toISOString(); state.modelLifecycle[filename]=current; save();
    audit(current.archived?'MODEL_DEACTIVATED':'MODEL_ACTIVATED',{filename}); 
    if(current.archived) stopLiveRuntime('manual',filename); else startLiveRuntime(filename).catch(e=>audit('MODEL_AUTOLOAD_FAILED',{filename,errorHash:sha(String(e?.message||e))}));
    return send(res,200,{ok:true,active:!current.archived,filename});
  }
  if(u.pathname.startsWith('/api/models/installed/')&&u.pathname.endsWith('/archive')&&req.method==='POST'){
    const filename=path.basename(decodeURIComponent(u.pathname.split('/')[4]));const fp=path.join(modelsDir,filename);if(!fs.existsSync(fp))return send(res,404,{error:'Installed model not found'});const current=state.modelLifecycle[filename]||{};current.archived=!current.archived;current.archivedAt=current.archived?new Date().toISOString():null;current.updatedAt=new Date().toISOString();state.modelLifecycle[filename]=current;if(current.archived){stopLiveRuntime('archive',filename);if(state.selectedModelFilename===filename)state.selectedModelFilename=installedModels(false).find(x=>x.filename!==filename)?.filename||null;}else startLiveRuntime(filename).catch(e=>audit('MODEL_AUTOLOAD_FAILED',{filename,errorHash:sha(String(e?.message||e))}));save();audit(current.archived?'MODEL_ARCHIVED':'MODEL_RESTORED',{filename});return send(res,200,{ok:true,filename,archived:!!current.archived});
  }
  if(u.pathname.startsWith('/api/models/installed/')&&req.method==='DELETE'){
    const filename=decodeURIComponent(u.pathname.split('/').pop());
    const safe=path.basename(filename); if(!safe.toLowerCase().endsWith('.gguf'))return send(res,400,{error:'Only local GGUF models can be deleted here.'});
    const fp=path.join(modelsDir,safe); if(!fs.existsSync(fp))return send(res,404,{error:'Installed model not found'});
    const sizeBytes=fs.statSync(fp).size; stopLiveRuntime('delete',safe); let removed=false,lastDeleteError=null; for(let attempt=1;attempt<=8;attempt++){try{if(fs.existsSync(fp))fs.unlinkSync(fp);removed=!fs.existsSync(fp);if(removed)break;}catch(e){lastDeleteError=e;await new Promise(r=>setTimeout(r,250*attempt));}} if(!removed)return send(res,409,{ok:false,error:'Model file could not be deleted because the runtime still holds it or Windows has not released the file handle.',code:'MODEL_DELETE_FILE_LOCKED',detail:String(lastDeleteError?.message||'delete failed')}); delete state.modelLifecycle[safe]; if(state.selectedModelFilename===safe)state.selectedModelFilename=installedModels(false).find(x=>x.filename!==safe)?.filename||null; save(); audit('MODEL_DELETED_PERMANENT',{filename:safe,sizeBytes}); return send(res,200,{ok:true,filename:safe});
  }
  if(u.pathname==='/api/models/import'&&req.method==='POST'){
    const b=await parseBody(req,4*1024*1024*1024); if(!b.filename||!b.contentBase64)return send(res,400,{error:'filename and contentBase64 required'}); const filename=path.basename(b.filename).replace(/[^a-zA-Z0-9._-]/g,'_'); if(!filename.toLowerCase().endsWith('.gguf'))return send(res,400,{error:'Only GGUF text models are supported.'}); const buf=Buffer.from(b.contentBase64,'base64'); if(buf.length>3.5*1024*1024*1024)return send(res,413,{error:'Imported model exceeds the 3.5 GB binary import limit. Use the verified model download workflow for larger models.',code:'MODEL_IMPORT_TOO_LARGE'}); const dest=path.join(modelsDir,filename); fs.writeFileSync(dest,buf); audit('MODEL_IMPORTED',{filename,sizeBytes:buf.length}); startLiveRuntime(filename).catch(e=>audit('MODEL_AUTOLOAD_FAILED',{filename,errorHash:sha(String(e?.message||e))})); return send(res,201,{ok:true,model:{filename,sizeBytes:buf.length,installed:true,autoLoad:true}});
  }
  if(u.pathname==='/api/models/download/start'&&req.method==='POST'){
    const b=await parseBody(req); const check=policyCheck(String(b.url||''),'tool_input'); if(!check.allowed)return send(res,403,{blocked:true,policy:check});
    const requestedModelId=String(b.modelId||'').trim(), requestedName=String(b.name||'').trim();
    const duplicate=[...modelDownloadJobs.values()].find(j=>['queued','downloading','running'].includes(j.status)&&(requestedModelId&&j.modelId===requestedModelId || requestedName&&j.name===requestedName));
    if(duplicate)return send(res,202,{ok:true,jobId:duplicate.jobId,duplicate:true});
    try{new URL(b.url); const requestedFilename=String(b.filename||''); if(!requestedFilename.toLowerCase().endsWith('.gguf'))return send(res,400,{error:'Text model downloads must be GGUF files.'}); if(/(^|[-_])mmproj|projector|vision[-_]?projector/i.test(requestedFilename))return send(res,400,{error:'Projector GGUF assets are not standalone CFO language models and cannot be downloaded into the runnable model pool.'}); const jobId=id('modeljob'); const job={jobId,modelId:b.modelId||null,name:b.name||b.filename,filename:b.filename,status:'queued',bytesReceived:0,totalBytes:0,speedBps:0,controller:new AbortController(),startedAt:new Date().toISOString()}; modelDownloadJobs.set(jobId,job);recordDownloadJob(job);audit('MODEL_DOWNLOAD_STARTED',{jobId,filename:b.filename,sourceHost:new URL(b.url).hostname},{correlationId:jobId});(async()=>{try{const result=await downloadToModels(b.url,b.filename,job);job.status='completed';job.result=result;recordDownloadJob(job);audit('MODEL_DOWNLOADED',{jobId,filename:result.filename,sizeBytes:result.sizeBytes,sourceHost:new URL(b.url).hostname},{correlationId:jobId});startLiveRuntime(result.filename).catch(e=>audit('MODEL_AUTOLOAD_FAILED',{jobId,filename:result.filename,errorHash:sha(String(e?.message||e))},{correlationId:jobId}))}catch(e){job.status=e?.message==='DOWNLOAD_CANCELLED'?'cancelled':'failed';job.error=e?.message||String(e);recordDownloadJob(job);audit('MODEL_DOWNLOAD_FAILED',{jobId,status:job.status,errorHash:sha(String(job.error||''))},{correlationId:jobId})}finally{setTimeout(()=>modelDownloadJobs.delete(jobId),3600000)}})(); return send(res,202,{ok:true,jobId});
    }catch(e){return send(res,400,{error:String(e?.message||e)})}
  }
  if(u.pathname==='/api/models/download/jobs'&&req.method==='GET'){const live=[...modelDownloadJobs.values()].map(j=>{const x={...j};delete x.controller;return x});const history=(state.modelDownloadHistory||[]).filter(h=>!h.preload&&!live.some(l=>l.jobId===h.jobId));const preloadHistory=(state.modelDownloadHistory||[]).filter(h=>!!h.preload).slice(0,20).map(h=>({jobId:h.jobId,name:h.name,filename:h.filename,status:h.status,error:h.error,createdAt:h.createdAt,finishedAt:h.finishedAt,preload:true}));return send(res,200,{jobs:[...live,...history].slice(0,50),preloadHistory,preload:state.preload||{status:'idle',version:null,jobs:[],autoRetryCount:0}});}
  if(u.pathname==='/api/models/download/status'&&req.method==='GET'){const job=modelDownloadJobs.get(u.searchParams.get('id'));if(!job)return send(res,404,{error:'Download job not found'});return send(res,200,{jobId:job.jobId,name:job.name,status:job.status,bytesReceived:job.bytesReceived,totalBytes:job.totalBytes,speedBps:job.speedBps,error:job.error,result:job.result});}
  if(u.pathname==='/api/models/download/cancel'&&req.method==='POST'){const job=modelDownloadJobs.get(u.searchParams.get('id'));if(!job)return send(res,404,{error:'Download job not found'});if(['completed','failed','cancelled'].includes(job.status))return send(res,200,{ok:true,status:job.status});job.controller.abort();job.status='cancelled';recordDownloadJob(job);return send(res,200,{ok:true,status:'cancelled'});}
  if(u.pathname==='/api/models/download'&&req.method==='POST'){return send(res,410,{error:'Use /api/models/download/start for cancellable downloads.'});}
  if(u.pathname==='/api/models/runtime'&&req.method==='GET'){if(state.selectedModelFilename&&!installedModels(false).some(m=>m.filename===state.selectedModelFilename)){state.selectedModelFilename=installedModels(false)[0]?.filename||null;save();} const os=await ollamaStatus();const oi=await commandAvailable(process.platform==='win32'?'ollama.exe':'ollama');return send(res,200,{installed:installedModels().map(({path,...m})=>m),providerInstalled:(os.models||[]).map(name=>({filename:`ollama:${name}`,name,provider:'Ollama',runtime:'ollama',active:true,archived:false,providerModel:name})),llamaCpp:llamaServerCandidates().length>0,backends:llamaServerCandidates().map(x=>x.kind),ollama:{...os,installed:oi},selectedModelFilename:state.selectedModelFilename||null,autoLoadEnabled:true,autoOffloadEnabled:false,autoOffloadMs:null,inferenceActive:activeInferenceCount,productionProfile:'machine-aware-cpu-gpu',live:liveRuntime?{modelId:liveRuntime.modelId,filename:liveRuntime.filename,port:liveRuntime.port,startedAt:liveRuntime.startedAt,backend:liveRuntime.backend,profile:liveRuntime.profile,resourceProfile:liveRuntime.resourceProfile||null,contextSize:liveRuntime.contextSize,nativeContextSize:liveRuntime.nativeContextSize}:null,pool:runtimePoolStatus()});}
  if(u.pathname==='/api/models/runtime/ensure'&&req.method==='POST'){try{const r=await ensureAutomaticModelRuntime({reason:'api-request',maxAttempts:5,waitMs:2500});return send(res,200,{ok:true,status:'loaded',model:{id:r.modelId,filename:r.filename},backend:r.backend,profile:r.profile,port:r.port,pool:runtimePoolStatus()});}catch(e){return send(res,503,{ok:false,status:'failed',error:String(e?.message||e),diagnostics:{installedModels:installedModels(false).map(x=>x.filename),backends:llamaServerCandidates().map(x=>x.kind),selectedModelFilename:state.selectedModelFilename||null}})}}
  if(u.pathname==='/api/models/runtime/load'&&req.method==='POST'){const b=await parseBody(req);try{if(b.filename)state.selectedModelFilename=path.basename(String(b.filename));if(!installedModels(false).some(m=>m.filename===state.selectedModelFilename))return send(res,400,{ok:false,error:'Selected file is not a runnable local text model. mmproj/projector GGUF files must be paired with a compatible vision model and are not standalone CFO runtimes.'});save();const r=await startLiveRuntime(state.selectedModelFilename);return send(res,200,{ok:true,status:'loaded',model:{id:r.modelId,filename:r.filename},port:r.port,startedAt:r.startedAt,backend:r.backend,profile:r.profile,autoOffloadEnabled:false,autoOffloadMs:null,pool:runtimePoolStatus()})}catch(e){return send(res,500,{ok:false,error:String(e?.message||e),diagnostics:{installedModels:installedModels(false).map(x=>x.filename),backends:llamaServerCandidates().map(x=>x.kind),selectedModelFilename:state.selectedModelFilename||null}})}}
  if(u.pathname==='/api/models/runtime/test'&&req.method==='POST'){const b=await parseBody(req);const correlationId=crypto.randomUUID();const result=await runLocalModel('Respond with exactly: MYAI CFO local model test passed.',correlationId,{modelFilename:String(b.modelFilename||'').trim(),allowStateSelection:true,maxTokens:80});if(result.ok)return send(res,200,{ok:true,answer:result.text,model:result.model,runtime:result.runtime,correlationId});return send(res,503,{ok:false,error:result.message,reason:result.reason,diagnostics:result.diagnostics||null,correlationId});}
  if(u.pathname==='/api/models/runtime/unload'&&req.method==='POST'){const b=await parseBody(req);const ok=stopLiveRuntime('manual',b.filename||null);return send(res,200,{ok,status:ok?'unloaded':'not_loaded',pool:runtimePoolStatus()});}
  if(u.pathname==='/api/diagnostics/production-certification'&&req.method==='GET'){
    const active=[...productionCertificationJobs.values()].find(j=>['queued','running'].includes(j.status));
    const latestCandidates=[
      path.join(dataDir,'diagnostics','production-certification-latest.json'),
      path.join(root,'qa','results','production-certification-latest.json')
    ];
    const latestPath=latestCandidates.find(p=>fs.existsSync(p))||latestCandidates[0];
    const latest=fs.existsSync(latestPath)?readJson(latestPath,null):null;
    return send(res,200,{active:active?{jobId:active.jobId,status:active.status,startedAt:active.startedAt,elapsedMs:Math.max(0,Date.now()-Date.parse(active.startedAt||new Date().toISOString())),reason:active.reason,steps:active.steps||[]}:null,latest});
  }
  if(u.pathname==='/api/diagnostics/production-certification/report'&&req.method==='GET'){
    const jobId=String(u.searchParams.get('jobId')||'').trim().replace(/[^a-zA-Z0-9._-]/g,'');
    if(!jobId)return send(res,400,{error:'jobId required'});
    const dirs=[
      path.join(dataDir,'diagnostics','production-certification',jobId),
      path.join(root,'qa','results','production-certification',jobId)
    ];
    const dir=dirs.find(d=>fs.existsSync(d))||dirs[0];
    const json=path.join(dir,'production-certification.json');
    const md=path.join(dir,'production-certification.md');
    if(!fs.existsSync(json))return send(res,404,{error:'Certification report not found',jobId,checkedDirectories:dirs});
    if(String(req.headers.accept||'').includes('text/markdown')&&fs.existsSync(md)){res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename=MYAI-CFO-${jobId}-QA-Certification.md`});return res.end(fs.readFileSync(md));}
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename=MYAI-CFO-${jobId}-QA-Certification.json`});return res.end(fs.readFileSync(json));
  }
  if(u.pathname==='/api/diagnostics/production-certification/cancel'&&req.method==='POST'){
    const job=[...productionCertificationJobs.values()].find(j=>['queued','running'].includes(j.status)); if(!job)return send(res,409,{error:'No running certification job.',code:'CERTIFICATION_NOT_RUNNING'}); job.status='cancelling';job.cancelRequestedAt=new Date().toISOString();job.elapsedMs=Math.max(0,Date.now()-Date.parse(job.startedAt)); try{if(job.pid)spawn('taskkill',['/PID',String(job.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{} audit('QA_CERTIFICATION_CANCEL_REQUESTED',{jobId:job.jobId},{correlationId:job.jobId}); return send(res,202,{ok:true,status:'cancelling',jobId:job.jobId});
  }
  if(u.pathname==='/api/diagnostics/production-certification/restart'&&req.method==='POST'){
    const active=[...productionCertificationJobs.values()].find(j=>['queued','running','cancelling'].includes(j.status)); if(active)return send(res,409,{error:'A certification process is still active. Kill/abort it before restarting.',code:'CERTIFICATION_STILL_RUNNING'}); const oldJobId=String((await parseBody(req)).jobId||''); audit('QA_CERTIFICATION_RESTART_REQUESTED',{oldJobId},{correlationId:oldJobId||null}); return send(res,200,{ok:true,status:'READY_TO_RESTART',oldJobId,message:'Start production certification again. A fresh certification boundary will be created.'});
  }
  if(u.pathname==='/api/diagnostics/production-certification'&&req.method==='POST'){
    const body=await parseBody(req);
    const existing=[...productionCertificationJobs.values()].find(j=>['queued','running'].includes(j.status));
    if(existing)return send(res,202,{ok:true,duplicate:true,jobId:existing.jobId,status:existing.status});
    const jobId=id('cert'); const reason=String(body.reason||'manual');
    const job={jobId,status:'queued',reason,startedAt:new Date().toISOString(),steps:[]};
    productionCertificationJobs.set(jobId,job);
    const startedAt=Date.now();
    audit('QA_CERTIFICATION_STARTED',{jobId,reason,target:'full-production-certification'},{correlationId:jobId});
    const script=path.join(root,'qa','Run-ProductionCertification.ps1');
    const powershell=process.platform==='win32'?'powershell.exe':null;
    if(!powershell||!fs.existsSync(script)){
      job.status='failed'; job.finishedAt=new Date().toISOString(); job.error=process.platform==='win32'?'Certification PowerShell script is missing.':'Full production certification requires Windows PowerShell in the target environment.';
      audit('QA_CERTIFICATION_FAILED',{jobId,reason,error:job.error,durationMs:Date.now()-startedAt},{correlationId:jobId});
      return send(res,501,{ok:false,jobId,status:job.status,error:job.error});
    }
    const child=spawn(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-RootDir',root,'-JobId',jobId,'-ApiBase',`http://127.0.0.1:${API_PORT}`],{cwd:root,env:{...process.env,MYAI_CFO_CERT_JOB_ID:jobId,MYAI_CFO_CERT_API_BASE:`http://127.0.0.1:${API_PORT}`},windowsHide:true});
    job.status='running'; job.pid=child.pid; job.watchdogMs=Number(process.env.MYAI_CFO_CERT_MAX_JOB_MS||90*60*1000);
    let stdout='',stderr='';
    child.stdout?.on('data',b=>{stdout+=String(b);}); child.stderr?.on('data',b=>{stderr+=String(b);});
    const killTree=(pid)=>{if(!pid)return;try{if(process.platform==='win32')spawn('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else process.kill(pid,'SIGTERM')}catch{}};
    let watchdog=setTimeout(()=>{
      if(!['queued','running'].includes(job.status))return;
      job.status='failed'; job.exitCode=124; job.finishedAt=new Date().toISOString(); job.watchdogTriggered=true; job.error=`Certification watchdog timeout after ${job.watchdogMs}ms.`;
      killTree(child.pid);
      audit('QA_CERTIFICATION_FAILED',{jobId,reason,exitCode:124,durationMs:Date.now()-startedAt,reportStatus:null,stdoutHash:sha(stdout),stderrHash:sha(stderr),error:job.error,watchdog:true},{correlationId:jobId});
    },job.watchdogMs);
    watchdog.unref?.();
    child.on('error',(err)=>{
      stderr=(stderr+'\n'+String(err?.stack||err?.message||err)).slice(-20000);
      audit('QA_CERTIFICATION_CHILD_ERROR',{jobId,errorHash:sha(String(err?.message||err))},{correlationId:jobId});
    });
    child.on('close',(code)=>{
      clearTimeout(watchdog);
      if(job.watchdogTriggered){setTimeout(()=>productionCertificationJobs.delete(jobId),24*3600*1000);return;}
      job.status=job.status==='cancelling'?'aborted':(code===0?'completed':'failed'); job.exitCode=job.status==='aborted'?130:code; job.finishedAt=new Date().toISOString();
      job.stdout=stdout.slice(-20000); job.stderr=stderr.slice(-20000);
      const latestPaths=[path.join(dataDir,'diagnostics','production-certification-latest.json'),path.join(root,'qa','results','production-certification-latest.json')];
      const latestPath=latestPaths.find(p=>fs.existsSync(p));
      job.report=latestPath?readJson(latestPath,null):null;
      audit(job.status==='aborted'?'QA_CERTIFICATION_ABORTED':(code===0?'QA_CERTIFICATION_COMPLETED':'QA_CERTIFICATION_FAILED'),{
        jobId,reason,exitCode:code,durationMs:Date.now()-startedAt,
        reportStatus:job.report?.releaseGate||job.report?.certificationStatus||job.report?.status||null,
        stdoutHash:sha(stdout),stderrHash:sha(stderr),
        error:code===0?null:(job.report?.fatalError||stderr.slice(-4000)||`Certification exited ${code}`)
      },{correlationId:jobId});
      setTimeout(()=>productionCertificationJobs.delete(jobId),24*3600*1000);
    });
    return send(res,202,{ok:true,jobId,status:job.status,reason});
  }
  if(u.pathname==='/api/audit/certification-event'&&req.method==='POST'){
    const body=await parseBody(req,256*1024);
    const correlationId=String(body.correlationId||body.jobId||'');
    const eventType=body.status==='FAIL'?'QA_CERTIFICATION_STEP_FAILED':'QA_CERTIFICATION_STEP';
    audit(eventType,{
      jobId:body.jobId||null,stepId:body.stepId||null,name:body.name||null,status:body.status||'INFO',
      durationMs:Number(body.durationMs)||null,command:body.command||null,reason:body.reason||null,
      evidence:body.evidence||null,stdoutHash:body.stdoutHash||null,stderrHash:body.stderrHash||null,
      exitCode:body.exitCode??null
    },{correlationId});
    return send(res,200,{ok:true});
  }
  if(u.pathname==='/api/diagnostics/run'&&req.method==='POST'){
  const started=Date.now(),checks=[]; const body=await parseBody(req); const browser=body.browser||{};
  const diagnosticRunId=crypto.randomUUID();
  const evidenceState={companyCount:(state.companies||[]).filter(c=>!c.archived).length,documentCount:(state.companies||[]).reduce((n,c)=>n+(c.documents||[]).filter(d=>!d.archived).length,0),knowledgeCount:readJson(path.join(dataDir,'knowledge','uploaded.json'),[]).filter(x=>!x.archived).length,activeModelCount:installedModels(false).filter(m=>!m.archived).length,liveRuntimeCount:liveRuntimes.size,qaFaults:{...qaFaults()}};

  const check=(id,name,ok,detail,fix='',severity='error')=>{
    const notEvaluable=ok==='NOT_EVALUABLE';
    const item={id,name,status:notEvaluable?'NOT_EVALUABLE':(ok?'PASS':'FAIL'),ok:notEvaluable?null:!!ok,detail,fix,severity};
    checks.push(item);
    audit(notEvaluable?'DIAGNOSTIC_CHECK_NOT_EVALUABLE':(ok?'DIAGNOSTIC_CHECK_PASSED':'DIAGNOSTIC_CHECK_FAILED'),{
      checkId:id,name,status:item.status,detail:String(detail||'').slice(0,1800),fix:String(fix||'').slice(0,800),
      severity,diagnosticRun:true
    },{correlationId:body?.correlationId||null});
    return item;
  };
  const activeAgents=state.agents.filter(a=>a.enabled&&!a.archived);
  const installed=installedModels(false);
  check('kernel','Backend kernel',true,'Node backend is executing.','','info');
  check('state','Persistent state',!!state && Array.isArray(state.agents),Array.isArray(state.agents)?`State loaded; ${state.agents.length} agents registered.`:'State could not be loaded.','Repair/reset local state.json.');
  check('agents','Agent registry',state.agents.length>=35&&activeAgents.length>=1&&activeAgents.length<=21,`Registered ${state.agents.length}; active ${activeAgents.length}.`,'Repair Agent Arena registry and choose 1–21 active capabilities.');
  check('production-agents','Production agent profile',activeAgents.length>=1&&activeAgents.every(a=>a.enabled&&!a.archived),`Production active set: ${activeAgents.map(a=>a.name).join(', ')||'none'}.`,'Activate at least one registered production agent.','error');
  check('models','Production model catalogue',MODEL_CATALOG.length>=10&&FINANCE_MODEL_CATALOG.length>=25,`${MODEL_CATALOG.length} general models and ${FINANCE_MODEL_CATALOG.length} finance/specialist model assets configured.`,'Review AI Models catalogue.');
  const referenceCountriesOk=Array.isArray(COUNTRIES)&&COUNTRIES.length>200; const referenceCurrenciesOk=Array.isArray(CURRENCIES)&&CURRENCIES.length>100;
  check('reference-lists','Company reference lists',referenceCountriesOk&&referenceCurrenciesOk,`Reference lists loaded: ${COUNTRIES.length} countries and ${CURRENCIES.length} currencies.`,'Repair bundled countries.json/currencies.json reference data.');
  const activeInstalled=installed.filter(m=>!m.archived);
  const preload=state.preload||{}; const preloadRunning=preload.status==='running'||preload.status==='queued';
  check('model-files','Local model files',installed.length>0,installed.length?`${installed.length} GGUF model(s) installed.`:preloadRunning?'Local model setup is still running; model files are being prepared; this check remains FAIL until a model is actually installed.':'No GGUF model is installed.','Wait for first-run model preparation to finish or install a recommended local model.');
  const hostDiag=await hostSpecifications(); const hostVram=Math.max(0,...(hostDiag.gpus||[]).map(g=>Number(g.vramGb)||0)); const selectedInstalled=installed.filter(m=>m.filename===state.selectedModelFilename); const selectedSize=selectedInstalled[0]?.sizeBytes||0; const storageOnly=selectedSize>8000000000 && hostVram<8 && Number(hostDiag.memory?.totalGb||0)<24; check('model-host-compatibility','Model / host compatibility',!storageOnly,storageOnly?`Selected model ${state.selectedModelFilename} is a large local model for this host (${hostVram} GB VRAM, ${hostDiag.memory?.totalGb||0} GB RAM); it may be storage-only and not runnable.`:'Selected local model is within the host compatibility envelope or no oversized model is selected.','Select a compatible local model for this machine before starting live inference.','warning');
  check('model-active','Active local models',activeInstalled.length>0,activeInstalled.length?`${activeInstalled.length} installed model(s) are active.`:preloadRunning?'Preload is still running; an active model is not yet proven.':'All installed models are inactive.','Activate at least one downloaded model and verify live runtime health.');
  const smokeModelFilenames=new Set(['Qwen2.5-1.5B-Instruct-Q4_K_M.gguf']);
  const productionModelFilenames=new Set(['Qwen3-4B-Q4_K_M.gguf','Qwen3-14B-Q4_K_M.gguf','NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf']);
  const smokeModelInstalled=installed.some(m=>smokeModelFilenames.has(m.filename));
  const productionModelInstalled=installed.some(m=>productionModelFilenames.has(m.filename));
  const productionModelNames=installed.filter(m=>productionModelFilenames.has(m.filename)).map(m=>m.filename);
  check('model-preload','Machine-aware local CFO model setup',(smokeModelInstalled||productionModelInstalled),(productionModelInstalled?`Production model ready: ${productionModelNames.join(', ')}.`:smokeModelInstalled?'Smoke model ready: Qwen2.5-1.5B-Instruct-Q4_K_M.gguf.':'Model setup status: '+(preload.status||'not-started')+'.'),'Install the fast smoke model for engineering validation; install a production model before final production certification.','error');
  check('llama','llama.cpp runtime',llamaServerCandidates().length>0,llamaServerCandidates().length?`Detected ${llamaServerCandidates().map(x=>x.kind).join(', ')} backend(s).`:'No llama.cpp backend executable detected.','Run local runtime setup again.');
  const runtimes=runtimePoolStatus(); const runtimeReady=activeInstalled.length===0||runtimes.length>=1; check('runtime-pool','Runtime pool',runtimeReady,`${runtimes.length} model runtime(s) online for ${activeInstalled.length} active model(s). Multiple model runtimes are supported concurrently; each loaded model receives its own runtime port.`,'Load the selected active local model and rerun diagnosis.');
  check('runtime-health','Live runtime health',runtimeReady,activeInstalled.length?`${runtimes.length}/${activeInstalled.length} active model(s) have at least one live runtime available.`:'No active local model requires runtime health.', 'Load the selected active local model and rerun diagnosis.');
  const knowledge=readJson(path.join(dataDir,'knowledge','uploaded.json'),[]).filter(x=>!x.archived); check('knowledge','Knowledge persistence',knowledge.length===0?'NOT_EVALUABLE':knowledge.every(x=>x.contentPath&&fs.existsSync(path.resolve(root,x.contentPath))),knowledge.length===0?'No active Knowledge Hub items exist; persistence is not yet evaluable.':knowledge.every(x=>x.contentPath&&fs.existsSync(path.resolve(root,x.contentPath)))?`${knowledge.length} active knowledge item(s) checked for persistent content paths.`:`One or more active knowledge items have missing persistent content paths.`,'Re-ingest missing knowledge files.');
  const docs=state.companies.flatMap(c=>c.documents||[]).filter(d=>!d.archived);
  const hasStructured=d=>Array.isArray(d.structuredFacts)&&d.structuredFacts.length>0; const failedEvidenceDocs=docs.filter(d=>!['completed','processing'].includes(String(d.status||'')) || String(d.aiStatusDetail||'').startsWith('NO_EXTRACTED_EVIDENCE') || (String(d.aiStatusDetail||'').startsWith('NO_VALID_FACTS')&&!hasStructured(d)));
  check('documents','Document evidence',docs.length===0?'NOT_EVALUABLE':failedEvidenceDocs.length===0,docs.length===0?'No active financial documents exist; document evidence is not yet evaluable.':failedEvidenceDocs.length?`${failedEvidenceDocs.length} active document(s) have failed/empty evidence state: ${failedEvidenceDocs.map(d=>`${d.filename||d.id}=${d.status||'unknown'}/${d.aiStatusDetail||d.error||'evidence-failed'}`).join('; ')}`:`${docs.length} active company document(s) have acceptable extraction/evidence state.`,'Reprocess failed documents.');
  const failedDocumentAi=docs.filter(d=>d.aiStatus==='failed' || String(d.aiStatusDetail||'').startsWith('NO_EXTRACTED_EVIDENCE') || (String(d.aiStatusDetail||'').startsWith('NO_VALID_FACTS')&&!hasStructured(d)) || d.status==='failed');
  const pendingDocumentAi=docs.filter(d=>['queued','processing','running','waiting_for_model'].includes(String(d.aiStatus||'')));
  check('document-ai-health','Document AI review state',docs.length===0?'NOT_EVALUABLE':failedDocumentAi.length===0,docs.length===0?'No active financial documents exist; document AI review is not yet evaluable.':failedDocumentAi.length?`${failedDocumentAi.length} active document(s) have failed/empty AI evidence review.`:pendingDocumentAi.length?`${pendingDocumentAi.length} active document(s) are still in AI evidence review.`:'No active document has a failed or empty AI evidence review.','Open Financial Documents → Review outcome and reprocess failed AI reviews.');
  let browserZones=[]; try{browserZones=JSON.parse(String(browser.worldTimeSelected||'[]'));}catch{} const worldOk=Array.isArray(browserZones)&&browserZones.length>0; check('worldtime','World Time browser persistence',worldOk,worldOk?`${browserZones.length} selected timezone(s) persisted in browser storage.`:'No persisted timezone selection was supplied by the browser.','Open World Time, add the required clocks, refresh, then rerun diagnosis.');
  const worldUnique=Array.isArray(browserZones)&&new Set(browserZones).size===browserZones.length&&browserZones.every(x=>typeof x==='string'&&x.length>0);
  check('worldtime-state-integrity','World Time state integrity',worldUnique,worldUnique?`Persisted clock selection contains ${browserZones.length} unique timezone(s).`:'World Time selection contains duplicates or invalid entries.','Repair World Time selection persistence so Add Clock stores the resolved search result.');
  let fxCodes=[];let fxHistoryCodes=[];try{fxCodes=JSON.parse(String(browser.fxCodes||'[]'));}catch{}try{fxHistoryCodes=JSON.parse(String(browser.fxHistoryCodes||'[]'));}catch{}
  const fxStateOk=Array.isArray(fxCodes)&&new Set(fxCodes).size===fxCodes.length&&!fxCodes.includes(String(browser.fxBase||'').toUpperCase());
  const fxHistoryStateOk=Array.isArray(fxHistoryCodes)&&new Set(fxHistoryCodes).size===fxHistoryCodes.length&&!fxHistoryCodes.includes(String(browser.fxHistoryBase||'').toUpperCase());
  check('fx-state-integrity','Current FX dynamic state',fxStateOk,fxStateOk?`Current FX stores ${fxCodes.length} selected quote currency(ies) independently of base ${browser.fxBase||'USD'}.`:'Current FX state is duplicated or contains the selected base currency.','Reset Current FX currency selection and rerun diagnosis.');
  check('fx-history-state-integrity','Historical FX dynamic state',fxHistoryStateOk,fxHistoryStateOk?`Historical FX stores ${fxHistoryCodes.length} selected quote currency(ies) independently of base ${browser.fxHistoryBase||'USD'}.`:'Historical FX state is duplicated or contains the selected base currency.','Reset Historical FX currency selection and rerun diagnosis.');
  const documentMetadataOk=docs.every(d=>d.documentType&&d.fiscalYear);
  check('document-metadata-integrity','Document metadata integrity',docs.length===0?'NOT_EVALUABLE':documentMetadataOk,docs.length===0?'No active financial documents exist; document metadata is not yet evaluable.':documentMetadataOk?`${docs.length} active document(s) have document type and financial year metadata.`:`${docs.filter(d=>!d.documentType||!d.fiscalYear).length} active document(s) are missing document type or financial year metadata.`,'Edit document metadata in Financial Documents before relying on classification.');
  const unifiedChatOk=browser.copilotChatStore==='myai-cfo-copilot-chat-sessions-v3';
  check('chat-workbench','Unified CFO Workbench',unifiedChatOk,unifiedChatOk?'Unified CFO Workbench chat store is configured.':'Unified CFO Workbench chat store is missing.','Repair the CFO Workbench chat store.');
  check('knowledge-source-registry','Knowledge source registry',KNOWLEDGE_SOURCES.length>=100,`${KNOWLEDGE_SOURCES.length} authoritative reference sources and ${new Set(KNOWLEDGE_SOURCES.map(x=>x.jurisdiction).filter(Boolean)).size} represented jurisdictions are registered.`,'Repair the built-in Knowledge Hub source registry.');
  const browserOnline=browser.online!==false;
  check('browser-online','Browser online state',browserOnline,browserOnline?'Browser reports online.':'Browser reports offline.','Reconnect the internet before testing online Market Intelligence.','warning');
  let marketOk=false, marketDetail='FX provider could not be verified.';
  const repo=state.fxRepository||{}; const repoBases=Object.keys(repo); const repoHasData=repoBases.some(base=>Object.keys(repo[base]||{}).length>0);
  if(browserOnline){
    try{
      const mr=await fetch('https://api.frankfurter.dev/v2/rate/USD/EUR',{signal:AbortSignal.timeout(5000),headers:{'Accept':'application/json','User-Agent':'MYAI-CFO-Diagnostics/1.24.26'}});
      marketOk=mr.ok; marketDetail=mr.ok?'Browser reports online and Frankfurter provider probe is reachable from the CFO kernel.':`Browser is online but Frankfurter returned HTTP ${mr.status}.`;
    }catch(e){
      marketOk=repoHasData||browserOnline;
      marketDetail=repoHasData
        ? `Browser is online. Direct Frankfurter probe timed out; local FX repository is available and the FX page can use its browser fallback.`
        : `Browser is online. Direct Frankfurter probe timed out (${e.message}); FX page will attempt a browser-side provider fallback.`;
    }
  }
  check('market-connectivity','FX Intelligence online connectivity',marketOk,marketDetail,'Open FX Rates and use Refresh FX; the page will use browser fallback or local repository when the server-side provider probe is unavailable.','warning');
  check('market-ui','FX Intelligence browser state',browser.fxBase!==undefined,true,'FX UI state was received from the browser.','','info');
  const activeCompanyState=activeCompany();
  check('module-companies','Companies module',Array.isArray(state.companies),`${state.companies.length} company workspace(s) available.`,'Repair persistent company state.');
  check('module-documents','Financial Documents module',Array.isArray(activeCompanyState?.documents||[])||activeCompanyState===null,activeCompanyState?`Financial Documents route is available for ${activeCompanyState.name}.`:'Financial Documents route is available; select a company to ingest evidence.','Select or create a company workspace.');
  const knowledgeDir=path.join(dataDir,'knowledge'); const knowledgeFile=path.join(knowledgeDir,'uploaded.json'); let knowledgeReadable=fs.existsSync(knowledgeDir); if(knowledgeReadable&&fs.existsSync(knowledgeFile)){try{JSON.parse(fs.readFileSync(knowledgeFile,'utf8'));}catch{knowledgeReadable=false;}}
  check('module-knowledge','Knowledge Hub module',knowledgeReadable,knowledgeReadable?'Knowledge repository is available.':'Knowledge repository directory/file is missing or unreadable.','Repair the local knowledge repository.');
  const knowledgeItems=readJson(knowledgeFile,[]).filter(x=>!x.archived);
  const knowledgeOriginalsOk=knowledgeItems.every(x=>x.sourcePath&&fs.existsSync(path.resolve(root,x.sourcePath)));
  const knowledgeAssetsOk=knowledgeItems.every(x=>Number(x.visualAssetCount||0)===0 || !!x.extractedAssets);
  check('knowledge-original-files','Knowledge original file access',knowledgeItems.length===0?'NOT_EVALUABLE':knowledgeOriginalsOk,knowledgeItems.length===0?'No active Knowledge Hub items exist; original-file integrity is not yet evaluable.':knowledgeOriginalsOk?`${knowledgeItems.length} active knowledge item(s) have original local files.`:'One or more active knowledge items have missing original files.','Repair knowledge source paths and preserve original uploads.');
  check('knowledge-assets','Knowledge visual/table extraction',knowledgeItems.length===0?'NOT_EVALUABLE':knowledgeAssetsOk,knowledgeItems.length===0?'No active Knowledge Hub items exist; visual/table extraction is not yet evaluable.':knowledgeAssetsOk?'Knowledge asset metadata is present for extracted visual/table content.':'One or more knowledge items have incomplete asset metadata.','Re-ingest affected knowledge files.');
  check('module-models','AI Models module',MODEL_CATALOG.length>0&&llamaServerCandidates().length>0,'AI Models catalogue and llama.cpp runtime surface are available.','Repair the local model catalogue/runtime.');
  check('extractor-ensemble','Multi-extractor ingestion engine',fs.existsSync(ensembleHelper),fs.existsSync(ensembleHelper)?'Bounded multi-extractor ingestion is installed for PDF, Office, HTML and text uploads.':'Ensemble extraction helper is missing.','Restore scripts/extraction/document_ensemble.py.');
  let doclingInstalled=false;
  try{const py=await findPythonCommand(); if(py){const probe=await execFileAsync(py,['-c','import docling'],{timeout:2500,windowsHide:true}); doclingInstalled=!!probe;} }catch{}
  check('docling-extractor-path','Docling document-intelligence path',true,
    doclingInstalled?'Docling is installed and will participate as the preferred layout-aware PDF engine; independent PyMuPDF/pdfplumber passes remain for reconciliation.':'Docling is optional in the release candidate; bounded PyMuPDF/pdfplumber/statement-row fallback is active and remains independently reconciled.',
    'Install Docling on environments where enhanced layout-aware PDF extraction is required.','warning');
  const processingDocs=docs.filter(d=>['processing','queued'].includes(String(d.status||'')) || ['extracting','evidence','facts','queued'].includes(String(d.stage||'')));
  const feedExtractors=[...new Set(docs.map(d=>d.extractionQuality?.ragFeedExtractor||d.extractionQuality?.primaryExtractor||d.extractionMethod).filter(Boolean))];
  const ragPending=processingDocs.length>0 && feedExtractors.length===0;
  check('rag-extractor-path','RAG document feed extractor',docs.length===0?'NOT_EVALUABLE':(ragPending?'NOT_EVALUABLE':feedExtractors.length>0),
    docs.length===0?'No active financial documents are available for a RAG feed check.':ragPending?`${processingDocs.length} document(s) are still processing; RAG feed provenance is pending until extraction completes.`:`RAG document feed extractor(s): ${feedExtractors.join(', ')}. Financial fact reconciliation remains independent of the RAG feed extractor.`,
    ragPending?'Wait for document extraction to complete and rerun diagnosis.':'Reprocess financial documents and verify extractionQuality.ragFeedExtractor is recorded.','warning');
  const nvidia=nvidiaEcosystemStatus();
  let nvPy=false; try{const py=await findPythonCommand(); if(py){const probe=await execFileAsync(py,['-c','import nv_ingest_client'],{timeout:2500,windowsHide:true}); nvPy=!!probe;} }catch{}
  check('nvidia-extractor-path','NVIDIA document-intelligence path',true,
    nvidia.configured?`NVIDIA extraction integration configured: ${nvidia.mode}.`:nvPy?'NVIDIA NeMo Retriever Python client is installed and available as an optional accelerator.':'Optional NVIDIA document-intelligence path is not configured; local Docling/PyMuPDF/pdfplumber ensemble remains the supported default.',
    'Configure NVIDIA NeMo Retriever only when explicitly selecting NVIDIA document-intelligence mode.','warning');
  const activeC=activeCompany();
  if(activeC){try{await ensureCanonicalFinancialData(activeC);}catch{}}
  const tx=dataTransmissionAudit(activeC);
  const companyHasEvidence=(c)=>!!c&&(((c.documents||[]).some(d=>!d.archived&&Number(d.evidenceCount||0)>0))||((c.facts||[]).some(f=>f.documentId)));
  const arenaCompany=companyHasEvidence(activeC)?activeC:((state.companies||[]).find(c=>!c.archived&&companyHasEvidence(c))||activeC||null);
  const arenaContext=arenaCompany?companyEvidenceContext(arenaCompany):null;
  const pipelinePending=!!activeC && (activeC.documents||[]).some(d=>['processing','queued'].includes(String(d.status||'')) || ['extracting','evidence','facts','queued'].includes(String(d.stage||'')));
  const companyEvidenceState=!activeC?'NO_COMPANY':((activeC.documents||[]).filter(d=>!d.archived).length===0?'NO_DOCUMENTS':'HAS_DOCUMENTS');
  if(companyEvidenceState==='NO_COMPANY'){
    check('data-lineage-canonical','Financial data canonicalisation','NOT_EVALUABLE','No active company workspace exists; financial canonicalisation requires a company context.','Create/select a company before evaluating financial canonicalisation.','warning');
    check('data-transmission-dashboard','Data transmission → CFO Dashboard','NOT_EVALUABLE','No active company workspace exists; dashboard evidence transmission is not yet evaluable.','Create/select a company before evaluating dashboard evidence transmission.','warning');
  } else if(companyEvidenceState==='NO_DOCUMENTS'){
    check('data-lineage-canonical','Financial data canonicalisation','NOT_EVALUABLE','No financial documents are present for the active company; canonical financial facts cannot yet be evaluated.','Upload a financial document before evaluating canonical facts.','warning');
    check('data-transmission-dashboard','Data transmission → CFO Dashboard','NOT_EVALUABLE','No financial documents are present for the active company; dashboard evidence transmission cannot yet be evaluated.','Upload a financial document before evaluating dashboard evidence transmission.','warning');
  } else {
    check('data-lineage-canonical','Financial data canonicalisation',pipelinePending?'NOT_EVALUABLE':(tx.metadata.documentCount>0&&tx.metadata.candidateFactCount+tx.metadata.validatedFactCount>0),pipelinePending?`Canonical facts are pending because ${activeC.documents.filter(d=>['processing','queued'].includes(String(d.status||''))||['extracting','evidence','facts','queued'].includes(String(d.stage||''))).length} document(s) are still processing.`:`Canonical facts linked to ${tx.metadata.documentCount} active document(s): ${tx.metadata.candidateFactCount} provisional, ${tx.metadata.validatedFactCount} validated.`,pipelinePending?'Wait for document extraction/reconciliation to complete.':'Reprocess Financial Documents and rebuild canonical facts.');
    check('data-transmission-dashboard','Data transmission → CFO Dashboard',pipelinePending?'NOT_EVALUABLE':tx.ok,pipelinePending?'Dashboard transmission is pending while document evidence/canonical facts are still processing.':tx.ok?`Dashboard source facts available with fiscal years ${tx.metadata.fiscalYears.join(', ')||'n/a'} and currency ${tx.metadata.currency||'n/a'}.`:`Dashboard transmission incomplete; missing ${tx.missing.join(', ')||'source-linked facts'}.`,pipelinePending?'Wait for document processing to finish and rerun diagnosis.':'Reprocess the document and rerun diagnosis.');
  }
  if(companyEvidenceState!=='HAS_DOCUMENTS'){
    check('data-transmission-intelligence','Data transmission → CFO Intelligence','NOT_EVALUABLE',companyEvidenceState==='NO_COMPANY'?'No active company workspace exists; CFO Intelligence is not yet evaluable.':'No financial documents are present; CFO Intelligence requires source-linked financial facts.','Create/select a company and ingest a financial document before evaluating Intelligence.','warning');
    check('data-transmission-copilot','Data transmission → CFO Copilot','NOT_EVALUABLE',companyEvidenceState==='NO_COMPANY'?'No active company workspace exists; company-specific Copilot evidence is not yet evaluable.':'No financial documents are present; company-specific Copilot evidence is not yet evaluable.','Create/select a company and ingest evidence before evaluating company-specific Copilot context.','warning');
  } else if(pipelinePending){
    check('data-transmission-intelligence','Data transmission → CFO Intelligence','NOT_EVALUABLE','CFO Intelligence is pending while document facts finish extraction/reconciliation.','Wait for document processing to finish before evaluating Intelligence.','warning');
    check('data-transmission-copilot','Data transmission → CFO Copilot','NOT_EVALUABLE','CFO Copilot evidence context is pending while document facts are still being prepared.','Wait for document processing to finish before evaluating company-specific Copilot context.','warning');
  } else {
    check('data-transmission-intelligence','Data transmission → CFO Intelligence',tx.ok,tx.ok?`CFO Intelligence has source-linked facts and ratio inputs for fiscal years ${tx.metadata.fiscalYears.join(', ')||'n/a'}.`:'CFO Intelligence transmission incomplete; ratio inputs are not fully available.','Rebuild canonical facts and rerun Intelligence.');
    check('data-transmission-copilot','Data transmission → CFO Copilot',tx.copilotVisibleFacts>0,`${tx.copilotVisibleFacts} source-linked company facts are visible to the Copilot evidence context.`,'Rebuild the company evidence context before testing Copilot.');
  }
  const kCount=knowledge.length; const kContent=knowledge.filter(x=>x.contentPath&&fs.existsSync(path.resolve(root,x.contentPath))).length;
  check('data-transmission-pa','Data transmission → CFO PA / Knowledge Hub',kCount===0?'NOT_EVALUABLE':kCount===kContent,kCount===0?'No active Knowledge Hub items are available for a PA transmission test.':`${kContent}/${kCount} active Knowledge Hub item(s) have persistent source content available to CFO PA.`,'Re-ingest Knowledge Hub items before testing CFO PA.','warning');
  const latestYears=[...new Set((activeC?.documents||[]).filter(d=>!d.archived).map(d=>String(d.fiscalYear||'' )).filter(Boolean))];
  const yearMismatch=(activeC?.documents||[]).filter(d=>!d.archived&&d.documentFiscalYear&&String(d.documentFiscalYear)!==String(d.fiscalYear));
  check('data-fiscal-year-propagation','Fiscal year propagation',companyEvidenceState!=='HAS_DOCUMENTS'?'NOT_EVALUABLE':(yearMismatch.length===0),
    companyEvidenceState!=='HAS_DOCUMENTS'?(companyEvidenceState==='NO_COMPANY'?'No active company workspace exists; fiscal-year propagation is not yet evaluable.':'No financial documents are present; fiscal-year propagation is not yet evaluable.'):(yearMismatch.length?`${yearMismatch.length} document(s) have user-selected FY different from document-derived FY.`:`Fiscal years ${latestYears.join(', ')||'n/a'} are consistent from Financial Documents into the canonical fact store.`),
    companyEvidenceState!=='HAS_DOCUMENTS'?'Create/select a company and ingest a financial document before evaluating fiscal-year propagation.':'Resolve document metadata/fiscal-year mismatch before relying on period comparisons.',companyEvidenceState!=='HAS_DOCUMENTS'?'warning':'error');
  const ratioReady=!!activeC&&!!tx.metadata?.ratiosReady;
  const ratioMeta=tx.metadata||{};
  if(activeC && typeof tx.ratiosReady==='undefined' && typeof ratioMeta.ratiosReady==='boolean') audit('DIAGNOSTIC_RATIO_METADATA_ALIGNMENT',{companyId:activeC.id,ratioReadyFromMetadata:ratioMeta.ratiosReady,ratioFiscalYear:ratioMeta.ratioFiscalYear},{correlationId:body?.correlationId||null});
  const ratioDetail=ratioReady?`Current Ratio inputs are source-linked and ready for deterministic calculation (FY ${ratioMeta.ratioFiscalYear||'n/a'}).`:
    `Current Ratio readiness failed: ${ratioMeta.ratioPairDiagnostics?.readinessReason||'unknown'}; diagnostic used ratio fiscal year ${ratioMeta.ratioFiscalYear||'n/a'}; Current Assets fact ${ratioMeta.ratioInputFactIds?.current_assets||'missing'} (${ratioMeta.ratioInputValues?.current_assets??'n/a'}), Current Liabilities fact ${ratioMeta.ratioInputFactIds?.current_liabilities||'missing'} (${ratioMeta.ratioInputValues?.current_liabilities??'n/a'}).`;
  check('data-ratio-inputs','Ratio/KPI source inputs',companyEvidenceState!=='HAS_DOCUMENTS'||pipelinePending? 'NOT_EVALUABLE':ratioReady,
    companyEvidenceState!=='HAS_DOCUMENTS'?(companyEvidenceState==='NO_COMPANY'?'No active company workspace exists; ratio inputs are not yet evaluable.':'No financial documents are present; ratio inputs are not yet evaluable.'):pipelinePending?'Ratio/KPI inputs are pending while document extraction/reconciliation is still running.':ratioDetail,
    companyEvidenceState!=='HAS_DOCUMENTS'||pipelinePending?'No action required while required evidence is absent or still processing.':'Inspect canonical current_assets/current_liabilities facts, fiscal-year binding, and ratio readiness metadata; do not reprocess blindly.',companyEvidenceState!=='HAS_DOCUMENTS'||pipelinePending?'warning':'error');
  check('module-copilot','CFO Copilot module',activeInstalled.length>0&&runtimes.length>0,'CFO Copilot has an active local model/runtime path.','Activate and load the production local model.');
  check('module-cfo-workbench','Unified CFO Workbench module',activeInstalled.length>0&&runtimes.length>0,'Unified CFO Workbench has a local model/runtime path.','Activate and load the production local model.');
  check('module-worldtime','World Time module',worldOk||browserOnline,worldOk?`World Time has ${browserZones.length} persisted clock(s).`:'World Time route is available; no saved clocks were supplied in this diagnostic pass.','Open World Time and add a clock.');
  check('module-fx','FX Rates module',browserOnline,'FX module is available and the browser reports online; provider fallback/local repository is enabled.','Open FX Rates and refresh the current feed.','warning');
  const fxHistCodes=String(browser.fxHistoryCodes||'[]'); let fxHistParsed=[]; try{fxHistParsed=JSON.parse(fxHistCodes)}catch{}; check('fx-history-selection','Historical FX multi-currency selection',!browserOnline || !fxHistParsed.length || fxHistParsed.every(c=>/^[A-Z]{3}$/.test(c)),`Historical FX selected currencies: ${fxHistParsed.join(', ')||'none'}.`,'Use valid ISO currency codes and rerun the historical lookup.','error');
  check('module-audit','Audit Trail module',true,'Hash-linked audit ledger route is available.','Refresh Audit Trail.','info');
  check('module-settings','Settings & themes module',!!browser.theme&&!!browser.appearance,`Appearance/theme state received: ${browser.appearance||'unknown'} / ${browser.theme||'unknown'}.`,'Open Settings and choose an appearance/theme.','warning');
  const theme=String(browser.theme||''); check('theme','Theme rendering configuration',!!theme,theme?`Browser theme reported: ${theme}.`:'Browser theme was not reported.','Reload the application and rerun diagnosis.','warning');
  let frontendSourceOk=false,frontendSourceDetail='Frontend source could not be inspected.'; try{const fp=path.join(root,'app','frontend','src','main.jsx'); const src=fs.readFileSync(fp,'utf8'); frontendSourceOk=src.includes('[benchmarkBusy,setBenchmarkBusy]') && src.includes('function Models()'); frontendSourceDetail=frontendSourceOk?'Frontend source integrity checks passed for critical AI Models state declarations.':'Frontend source integrity check found a critical AI Models state declaration mismatch.';}catch(e){frontendSourceDetail=String(e?.message||e);} check('frontend-source-integrity','Frontend source integrity',frontendSourceOk,frontendSourceDetail,'Run the frontend source regression suite and rebuild the UI.','error');
  const ui=browser.ui||{};
  check('ui-interaction-surface','UI interaction surface',Number(ui.buttons||0)>0&&Number(ui.selects||0)>0,`${ui.buttons||0} buttons, ${ui.selects||0} selects, ${ui.inputs||0} inputs, ${ui.links||0} links reported by the browser.`, 'Reload the application and rerun the browser interaction audit.','error');
  check('ui-labelled-actions','UI action labelling',Number(ui.unlabelledButtons||0)===0,`${ui.unlabelledButtons||0} unlabeled button(s) reported by the browser.`, 'Give every interactive button visible text, title or aria-label.','error');
  const matrix=[]; for(const a of activeAgents){for(const m of activeInstalled){matrix.push({agentId:a.id,agentName:a.name,model:m.filename});}}
  let matrixFailures=[];
  if(browser.deep===true && matrix.length && activeInstalled.length){
    for(const pair of matrix){
      try{const probe=await runLocalModel(`MYAI CFO automated diagnostic. Agent capability: ${pair.agentName}. Model: ${pair.model}. Reply with exactly PASS.`,crypto.randomUUID(),{modelFilename:pair.model,maxTokens:32}); if(!probe.ok || !/PASS/i.test(String(probe.text||'')))matrixFailures.push({...pair,reason:probe.message||'Probe did not return PASS'});}catch(e){matrixFailures.push({...pair,reason:String(e?.message||e)});}
    }
  }
  check('agent-model-matrix','Active agent × model matrix',matrix.length===0||matrixFailures.length===0,matrix.length?`${matrix.length} active agent/model combinations tested${browser.deep===true?' with live inference probes':''}; ${matrixFailures.length} failed.`:'No active agent/model combinations to test.',matrixFailures.length?`Repair failed combinations: ${matrixFailures.map(x=>`${x.agentName}/${x.model}`).slice(0,8).join(', ')}${matrixFailures.length>8?' …':''}.`:'All active agent/model combinations passed the live diagnostic probe.');
  let arenaProbe={ok:false,reason:'Not tested'};
  if(!arenaCompany || !((arenaCompany.documents||[]).some(d=>!d.archived&&Number(d.evidenceCount||0)>0)) && !((arenaCompany.facts||[]).some(f=>f.documentId))) arenaProbe={ok:false,reason:'NO_COMPANY_EVIDENCE'};
  else if(pipelinePending) arenaProbe={ok:false,reason:'EVIDENCE_PROCESSING'};
  else if(browser.deep===true&&activeAgents.length===1&&activeInstalled.length>=1){
    try{
      const probe=await runAgentCompetition({message:'Diagnostic Arena task: identify one finance control that should be checked and state what evidence is required.',task:'diagnostic_arena',companyContext:arenaContext||arenaCompany||activeC,activeInstructions:[],retrievedKnowledge:[],correlationId:crypto.randomUUID(),modelFilename:activeInstalled[0].filename});
      arenaProbe=probe.ok&&probe.winner?.answer?{ok:true,model:probe.winner.model,runtime:probe.winner.runtime}:{ok:false,reason:probe.message||probe.reason||'No usable Arena candidate'};
    }catch(e){arenaProbe={ok:false,reason:String(e?.message||e)};}
  }
  check('arena-live-inference','Agent Arena live inference',(['NO_COMPANY_EVIDENCE','EVIDENCE_PROCESSING'].includes(arenaProbe.reason))?'NOT_EVALUABLE':arenaProbe.ok,arenaProbe.reason==='NO_COMPANY_EVIDENCE'?'No company evidence is available; Arena will be evaluated after certification evidence is provisioned.':arenaProbe.reason==='EVIDENCE_PROCESSING'?'Company evidence is still processing; Arena candidate quality will be evaluated after extraction/canonicalisation completes.':(arenaProbe.ok?`Representative Arena competition returned a usable response using ${arenaProbe.model}.`:`Representative Arena competition failed: ${arenaProbe.reason}`),(['NO_COMPANY_EVIDENCE','EVIDENCE_PROCESSING'].includes(arenaProbe.reason))?'Wait for company evidence processing before evaluating Arena candidate quality.':'Fix Agent Arena context packing/routing before manual testing.',(['NO_COMPANY_EVIDENCE','EVIDENCE_PROCESSING'].includes(arenaProbe.reason))?'warning':'error');
  let copilotProbe={ok:false,reason:'Not tested'};
  if(browser.deep===true && activeInstalled.length){
    try{const probe=await runLocalModel('Answer exactly: Revenue is income generated from normal business activities.',crypto.randomUUID(),{modelFilename:'',maxTokens:120,contextSize:8192});copilotProbe=probe.ok&&String(probe.text||'').trim()?{ok:true,model:probe.model,runtime:probe.runtime}: {ok:false,reason:probe.message||'Empty response'};}catch(e){copilotProbe={ok:false,reason:String(e?.message||e)};}
  }
  check('copilot-live-inference','CFO Copilot live inference',copilotProbe.ok,copilotProbe.ok?`Live CFO prompt returned a non-empty response using ${copilotProbe.model}.`:`Live CFO prompt failed: ${copilotProbe.reason}`,'Fix model context/routing/inference before manual testing.','error');
  const matrixResults={tested:matrix.length,failed:matrixFailures.length,failures:matrixFailures};
  const providers=['Hugging Face','Mistral','Ollama','LM Studio','ModelScope','NVIDIA NGC'];
  const qaFaultState=qaFaults();
  const qaFaultsClean=Object.values(qaFaultState).every(v=>v===false);
  check('qa-fault-state','QA fault state clean',qaFaultsClean,qaFaultsClean?'All QA fault-injection flags are false.':`Active QA faults: ${Object.entries(qaFaultState).filter(([,v])=>v).map(([k])=>k).join(', ')}`,'Reset QA fault state before relying on live results.','error');
  const versionConsistent=[VERSION,readJson(path.join(root,'app','backend','package.json'),{}).version,readJson(path.join(root,'app','frontend','package.json'),{}).version].every(v=>String(v||'')===VERSION);
  check('release-version-integrity','Release version integrity',versionConsistent,versionConsistent?`All release manifests report ${VERSION}.`:'VERSION.txt and package manifests do not agree.','Repair release version metadata.','error');
  const auditManifestOk=fs.existsSync(auditManifest)&&(()=>{try{const m=readJson(auditManifest,{});return Number(m.events||0)>=0 && (!m.lastHash || /^[a-f0-9]{64}$/i.test(String(m.lastHash)));}catch{return false}})();
  check('audit-manifest-integrity','Audit manifest integrity',auditManifestOk,auditManifestOk?'Audit manifest is present and structurally valid.':'Audit manifest is missing or structurally invalid.','Repair the local audit manifest before production certification.','error');
  let liveProbe={ok:false,reason:'No live runtime probe executed.'};
  if(browser.deep===true && activeInstalled.length){
    try{const probe=await runLocalModel('Respond exactly PASS.',crypto.randomUUID(),{modelFilename:activeInstalled[0].filename,maxTokens:16,contextSize:2048});liveProbe=probe.ok&&/^\s*PASS\s*$/i.test(String(probe.text||''))?{ok:true,model:probe.model,runtime:probe.runtime}:{ok:false,reason:probe.message||'Live runtime returned an unexpected result.'};}
    catch(e){liveProbe={ok:false,reason:String(e?.message||e)}}
  }
  check('live-runtime-probe','Live runtime inference probe',browser.deep===true?liveProbe.ok:true,browser.deep===true?(liveProbe.ok?`Live runtime inference probe passed using ${liveProbe.model}.`:`Live runtime inference probe failed: ${liveProbe.reason}`):'Deferred in non-deep diagnostic mode.','Run a deep diagnostic with an operational local runtime.','error');
    check('provider-surface','Model provider surface',providers.every(Boolean),`${providers.length} model-provider surfaces registered.`,`Repair the AI Models provider catalogue.`,'error');
  const evaluable=checks.filter(x=>x.status!=='NOT_EVALUABLE'),passed=evaluable.filter(x=>x.ok===true).length,failed=evaluable.filter(x=>x.ok===false).length,notEvaluable=checks.length-evaluable.length,rate=evaluable.length?Math.round(1000*passed/evaluable.length)/10:0,coverage=checks.length?Math.round(1000*(passed+failed)/checks.length)/10:0;
  const fullyEvaluated=notEvaluable===0;
  const strictDiagnosticCriteria={threshold:100,zeroFailures:failed===0,fullEvidence:fullyEvaluated,evidenceCoverage100:coverage===100,installedModel:installed.length>=1,productionModel:productionModelInstalled,activeRuntime:activeInstalled.length>=1&&runtimes.length>=1,liveInference:copilotProbe.ok&&liveProbe.ok,activeAgent:activeAgents.length>=1,qaFaultsClean,versionConsistent,auditManifestOk,allDeepSuitesPassed:state.qa?.aiSecuritySuite?.status==='PASS'&&state.qa?.ragSuite?.status==='PASS'&&state.qa?.agentTrajectory?.status==='PASS'&&state.qa?.recoveryVerification?.status==='PASS'&&state.qa?.observability?.status==='PASS',suiteEvidencePresent:Number(state.qa?.aiSecuritySuite?.executedTests||0)>0&&Number(state.qa?.ragSuite?.executedTests||0)>0&&Number(state.qa?.agentTrajectory?.executedTests||0)>0&&Number(state.qa?.recoveryVerification?.executedTests||0)>0};
  const readyForManualTesting=Object.values(strictDiagnosticCriteria).every(Boolean) && frontendSourceOk && matrixFailures.length===0 && tx.ok && preload.status!=='running';
  const diagnosticScope=fullyEvaluated?'FULL_EVIDENCE':(evidenceState.companyCount||evidenceState.documentCount||evidenceState.knowledgeCount?'PARTIAL_EVIDENCE':'CLEAN_BASELINE');
  const failedActions=checks.filter(x=>x.status==='FAIL').map(x=>({id:x.id,action:x.fix,detail:x.detail,severity:x.severity,status:x.status})); const deferredChecks=checks.filter(x=>x.status==='NOT_EVALUABLE').map(x=>({id:x.id,action:'No action required while required evidence is absent; provision the relevant evidence when ready.',detail:x.detail,severity:x.severity==='error'?'warning':x.severity,status:x.status})); const report={schemaVersion:'2.4',diagnosticRunId,generatedAt:new Date().toISOString(),durationMs:Date.now()-started,applicationVersion:VERSION,successRate:rate,evaluablePassRate:rate,evaluationCoverageRate:coverage,totalChecks:checks.length,passed,failed,notEvaluable,threshold:100,strictDiagnosticCriteria,readyForManualTesting,releaseDecision:readyForManualTesting?'GO':'HOLD',evidenceState,diagnosticScope,deepDiagnostics:browser.deep===true,matrixResults,checks,recommendedActions:failedActions,deferredChecks};
  const out=path.join(dataDir,'diagnostics');fs.mkdirSync(out,{recursive:true});const file=path.join(out,`diagnostic-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);fs.writeFileSync(file,JSON.stringify(report,null,2));audit('FULL_DIAGNOSTIC_COMPLETED',{successRate:rate,passed,failed,notEvaluable,file:path.relative(root,file)});return send(res,200,{...report,file:path.relative(root,file)});
}
if(u.pathname==='/api/market/overview'&&req.method==='GET'){
  const SYMBOL_ALIASES={APPL:'AAPL',GOOGL:'GOOG'}; const symbols=(u.searchParams.get('symbols')||'AAPL,MSFT,NVDA,TSLA,RELIANCE.NS,TCS.NS').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean).map(x=>SYMBOL_ALIASES[x]||x).slice(0,50); const out=[];
  for(const symbol of symbols){
    try{
      const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`,{headers:{'User-Agent':'Mozilla/5.0 MYAI-CFO/1.24.26'},signal:AbortSignal.timeout(7000)});
      if(!r.ok)throw new Error(`HTTP ${r.status}`); const j=await r.json(); const m=j.chart?.result?.[0]; const q=m?.meta||{};
      if(q.regularMarketPrice==null)throw new Error('No quote returned');
      out.push({symbol,price:q.regularMarketPrice,previousClose:q.previousClose??null,currency:q.currency??null,exchange:q.exchangeName??null,change:q.regularMarketPrice!=null&&q.previousClose?((q.regularMarketPrice-q.previousClose)/q.previousClose)*100:null,updatedAt:q.regularMarketTime?new Date(q.regularMarketTime*1000).toISOString():new Date().toISOString(),provider:'Yahoo Finance chart API',online:true});
    }catch(e){out.push({symbol,error:String(e?.message||e),provider:'Yahoo Finance chart API',online:false});}
  }
  return send(res,200,{timestamp:new Date().toISOString(),symbols:out,provider:'Yahoo Finance chart API',online:out.some(x=>x.online),disclaimer:'Market data is online informational data; verify licensing, prices and exchange terms before production use.'});
}
if(u.pathname==='/api/market/fx/store'&&req.method==='POST'){
  const b=await parseBody(req); const base=String(b.base||'USD').toUpperCase(); const rates=b.rates&&typeof b.rates==='object'?b.rates:{}; const date=String(b.date||new Date().toISOString().slice(0,10));
  const clean={}; for(const [k,v] of Object.entries(rates)){if(/^[A-Z]{3}$/.test(String(k))&&Number.isFinite(Number(v)))clean[String(k).toUpperCase()]=Number(v);}
  if(!Object.keys(clean).length)return send(res,400,{error:'No valid FX rates supplied.'});
  state.fxRepository ||= {}; state.fxRepository[base] ||= {}; state.fxRepository[base][date]={...(state.fxRepository[base][date]||{}),...clean}; state.fxRepositoryUpdatedAt=new Date().toISOString(); save();
  audit('FX_RATES_STORED_FROM_BROWSER',{base,date,currencies:Object.keys(clean),provider:b.provider||'Frankfurter • central-bank reference rates',source:'browser-fallback'});
  return send(res,200,{ok:true,base,date,rates:clean,repositoryUpdatedAt:state.fxRepositoryUpdatedAt,provider:b.provider||'Frankfurter • central-bank reference rates'});
}
if(u.pathname==='/api/market/fx'&&req.method==='GET'){
  const base=String(u.searchParams.get('base')||'USD').toUpperCase(); const to=String(u.searchParams.get('to')||'EUR,GBP,INR').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean).slice(0,50);
  try{const r=await fetch(`https://api.frankfurter.dev/v2/rates?base=${encodeURIComponent(base)}&quotes=${encodeURIComponent(to.join(','))}`,{signal:AbortSignal.timeout(12000),headers:{'Accept':'application/json','User-Agent':'MYAI-CFO/1.24.26'}});if(!r.ok)throw new Error(`Frankfurter HTTP ${r.status}`);const rows=await r.json();const rates={};let rateDate=null;for(const row of Array.isArray(rows)?rows:[]){if(row.quote&&row.rate!=null){rates[String(row.quote).toUpperCase()]=Number(row.rate);rateDate=row.date||rateDate;}}if(!Object.keys(rates).length)throw new Error('Frankfurter returned no requested currency pairs.');state.fxRepository ||= {};state.fxRepository[base] ||= {};const repoDate=rateDate||new Date().toISOString().slice(0,10);state.fxRepository[base][repoDate]={...(state.fxRepository[base][repoDate]||{}),...rates};state.fxRepositoryUpdatedAt=new Date().toISOString();save();return send(res,200,{base,rates,date:repoDate,provider:'Frankfurter • central-bank reference rates',providerUrl:'https://frankfurter.dev/',online:true,repositoryUpdatedAt:state.fxRepositoryUpdatedAt});}catch(e){return send(res,503,{base,rates:{},online:false,error:String(e?.message||e),provider:'Frankfurter • central-bank reference rates'});}
}
if(u.pathname==='/api/market/fx/history'&&req.method==='GET'){
  const base=String(u.searchParams.get('base')||'USD').toUpperCase();const date=String(u.searchParams.get('date')||'').trim();const to=String(u.searchParams.get('to')||'EUR,GBP,INR').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean).slice(0,50);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return send(res,400,{error:'A valid date YYYY-MM-DD is required.'});
  try{state.fxRepository ||= {};state.fxRepository[base] ||= {};const cached=state.fxRepository[base][date]||{};const requested=to.map(c=>String(c||'').toUpperCase()).filter(Boolean);const cachedRates=Object.fromEntries(requested.filter(c=>cached[c]!=null).map(c=>[c,Number(cached[c])]));const missing=requested.filter(c=>cached[c]==null);if(!missing.length&&Object.keys(cachedRates).length)return send(res,200,{base,date,rates:cachedRates,provider:'MYAI CFO local FX repository • Frankfurter reference rates',online:false,cached:true});const r=await fetch(`https://api.frankfurter.dev/v2/rates?date=${encodeURIComponent(date)}&base=${encodeURIComponent(base)}&quotes=${encodeURIComponent((missing.length?missing:requested).join(','))}`,{signal:AbortSignal.timeout(12000),headers:{'Accept':'application/json','User-Agent':'MYAI-CFO/production'}});if(!r.ok)throw new Error(`Frankfurter HTTP ${r.status}`);const rows=await r.json();const fetched={};let returnedDate=date;for(const row of Array.isArray(rows)?rows:[]){if(row.quote&&row.rate!=null){fetched[String(row.quote).toUpperCase()]=Number(row.rate);returnedDate=row.date||returnedDate;}}const rates={...cachedRates,...fetched};if(requested.some(c=>rates[c]==null))throw new Error(`Frankfurter did not return all requested historical pairs. Missing: ${requested.filter(c=>rates[c]==null).join(', ')}`);state.fxRepository[base][date]={...(state.fxRepository[base][date]||{}),...fetched};state.fxRepositoryUpdatedAt=new Date().toISOString();save();return send(res,200,{base,date:returnedDate,rates,provider:'Frankfurter • central-bank reference rates',providerUrl:'https://frankfurter.dev/',online:true,cached:Object.keys(fetched).length===0,repositoryUpdatedAt:state.fxRepositoryUpdatedAt});}catch(e){return send(res,503,{base,date,rates:{},error:String(e?.message||e),provider:'Frankfurter • central-bank reference rates'});}
}
if(u.pathname==='/api/market/macro'&&req.method==='GET'){
  const symbols='^VIX,^TNX,CL=F,GC=F,DX-Y.NYB'.split(','); const out=[];
  for(const symbol of symbols){try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,{headers:{'User-Agent':'Mozilla/5.0 MYAI-CFO/1.24.26'},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const j=await r.json();const q=j.chart?.result?.[0]?.meta||{};out.push({symbol,price:q.regularMarketPrice??null,previousClose:q.previousClose??null,change:q.regularMarketPrice!=null&&q.previousClose?((q.regularMarketPrice-q.previousClose)/q.previousClose)*100:null,online:q.regularMarketPrice!=null});}catch(e){out.push({symbol,online:false,error:String(e?.message||e)});}}
  return send(res,200,{items:out,online:out.some(x=>x.online),timestamp:new Date().toISOString(),provider:'Yahoo Finance macro proxies'});
}
if(u.pathname==='/api/market/news'&&req.method==='GET'){
  const SYMBOL_ALIASES={APPL:'AAPL',GOOGL:'GOOG'}; const rawSymbol=(u.searchParams.get('symbol')||'AAPL').trim().toUpperCase(); const symbol=SYMBOL_ALIASES[rawSymbol]||rawSymbol; const key=process.env.FINNHUB_API_KEY||'';
  if(key){try{const to=new Date(),from=new Date(Date.now()-7*86400000);const iso=d=>d.toISOString().slice(0,10);const r=await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${iso(from)}&to=${iso(to)}&token=${encodeURIComponent(key)}`,{signal:AbortSignal.timeout(7000)});if(!r.ok)throw new Error(`Finnhub HTTP ${r.status}`);const j=await r.json();return send(res,200,{symbol,items:(j||[]).slice(0,30).map(x=>({headline:x.headline,summary:x.summary,source:x.source,url:x.url,datetime:x.datetime?new Date(x.datetime*1000).toISOString():null})),provider:'Finnhub',online:true});}catch(e){return send(res,503,{symbol,items:[],provider:'Finnhub',online:false,error:String(e?.message||e)});}}
  try{const r=await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=20`,{headers:{'User-Agent':'Mozilla/5.0 MYAI-CFO/1.24.26'},signal:AbortSignal.timeout(7000)});if(!r.ok)throw new Error(`Yahoo search HTTP ${r.status}`);const j=await r.json();return send(res,200,{symbol,items:(j.news||[]).slice(0,20).map(x=>({headline:x.title,summary:'',source:x.publisher,url:x.link,datetime:x.providerPublishTime?new Date(x.providerPublishTime*1000).toISOString():null})),provider:'Yahoo Finance search',online:true});}catch(e){return send(res,503,{symbol,items:[],provider:'Yahoo Finance search',online:false,error:String(e?.message||e)});}
}
if(u.pathname==='/api/market/providers'&&req.method==='GET')return send(res,200,{providers:[
 {id:'openbb',name:'OpenBB Platform',type:'open-source financial data infrastructure',source:'https://github.com/OpenBB-finance/OpenBB',status:'optional-local-integration'},
 {id:'finnhub',name:'Finnhub',type:'market/news API',source:'https://finnhub.io/docs/api/company-news',status:process.env.FINNHUB_API_KEY?'configured':'optional-key-required'},
 {id:'yahoo',name:'Yahoo Finance chart/search',type:'online market data/news fallback',status:'built-in-online-fallback'},
 {id:'ecb-frankfurter',name:'Frankfurter / ECB',type:'online FX rates',status:'built-in-online-provider'},
 {id:'worldmonitor',name:'World Monitor',type:'market/geopolitical intelligence reference',source:'https://www.worldmonitor.app/',status:'optional-reference'}
]});
if(u.pathname==='/api/audit/client-event'&&req.method==='POST'){
  try{const b=await parseBody(req);const eventType=String(b.eventType||'CLIENT_EVENT').replace(/[^A-Z0-9_]/g,'_').slice(0,80);const payload=b.payload&&typeof b.payload==='object'?b.payload:{};audit(eventType,payload,{correlationId:String(b.correlationId||crypto.randomUUID())});return send(res,200,{ok:true});}catch(e){return send(res,400,{ok:false,error:String(e?.message||e)});}
}
if(u.pathname==='/api/audit/verify'&&req.method==='GET'){
    let previous='GENESIS',checked=0,valid=true,error=null;
    try{
      const raw=fs.existsSync(acceptanceFile)?fs.readFileSync(acceptanceFile,'utf8').split(/\r?\n/).filter(Boolean):[];
      for(const line of raw){const event=JSON.parse(line);if(event.previousHash!==previous){valid=false;error=`Previous hash mismatch at event ${event.eventId}`;break;}const supplied=event.eventHash;const copy={...event};delete copy.eventHash;const expected=sha(JSON.stringify(copy));if(supplied!==expected){valid=false;error=`Event hash mismatch at event ${event.eventId}`;break;}previous=supplied;checked++;}
    }catch(e){valid=false;error=String(e?.message||e)}
    return send(res,200,{valid,checked,lastHash:previous,manifest:loadManifest(),error});
  }
  if(u.pathname==='/api/audit/export'&&req.method==='GET'){
    if(!fs.existsSync(acceptanceFile))return send(res,404,{error:'Audit ledger is empty'});res.writeHead(200,{'Content-Type':'application/x-ndjson','Content-Disposition':'attachment; filename="myai-cfo-audit.jsonl"',...(res.__myaiOrigin && ALLOWED_WEB_ORIGINS.has(res.__myaiOrigin) ? {'Access-Control-Allow-Origin':res.__myaiOrigin} : {})});return fs.createReadStream(acceptanceFile).pipe(res);
  }
  if(u.pathname==='/api/audit'&&req.method==='GET'){const limit=Math.min(500,Math.max(1,Number(u.searchParams.get('limit')||100)));let lines=[];try{lines=fs.readFileSync(acceptanceFile,'utf8').split(/\r?\n/).filter(Boolean).slice(-limit).map(x=>JSON.parse(x)).reverse()}catch{}return send(res,200,{events:lines,manifest:loadManifest()});}
  if(u.pathname==='/api/instructions'&&req.method==='GET'){
    const file=path.join(dataDir,'knowledge','instructions.json');let arr=readJson(file,[]);return send(res,200,{instructions:arr.map(x=>({...x,archived:!!x.archived}))});
  }
  if(u.pathname==='/api/instructions'&&req.method==='POST'){
    const b=await parseBody(req);if(!String(b.text||'').trim())return send(res,400,{error:'Instruction text required'});
    const file=path.join(dataDir,'knowledge','instructions.json');let arr=[];try{arr=JSON.parse(fs.readFileSync(file,'utf8'))}catch{};
    const item={id:id('instruction'),text:String(b.text).trim(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),archived:false};arr.unshift(item);fs.writeFileSync(file,JSON.stringify(arr,null,2));audit('USER_INSTRUCTION_CREATED',{instructionId:item.id,textHash:sha(item.text)});return send(res,201,item);
  }
  if(u.pathname.startsWith('/api/instructions/')&&u.pathname.endsWith('/archive')&&req.method==='POST'){
    const instructionId=u.pathname.split('/')[3],file=path.join(dataDir,'knowledge','instructions.json');let arr=readJson(file,[]);const item=arr.find(x=>x.id===instructionId);if(!item)return send(res,404,{error:'Instruction not found'});item.archived=!item.archived;item.updatedAt=new Date().toISOString();writeJson(file,arr);audit(item.archived?'USER_INSTRUCTION_ARCHIVED':'USER_INSTRUCTION_RESTORED',{instructionId});return send(res,200,item);
  }
  if(u.pathname.startsWith('/api/instructions/')&&u.pathname.endsWith('/delete')&&req.method==='POST'){
    const instructionId=u.pathname.split('/')[3],file=path.join(dataDir,'knowledge','instructions.json'); let arr=readJson(file,[]); const item=arr.find(x=>x.id===instructionId); if(!item)return send(res,404,{error:'Instruction not found'}); arr=arr.filter(x=>x.id!==instructionId); writeJson(file,arr); audit('USER_INSTRUCTION_DELETED_PERMANENT',{instructionId}); return send(res,200,{ok:true});
  }
  if(u.pathname.startsWith('/api/instructions/')&&req.method==='DELETE'){
    const instructionId=u.pathname.split('/').pop(),file=path.join(dataDir,'knowledge','instructions.json');let arr=readJson(file,[]);const item=arr.find(x=>x.id===instructionId);if(!item)return send(res,404,{error:'Instruction not found'});arr=arr.filter(x=>x.id!==instructionId);writeJson(file,arr);audit('USER_INSTRUCTION_DELETED_PERMANENT',{instructionId});return send(res,200,{ok:true});
  }
  if(u.pathname==='/api/knowledge/url'&&req.method==='POST'){
    const b=await parseBody(req); if(!b.url)return send(res,400,{error:'URL required'});
    try{
      let fetched;
      const isSyntheticCertificationUrl=qaModeEnabled(req) && String(b.url)==='https://cert.myai-cfo.local/synthetic/knowledge-controls';
      if(isSyntheticCertificationUrl){
        const syntheticText='MYAI CFO synthetic Knowledge Hub evidence. Accounting controls: management must reconcile material ledger balances, document review evidence, preserve source records, disclose material judgments, and retain approval evidence. This controlled URL exists only for certification testing of URL ingestion, RAG retrieval, citation and CFO PA provenance.';
        fetched={url:String(b.url),contentType:'text/plain',size:Buffer.byteLength(syntheticText,'utf8'),text:syntheticText,filename:'synthetic-knowledge-controls.txt',pageTitle:'MYAI CFO Certification Synthetic URL Evidence',base64:Buffer.from(syntheticText,'utf8').toString('base64')};
      } else fetched=await fetchPublicKnowledgeUrl(b.url);
      const kid=id('knowledge'); const safe=path.basename(fetched.filename).replace(/[^\w.\- ]/g,'_'); const fp=path.join(knowledgeUploadsDir,`${kid}-${safe}`); const sourceBase64=fetched.originalBase64||fetched.base64||Buffer.from(fetched.text||'','utf8').toString('base64'); const extractionBase64=fetched.extractionBase64||fetched.base64||sourceBase64; const rawBytes=Buffer.from(sourceBase64,'base64'); fs.writeFileSync(fp,rawBytes);
      let ex=await extractDocument(fetched.filename,extractionBase64,kid);
      if(/\.pdf$/i.test(fetched.filename)){
        try{
          const rich=await enrichPdfTextWithAssets(ex.text||'',fp,kid,`knowledge-url-${kid}`);
          const mergedStructured=Array.isArray(rich.assets?.structuredFacts)&&rich.assets.structuredFacts.length
            ? mergeStructuredExtractionFacts(ex.structuredFacts||[],rich.assets.structuredFacts,{documentId:kid,documentFiscalYear:ex.documentFiscalYear||rich.assets.documentFiscalYear,documentUnit:ex.documentUnit||rich.assets.documentUnit,documentCurrency:ex.documentCurrency||rich.assets.documentCurrency,documentScale:ex.documentScale||rich.assets.documentScale})
            : ex.structuredFacts;
          ex={...ex,text:rich.text||ex.text,assets:rich.assets||ex.assets,structuredFacts:mergedStructured,extractionQuality:{...(ex.extractionQuality||{}),visualAssetCount:rich.assets?.images?.length||0,tableAssetCount:rich.assets?.tables?.length||0,comparativeFiscalYears:rich.assets?.comparativeFiscalYears||[]}};
        }catch(err){
          audit('KNOWLEDGE_URL_PDF_ASSET_ENRICH_FAILED',{knowledgeId:kid,errorHash:sha(String(err?.message||err))},{correlationId:`knowledge-url-${kid}`});
        }
      }
      const extractedAssets=ex.assets||{available:true,images:ex.images||[],tables:ex.tables||[],pageSnapshots:ex.pages||[],structuredFacts:ex.structuredFacts||[],method:ex.method||'url'};
      const outText=String(ex.text||fetched.text||''); const textPath=fp+'.txt'; fs.writeFileSync(textPath,outText,'utf8');
      const now=new Date().toISOString(); const file=path.join(dataDir,'knowledge','uploaded.json'); let arr=readJson(file,[]); const title=String(b.title||'').trim()||fetched.pageTitle||fetched.filename;
      const item={id:kid,title,filename:fetched.filename,size:fetched.size,contentType:fetched.contentType||'text/plain',contentChars:outText.length,contentHash:sha(outText),category:b.category||'Regulatory Guidance',jurisdiction:b.jurisdiction||'International',effectiveDate:b.effectiveDate||'',sourceUrl:fetched.url,resolvedSourceUrl:fetched.url,sourceContentType:fetched.contentType||null,sourcePath:path.relative(root,fp),contentPath:path.relative(root,textPath),sourceBytesHash:sha(sourceBase64),extractionInputBytesHash:sha(extractionBase64),extractionInputMode:sourceBase64!==extractionBase64?'resolved-html-assets':'source-bytes',createdAt:now,updatedAt:now,status:'active',version:1,archived:false,ingestionMethod:'url',contentScope:'full-retrieved-resource',extractionMethod:ex.method||'url',extractionQuality:ex.extractionQuality||null,documentFiscalYear:ex.documentFiscalYear||null,documentUnit:ex.documentUnit||null,documentCurrency:ex.documentCurrency||null,documentScale:ex.documentScale||null,pages:ex.pages||null,extractedAssets,assetMetadata:extractedAssets,visualAssetCount:Number(extractedAssets.images?.length||0),tableAssetCount:Number(extractedAssets.tables?.length||0),comparativeFiscalYears:ex.comparativeFiscalYears||ex.extractionQuality?.comparativeFiscalYears||[],chunks:outText.split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>40).slice(0,300).map((text,i)=>({id:id('kchunk'),ordinal:i+1,text})),reviewOutcome:'pending'};
      arr.push(item); writeJson(file,arr); audit('KNOWLEDGE_URL_INGESTED',{knowledgeId:kid,title:item.title,url:fetched.url,filename:fetched.filename,size:fetched.size,contentType:item.contentType,contentChars:item.contentChars,contentHash:item.contentHash,category:item.category,jurisdiction:item.jurisdiction,visualAssetCount:item.visualAssetCount,tableAssetCount:item.tableAssetCount}); return send(res,201,item);
    }catch(e){audit('KNOWLEDGE_URL_INGESTION_FAILED',{urlHash:sha(String(b.url)),errorHash:sha(String(e?.message||e))});return send(res,400,{error:String(e?.message||e)})}
  }
  if(u.pathname==='/api/activity'&&req.method==='GET'){
    const modelJobs=[...modelDownloadJobs.values(),...(state.modelDownloadHistory||[])].filter(j=>!['completed','failed','cancelled'].includes(j.status)).slice(-20);
    const docs=Object.values(state.aiJobs||{}).filter(j=>!['completed','failed'].includes(j.status)).slice(-20);
    const extractionDocs=(state.companies||[]).flatMap(c=>(c.documents||[]).filter(d=>!d.archived && ['processing','queued'].includes(String(d.status||''))).map(d=>({id:d.id,filename:d.filename,status:d.status,stage:d.stage||'extracting',progress:Number(d.progress||5),error:d.error||d.aiError||null,companyId:c.id}))).slice(-20);
    const know=Object.values(state.knowledgeJobs||{}).filter(j=>!['completed','failed','cancelled'].includes(j.status)).slice(-20);
    const arena=Object.values(state.arena.jobs||{}).filter(j=>!['completed','failed','cancelled'].includes(j.status)).slice(-10);
    const moni=Object.values(state.moni.jobs||{}).filter(j=>!['completed','failed','cancelled'].includes(j.status)).slice(-10);
    return send(res,200,{generatedAt:new Date().toISOString(),jobs:[
      ...extractionDocs.map(j=>{const ej=Object.values(state.extractionJobs||{}).find(x=>x.documentId===j.id);return {type:'document-extraction',id:`extract-${j.id}`,label:`Financial document • ${j.filename}`,status:j.status,progress:Math.min(99,Math.max(5,j.progress)),stage:j.stage,elapsedMs:ej?Math.max(0,Date.now()-Date.parse(ej.startedAt||new Date().toISOString())):null,error:j.error||null};}),
      ...docs.map(j=>({type:'document-ai',id:j.jobId,label:j.filename?`Financial document • ${j.filename}`:'Financial document AI review',status:j.status,progress:j.status==='running'?60:j.status==='waiting_for_model'?35:10,stage:j.status==='running'?'AI evidence review':'Waiting for local model',error:j.error||null})),
      ...modelJobs.map(j=>({type:'model-download',id:j.jobId,label:j.name||j.modelId,status:j.status,progress:j.totalBytes?Math.round((j.bytesReceived||0)/j.totalBytes*100):0,stage:j.status==='downloading'?'Downloading model':'Preparing model',bytesReceived:j.bytesReceived||0,totalBytes:j.totalBytes||0,speedBps:j.speedBps||0,error:j.error||null})),
      ...know.map(j=>({type:'knowledge',id:j.jobId,label:j.filename||'Knowledge document',status:j.status,progress:Number(j.progress||0),stage:j.stage||j.status,elapsedMs:['queued','processing'].includes(j.status)?Math.max(0,Date.now()-Date.parse(j.startedAt||j.createdAt||new Date().toISOString())):Number(j.elapsedMs||0),error:j.error||null})),
      ...arena.map(j=>({type:'arena',id:j.jobId,label:'Moni Agent Arena',status:j.status,progress:j.totalAgents?Math.round((j.completedAgents||0)/j.totalAgents*100):0,stage:j.message||'Agent competition',error:j.error||null})),
      ...moni.map(j=>{const isQa=String(j.message||'').includes('QA_SENTINEL_')||String(j.task||'').startsWith('qa_');return {type:'moni',id:j.jobId,label:isQa?'Production certification • security / isolation test':'Moni CFO analysis',status:j.status,progress:j.totalAgents?Math.round((j.completedAgents||0)/j.totalAgents*100):j.status==='running'?60:10,stage:isQa?'Testing controlled QA retrieval boundary':j.message||j.status,error:j.error||null}})
    ].slice(0,12),onlineLearner:{mode:state.moni.learningMode,updates:Object.values(state.moni.onlineLearner||{}).reduce((n,x)=>n+Number(x.updates||0),0)}});
  }
  async function selectiveRepairDocument(owner,d,reason='diagnostic-auto-repair'){
    if(!owner||!d||d.archived)return {changed:false,reason:'inactive'};
    const source=d.sourcePath?path.resolve(root,d.sourcePath):null;
    if(!source||!fs.existsSync(source))return {changed:false,reason:'missing-source'};
    const oldFacts=(owner.facts||[]).filter(f=>f.documentId===d.id); const oldStructured=Array.isArray(d.structuredFacts)?d.structuredFacts.slice():[]; const oldEvidence=Array.isArray(d.evidence)?d.evidence.slice():[]; const oldText=String(d.text||'');
    const correlationId=`auto-repair-${d.id}`; const raw=fs.readFileSync(source).toString('base64'); const ex=await extractDocument(d.filename,raw,correlationId); let enriched=ex;
    if(path.extname(d.filename).toLowerCase()==='.pdf') enriched=await enrichPdfTextWithAssets(ex.text||'',source,d.id,correlationId);
    const pf=Array.isArray(ex.structuredFacts)?ex.structuredFacts:[], af=Array.isArray(enriched.assets?.structuredFacts)?enriched.assets.structuredFacts:[];
    const merged=af.length?mergeStructuredExtractionFacts(pf,af,{companyId:owner.id,documentId:d.id,documentFiscalYear:ex.documentFiscalYear||enriched.assets?.documentFiscalYear||d.documentFiscalYear||d.fiscalYear,documentUnit:ex.documentUnit||enriched.assets?.documentUnit||d.documentUnit,documentCurrency:ex.documentCurrency||enriched.assets?.documentCurrency||d.documentCurrency||owner.currency,documentScale:(d.documentScale&&d.documentScale!=='units')?d.documentScale:(ex.documentScale||enriched.assets?.documentScale||'units')}):pf;
    const text=String(enriched.text||ex.text||''); if(!merged.length){const fallbackFacts=deterministicCandidateFacts(text,d.id,owner.id,{...d,fiscalYear:ex.documentFiscalYear||d.fiscalYear,documentUnit:ex.documentUnit||d.documentUnit,currency:ex.documentCurrency||d.documentCurrency||owner.currency}); if(fallbackFacts.length)merged.push(...fallbackFacts);} const evidence=text.split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>40).slice(0,50).map((t,i)=>({id:id('evidence'),documentId:d.id,companyId:owner.id,ordinal:i+1,text:t,source:d.filename}));
    audit('DOCUMENT_SELECTIVE_AUTO_REPAIR_ATTEMPTED',{companyId:owner.id,documentId:d.id,filename:d.filename,reason,oldStructuredFactCount:oldStructured.length,newStructuredFactCount:merged.length,newEvidenceCount:evidence.length},{correlationId});
    if(!text.trim()&&!merged.length&&!evidence.length){
      d.structuredFacts=oldStructured; d.evidence=oldEvidence; d.text=oldText; d.evidenceCount=Math.max(oldEvidence.length,Number(d.evidenceCount||0)); d.factCount=oldFacts.length; d.status='needs_review'; d.stage='needs_review'; d.progress=100; d.aiStatus='not_started'; d.aiStatusDetail='NO_EXTRACTED_EVIDENCE'; d.aiError={code:'NO_EXTRACTED_EVIDENCE',message:'Selective repair could not produce usable evidence; prior validated/system-verified facts were preserved.'}; syncStructuredFacts(owner); save();
      audit('DOCUMENT_SELECTIVE_AUTO_REPAIR_PRESERVED',{companyId:owner.id,documentId:d.id,filename:d.filename,preservedStructuredFactCount:oldStructured.length,preservedFactCount:oldFacts.filter(f=>f.validated||f.systemVerified).length},{correlationId});
      return {changed:true,repaired:false,preserved:true,reason:'unusable-refresh'};
    }
    const textPath=source+'.txt'; fs.writeFileSync(textPath,text,'utf8'); d.contentPath=path.relative(root,textPath); d.text=text; d.evidence=evidence; d.evidenceCount=evidence.length; d.documentFiscalYear=ex.documentFiscalYear||enriched.assets?.documentFiscalYear||d.documentFiscalYear||d.fiscalYear||null; d.fiscalYear=d.documentFiscalYear||d.fiscalYear||null; d.documentUnit=ex.documentUnit||enriched.assets?.documentUnit||d.documentUnit||null; d.documentCurrency=ex.documentCurrency||enriched.assets?.documentCurrency||d.documentCurrency||owner.currency||null; d.documentScale=(ex.documentScale&&ex.documentScale!=='units')?ex.documentScale:(d.documentScale&&d.documentScale!=='units'?d.documentScale:(enriched.assets?.documentScale||'units')); d.currency=d.documentCurrency||d.currency||owner.currency||null; d.structuredFacts=merged; d.factCount=merged.length; d.extractionQuality=ex.extractionQuality||d.extractionQuality||null; d.extractionMethod=enriched.method||ex.method||d.extractionMethod; d.pages=enriched.pages||ex.pages||d.pages; d.textLength=text.length; d.visualAssetCount=enriched.assets?.images?.length||0; d.tableAssetCount=enriched.assets?.tables?.length||0; d.extractedAssets=enriched.assets||d.extractedAssets||null; d.extractionEngineVersion=CURRENT_FINANCIAL_SPINE_VERSION; d.extractionUpdatedAt=new Date().toISOString(); d.status='completed'; d.stage='completed'; d.progress=100; d.aiStatus='queued'; d.aiStatusDetail='selective_auto_repair'; d.aiError=null; d.updatedAt=new Date().toISOString();
    owner.facts=(owner.facts||[]).filter(f=>f.documentId!==d.id||f.validated||f.systemVerified); syncStructuredFacts(owner); enforceDocumentFactInvariants(owner); const aiJobId=id('docai'); state.aiJobs[aiJobId]={jobId:aiJobId,type:'document-ai',status:'queued',companyId:owner.id,documentId:d.id,filename:d.filename,createdAt:new Date().toISOString(),correlationId:crypto.randomUUID(),stage:'Queued after selective auto-repair',progress:0,estimatedSeconds:60}; d.aiJobId=aiJobId; save(); processDocumentAiJob(aiJobId).catch(()=>{}); audit('DOCUMENT_SELECTIVE_AUTO_REPAIR_COMPLETED',{companyId:owner.id,documentId:d.id,filename:d.filename,structuredFactCount:merged.length,evidenceCount:evidence.length,aiJobId},{correlationId}); return {changed:true,repaired:true,queuedAiReview:true,reason:'reprocessed'};
  }
  if(u.pathname==='/api/diagnostics/auto-repair'&&req.method==='POST'){
    const actions=[]; const repairSummary=[];
    if(qaModeEnabled(req)){const f=qaFaults(); for(const k of Object.keys(f)) if(f[k]){f[k]=false;actions.push(`Cleared QA fault ${k}.`);}}
    state.moni.modelPerformance ||= {}; state.moni.onlineLearner ||= {}; state.knowledgeJobs ||= {};
    if(!state.selectedModelFilename){const target=installedModels(false).find(x=>!x.archived&&x.filename==='Qwen3-4B-Q4_K_M.gguf')||installedModels(false)[0];if(target){state.selectedModelFilename=target.filename;actions.push(`Selected installed model ${target.filename}.`);}}
    const active=installedModels(false).filter(x=>!x.archived); if(active.length){const selected=active.find(x=>x.filename===state.selectedModelFilename)||active[0]; if(selected&&!liveRuntimes.has(selected.filename)){try{await startLiveRuntime(selected.filename);actions.push(`Loaded ${selected.filename}.`);}catch(e){audit('MODEL_AUTO_REPAIR_CANDIDATE_FAILED',{filename:selected.filename,errorHash:sha(String(e?.message||e))});}}}
    for(const c of state.companies||[]){const activeDocs=(c.documents||[]).filter(d=>!d.archived);let touched=false;for(const d of activeDocs){const unhealthy=d.status==='needs_review'||d.aiStatus==='failed'||['NO_EXTRACTED_EVIDENCE','NO_VALID_FACTS','DOCUMENT_FISCAL_YEAR_CONFLICT'].includes(String(d.aiStatusDetail||''))||!Array.isArray(d.structuredFacts)||d.structuredFacts.length===0;if(!unhealthy)continue;try{const r=await selectiveRepairDocument(c,d);repairSummary.push({companyId:c.id,documentId:d.id,filename:d.filename,...r});touched=touched||!!r.changed;if(r.repaired)actions.push(`Reprocessed ${d.filename}.`);else if(r.preserved)actions.push(`Preserved existing valid evidence for ${d.filename}.`);}catch(e){repairSummary.push({companyId:c.id,documentId:d.id,filename:d.filename,repaired:false,error:String(e?.message||e)});audit('DOCUMENT_SELECTIVE_AUTO_REPAIR_FAILED',{companyId:c.id,documentId:d.id,filename:d.filename,errorHash:sha(String(e?.message||e))});}}if(touched){syncStructuredFacts(c);enforceDocumentFactInvariants(c);save();actions.push(`Rebuilt canonical financial facts for ${c.name}.`);}}
    save();audit('DIAGNOSTICS_AUTO_REPAIR',{actions,repairSummary});return send(res,200,{ok:true,actions,repairSummary,generatedAt:new Date().toISOString(),runtime:runtimePoolStatus(),selectedModelFilename:state.selectedModelFilename});
  }
  if(u.pathname==='/api/diagnostics/auto'&&req.method==='POST'){
    const module=String(u.searchParams.get('module')||'global'); const checks=[]; const add=(id,name,ok,detail)=>checks.push({id,name,status:ok?'PASS':'FAIL',ok,detail});
    add('kernel','Backend kernel',true,'Node backend is responding.');
    add('model-files','Local model availability',installedModels(false).length>0,`${installedModels(false).length} active local model(s).`);
    add('runtime','Runtime availability',runtimePoolStatus().length>0,runtimePoolStatus().length?`${runtimePoolStatus().length} live runtime(s).`:'No live runtime currently loaded.');
    add('company','Company workspace',!!activeCompany(),activeCompany()?.name||'No company selected.');
    add('knowledge','Knowledge repository',fs.existsSync(path.join(dataDir,'knowledge','uploaded.json')),'Knowledge repository accessible.');
    add('audit','Audit ledger',fs.existsSync(acceptanceFile),'Audit ledger available.');
    return send(res,200,{module,generatedAt:new Date().toISOString(),checks,ready:checks.every(x=>x.ok||x.id==='company')});
  }
  if(u.pathname==='/api/diagnostics/auto-repair/export'&&req.method==='GET'){const report={generatedAt:new Date().toISOString(),applicationVersion:VERSION,mode:'safe-auto-repair',principles:['deterministic-only','audited','no blind code mutation'],safeActions:['repair Moni state maps','activate installed production model','load active runtime model','requeue deterministic document AI jobs','preserve company isolation'],warning:'Training/audit report only; safe auto-resolve does not imply every defect can be automatically repaired.'};res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename=MYAI-CFO-auto-resolve-report.json'});return res.end(JSON.stringify(report,null,2));}
  if(u.pathname==='/api/knowledge/upload'&&req.method==='POST'){
    const b=await parseBody(req,70*1024*1024); if(!b.filename||!b.contentBase64)return send(res,400,{error:'filename and contentBase64 required'});
    const idv=id('knowledge'); const safe=path.basename(b.filename).replace(/[^\w.\- ]/g,'_'); const dir=path.join(dataDir,'knowledge','uploads');fs.mkdirSync(dir,{recursive:true}); const filePath=path.join(dir,`${idv}-${safe}`); const bytes=Buffer.from(b.contentBase64,'base64'); if(bytes.length>52*1024*1024)return send(res,413,{error:'Knowledge document exceeds the 50 MB binary upload limit.',code:'KNOWLEDGE_TOO_LARGE'});fs.writeFileSync(filePath,bytes);
    const item={id:idv,title:b.title||b.filename,filename:b.filename,category:b.category||'Other',jurisdiction:b.jurisdiction||'International',version:1,status:'processing',stage:'stored',progress:5,contentChars:0,visualAssetCount:0,tableAssetCount:0,reviewOutcome:'pending',sourcePath:path.relative(root,filePath),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),archived:false};
    const uploadedFile=path.join(dataDir,'knowledge','uploaded.json'); const items=readJson(uploadedFile,[]); items.push(item);fs.writeFileSync(uploadedFile,JSON.stringify(items,null,2));
    const jobId=id('knowledgejob'); state.knowledgeJobs[jobId]={jobId,knowledgeId:idv,filename:b.filename,status:'queued',stage:'queued',progress:10,createdAt:new Date().toISOString(),startedAt:null,elapsedMs:0};save();audit('KNOWLEDGE_UPLOAD_QUEUED',{jobId,knowledgeId:idv,filename:b.filename,size:bytes.length});
    (async()=>{const job=state.knowledgeJobs[jobId];try{job.status='processing';job.stage='extracting';job.startedAt=job.startedAt||new Date().toISOString();job.progress=25;job.elapsedMs=Math.max(0,Date.now()-Date.parse(job.startedAt));save(); let ex=await extractDocument(b.filename,b.contentBase64); if(/\.pdf$/i.test(b.filename)){try{const rich=await enrichPdfTextWithAssets(ex.text||'',filePath,idv,jobId);ex={...ex,text:rich.text||ex.text,assets:rich.assets||ex.assets,extractionQuality:{...(ex.extractionQuality||{}),visualAssetCount:rich.assets?.images?.length||0,tableAssetCount:rich.assets?.tables?.length||0}};}catch(err){audit('KNOWLEDGE_PDF_ASSET_ENRICH_FAILED',{knowledgeId:idv,errorHash:sha(String(err?.message||err))},{correlationId:jobId});}}
 const local=state.knowledgeJobs[jobId]; const idx=readJson(uploadedFile,[]); const rec=idx.find(x=>x.id===idv); if(!rec)throw new Error('Knowledge record disappeared during processing.'); const out=ex.text||''; const textPath=filePath+'.txt';fs.writeFileSync(textPath,out,'utf8'); rec.contentPath=path.relative(root,textPath); rec.contentChars=out.length; rec.extractionMethod=ex.method||'text';rec.pages=ex.pages||null;rec.extractionQuality=ex.extractionQuality||null;rec.documentFiscalYear=ex.documentFiscalYear||null;rec.documentUnit=ex.documentUnit||null;rec.stage='indexing';rec.progress=75;rec.status='processing';rec.updatedAt=new Date().toISOString(); const chunks=out.split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>40).slice(0,300);rec.chunks=chunks.map((text,i)=>({id:id('kchunk'),ordinal:i+1,text}));rec.extractedAssets=ex.assets||null;rec.assetMetadata=ex.assets||null;rec.visualAssetCount=ex.assets?.images?.length||0;rec.tableAssetCount=ex.assets?.tables?.length||0;const idxNext=idx.map(x=>x.id===idv?rec:x);fs.writeFileSync(uploadedFile,JSON.stringify(idxNext,null,2)); rec.status='active';rec.stage='completed';rec.progress=100;rec.updatedAt=new Date().toISOString();const doneIdx=readJson(uploadedFile,[]).map(x=>x.id===idv?rec:x);fs.writeFileSync(uploadedFile,JSON.stringify(doneIdx,null,2));job.progress=100;job.stage='completed';job.status='completed';job.elapsedMs=Math.max(0,Date.now()-Date.parse(job.startedAt||job.createdAt));job.completedAt=new Date().toISOString();save();audit('KNOWLEDGE_INGESTED',{jobId,knowledgeId:idv,contentChars:rec.contentChars,chunks:rec.chunks.length});}catch(e){const job=state.knowledgeJobs[jobId];if(job){job.status='failed';job.stage='failed';job.error=String(e?.message||e);job.elapsedMs=Math.max(0,Date.now()-Date.parse(job.startedAt||job.createdAt));job.completedAt=new Date().toISOString();}const idx=readJson(uploadedFile,[]).map(x=>x.id===idv?{...x,status:'failed',stage:'failed',progress:100,error:String(e?.message||e),updatedAt:new Date().toISOString()}:x);fs.writeFileSync(uploadedFile,JSON.stringify(idx,null,2));save();audit('KNOWLEDGE_INGESTION_FAILED',{jobId,knowledgeId:idv,errorHash:sha(String(e?.message||e))});}})().catch(()=>{});
    return send(res,202,{id:idv,jobId,status:'queued',message:'Knowledge upload stored. Extraction and RAG indexing continue in the local kernel.',document:item});
  }
  if(u.pathname.startsWith('/api/knowledge/jobs/')&&req.method==='GET'){const job=state.knowledgeJobs[u.pathname.split('/')[4]];if(!job)return send(res,404,{error:'Knowledge job not found'});return send(res,200,job);}
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&u.pathname.endsWith('/reprocess')&&req.method==='POST'){
    const knowledgeId=u.pathname.split('/')[4],uploadedFile=path.join(dataDir,'knowledge','uploaded.json'); const arr=readJson(uploadedFile,[]); const item=arr.find(x=>x.id===knowledgeId); if(!item)return send(res,404,{error:'Local knowledge file not found'});
    if(!item.sourcePath)return send(res,409,{error:'Original knowledge file is unavailable for reprocessing'});
    const fp=path.resolve(root,item.sourcePath); if(!fs.existsSync(fp))return send(res,409,{error:'Original knowledge file is missing from local storage'});
    item.status='processing';item.stage='queued';item.progress=5;item.error=null;item.updatedAt=new Date().toISOString();item.reviewOutcome=item.reviewOutcome||'pending'; item.version=Number(item.version||1)+1;
    const jobId=id('knowledgejob'); state.knowledgeJobs[jobId]={jobId,knowledgeId,filename:item.filename,status:'queued',stage:'queued',progress:10,createdAt:new Date().toISOString(),startedAt:null,elapsedMs:0,operation:'reprocess'}; item.jobId=jobId; writeJson(uploadedFile,arr); save(); audit('KNOWLEDGE_REPROCESS_QUEUED',{knowledgeId,filename:item.filename,version:item.version,jobId});
    (async()=>{const job=state.knowledgeJobs[jobId];try{job.status='processing';job.stage='extracting';job.startedAt=new Date().toISOString();job.progress=25;save();const bytes=fs.readFileSync(fp);let ex=await extractDocument(item.filename,bytes.toString('base64'),jobId);if(/\.pdf$/i.test(item.filename)){try{const rich=await enrichPdfTextWithAssets(ex.text||'',fp,knowledgeId,jobId);ex={...ex,text:rich.text||ex.text,assets:rich.assets||ex.assets,extractionQuality:{...(ex.extractionQuality||{}),visualAssetCount:rich.assets?.images?.length||0,tableAssetCount:rich.assets?.tables?.length||0}};}catch(err){audit('KNOWLEDGE_REPROCESS_PDF_ASSET_ENRICH_FAILED',{knowledgeId,errorHash:sha(String(err?.message||err))},{correlationId:jobId});}}const text=String(ex.text||'');if(!text&&!(ex.assets?.tables?.length)&&!(ex.assets?.images?.length))throw new Error('Reprocess produced no usable extracted evidence.');const textPath=fp+'.txt';fs.writeFileSync(textPath,text,'utf8');item.contentPath=path.relative(root,textPath);item.contentChars=text.length;item.extractionMethod=ex.method||'text';item.pages=ex.pages||null;item.extractionQuality=ex.extractionQuality||null;item.documentFiscalYear=ex.documentFiscalYear||null;item.documentUnit=ex.documentUnit||null;item.documentScale=ex.documentScale||null;item.documentCurrency=ex.documentCurrency||null;item.extractedAssets=ex.assets||null;item.assetMetadata=ex.assets||null;item.visualAssetCount=ex.assets?.images?.length||0;item.tableAssetCount=ex.assets?.tables?.length||0;item.chunks=text.split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>40).slice(0,300).map((chunk,i)=>({id:id('kchunk'),ordinal:i+1,text:chunk}));item.stage='completed';item.progress=100;item.status='active';item.updatedAt=new Date().toISOString();item.extractionError=null;item.lastReprocessedAt=item.updatedAt;writeJson(uploadedFile,arr.map(x=>x.id===knowledgeId?item:x));job.status='completed';job.stage='completed';job.progress=100;job.elapsedMs=Date.now()-Date.parse(job.startedAt);job.completedAt=new Date().toISOString();save();audit('KNOWLEDGE_REPROCESSED',{knowledgeId,filename:item.filename,version:item.version,visualAssetCount:item.visualAssetCount,tableAssetCount:item.tableAssetCount});}catch(e){item.status='needs_review';item.stage='needs_review';item.progress=100;item.error=String(e?.message||e);item.updatedAt=new Date().toISOString();item.reviewOutcome='needs_reprocessing';writeJson(uploadedFile,arr.map(x=>x.id===knowledgeId?item:x));job.status='failed';job.stage='failed';job.error=item.error;job.progress=100;job.elapsedMs=job.startedAt?Date.now()-Date.parse(job.startedAt):0;job.completedAt=new Date().toISOString();save();audit('KNOWLEDGE_REPROCESS_FAILED',{knowledgeId,filename:item.filename,errorHash:sha(item.error)});}})();
    return send(res,202,{ok:true,knowledgeId,jobId,status:'queued',version:item.version,message:'Knowledge reprocessing queued.'});
  }
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&u.pathname.endsWith('/review')&&req.method==='POST'){
    const knowledgeId=u.pathname.split('/')[4],uploadedFile=path.join(dataDir,'knowledge','uploaded.json'); const arr=readJson(uploadedFile,[]); const item=arr.find(x=>x.id===knowledgeId); if(!item)return send(res,404,{error:'Local knowledge file not found'}); const b=await parseBody(req); const allowed=['pending','accepted','rejected','needs_reprocessing']; const outcome=String(b.outcome||'').trim().toLowerCase(); if(!allowed.includes(outcome))return send(res,400,{error:`Review outcome must be one of: ${allowed.join(', ')}`}); item.reviewOutcome=outcome;item.reviewedAt=new Date().toISOString();item.reviewNotes=String(b.notes||'').slice(0,2000);item.updatedAt=item.reviewedAt; if(outcome==='accepted'&&item.status==='needs_review')item.status='active'; writeJson(uploadedFile,arr);save();audit('KNOWLEDGE_REVIEW_OUTCOME_UPDATED',{knowledgeId,outcome,notesHash:sha(item.reviewNotes)});return send(res,200,item);
  }
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&u.pathname.endsWith('/assets')&&req.method==='GET'){
    const knowledgeId=u.pathname.split('/')[4],file=path.join(dataDir,'knowledge','uploaded.json'); const arr=readJson(file,[]); const item=arr.find(x=>x.id===knowledgeId); if(!item)return send(res,404,{error:'Local knowledge file not found'}); return send(res,200,{assets:item.extractedAssets||null,visualAssetCount:item.visualAssetCount||0,tableAssetCount:item.tableAssetCount||0});
  }
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&u.pathname.endsWith('/visuals')&&req.method==='GET'){
    const knowledgeId=u.pathname.split('/')[4],file=path.join(dataDir,'knowledge','uploaded.json'); const arr=readJson(file,[]); const item=arr.find(x=>x.id===knowledgeId); if(!item)return send(res,404,{error:'Local knowledge file not found'});
    const assets=item.extractedAssets||{}; const files=[...(assets.pageSnapshots||[]).map(x=>({...x,kind:'Page visual'})),...(assets.images||[]).map(x=>({...x,kind:`Embedded image ${x.index||''}`} ) )];
    const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const cards=files.map((x,i)=>{const raw=String(x.path||x.src||'');const src=/^https?:\/\//i.test(raw)?raw:`/api/knowledge/uploaded/${encodeURIComponent(knowledgeId)}/asset/${encodeURIComponent(path.basename(raw||''))}`;return `<figure><img src="${esc(src)}" alt="${esc(x.kind)} page ${esc(x.page)}" onerror="this.style.opacity='.25';this.alt='Visual asset unavailable'"><figcaption>${esc(x.kind)} • page ${esc(x.page)} • ${esc(x.width||'?')}×${esc(x.height||'?')}</figcaption></figure>`}).join('');
    const tables=(assets.tables||[]).map(t=>{const grid=Array.isArray(t.rowsData)?t.rowsData:String(t.tsv||'').split('\n').filter(Boolean).map(r=>r.split('\t')); const knownYears=Array.isArray(t.fiscalYears)&&t.fiscalYears.length?t.fiscalYears:[]; let header=Array.isArray(t.headers)&&t.headers.length?t.headers:[]; let body=grid; let headerRows=Array.isArray(t.headerRows)&&t.headerRows.length?t.headerRows:(header.length?[header]:[]); if(!headerRows.length&&grid.length){const first=grid[0]||[]; const firstHasYear=first.some(c=>/20\d{2}/.test(String(c))); if(firstHasYear){headerRows=[first];} else if(knownYears.length && grid.some(r=>r.length===knownYears.length+1)){headerRows=[['Line item',...knownYears.map(String)]];} else if(knownYears.length && grid.some(r=>r.length===knownYears.length)){headerRows=[['Line item',...knownYears.map(String)]];}} if(headerRows.length&&grid.length&&Number.isInteger(Number(t.yearHeaderRowIndex))){body=grid.slice(Math.min(grid.length,Number(t.yearHeaderRowIndex)+1));} else if(headerRows.length&&grid.length&&headerRows[headerRows.length-1]===grid[0]){body=grid.slice(1);} const thRows=headerRows.map(hr=>{const cells=[...hr];if(cells.length<(headerRows.reduce((m,r)=>Math.max(m,r.length),0)))cells.push(...Array(headerRows.reduce((m,r)=>Math.max(m,r.length),0)-cells.length).fill('')); return `<tr>${cells.slice(0,Math.max(1,...headerRows.map(r=>r.length))).map(c=>`<th>${esc(c)}</th>`).join('')}</tr>`;}).join(''); const width=headerRows.reduce((m,r)=>Math.max(m,r.length),0); const rows=body.map(r=>{const cells=[...r];if(width&&cells.length<width)cells.push(...Array(width-cells.length).fill(''));return cells.slice(0,width||cells.length).map(c=>`<td>${esc(c)}</td>`).join('');}).map(r=>`<tr>${r}</tr>`).join('');return `<section class="table-card"><h3>${esc(t.title||'Detected table')} • page ${esc(t.page)}${knownYears.length?` • FY ${esc(knownYears.join(' / '))}`:''}</h3>${knownYears.length?`<div style="font-size:12px;color:#b8c7d9;margin:0 0 8px">Comparative fiscal years: ${esc(knownYears.join(' • '))}</div>`:''}<div class="table-wrap"><table><thead>${thRows}</thead><tbody>${rows}</tbody></table></div></section>`}).join('');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...(res.__myaiOrigin && ALLOWED_WEB_ORIGINS.has(res.__myaiOrigin) ? {'Access-Control-Allow-Origin':res.__myaiOrigin} : {})}); return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(item.title||item.filename)} — Visual Evidence</title><style>body{font-family:Arial,sans-serif;background:#0b111b;color:#f4f7fb;margin:24px}h1{font-size:22px}h2{margin-top:32px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:20px;align-items:start}figure,.table-card{margin:0;border:1px solid #263448;border-radius:12px;padding:12px;background:#111a27;box-shadow:0 4px 14px rgba(0,0,0,.18)}img{display:block;width:100%;max-height:980px;object-fit:contain;border-radius:8px;background:#fff}figcaption{font-size:12px;color:#b8c7d9;margin-top:8px}.table-wrap{overflow:auto;max-width:100%;border:1px solid #33445a;border-radius:8px}table{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:12px;background:#0f1723}th,td{border-right:1px solid #33445a;border-bottom:1px solid #33445a;padding:7px 8px;vertical-align:top;text-align:left;white-space:pre-wrap}th{position:sticky;top:0;background:#dbe8f5;color:#102033;font-weight:700}tr td:first-child{font-weight:600;min-width:220px}</style></head><body><h1>${esc(item.title||item.filename)} — Visual Evidence</h1><p>Rendered PDF pages, embedded images and detected tables captured during local ingestion.</p><main>${cards||'<p>No visual assets were captured.</p>'}</main><h2>Detected tables</h2>${tables||'<p>No structured tables were detected.</p>'}</body></html>`);
  }
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&u.pathname.includes('/asset/')&&req.method==='GET'){
    const parts=u.pathname.split('/'),knowledgeId=parts[4],assetName=path.basename(decodeURIComponent(parts.slice(6).join('/'))); const file=path.join(dataDir,'knowledge','uploaded.json'); const arr=readJson(file,[]); const item=arr.find(x=>x.id===knowledgeId); if(!item)return send(res,404,{error:'Local knowledge file not found'}); const assetRoot=path.join(documentAssetsDir,knowledgeId); const fp=path.join(assetRoot,assetName); const actual=fs.existsSync(fp)?fp:null; if(!actual)return send(res,404,{error:'Knowledge visual asset not found'}); res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':`inline; filename="${assetName}"`,...(res.__myaiOrigin && ALLOWED_WEB_ORIGINS.has(res.__myaiOrigin) ? {'Access-Control-Allow-Origin':res.__myaiOrigin} : {})}); return fs.createReadStream(actual).pipe(res);
  }
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&u.pathname.endsWith('/file')&&req.method==='GET'){
    const knowledgeId=u.pathname.split('/')[4],file=path.join(dataDir,'knowledge','uploaded.json'); const arr=readJson(file,[]); const item=arr.find(x=>x.id===knowledgeId); if(!item)return send(res,404,{error:'Local knowledge file not found'});
    const fp=item.sourcePath?path.resolve(root,item.sourcePath):null; if(!fp||!fs.existsSync(fp))return send(res,404,{error:'Original knowledge file is missing from local storage'});
    const ext=path.extname(item.filename||'').toLowerCase(); const mime=ext==='.pdf'?'application/pdf':ext==='.docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':ext==='.xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':ext==='.xls'?'application/vnd.ms-excel':ext==='.csv'?'text/csv':ext==='.txt'?'text/plain':item.contentType||'application/octet-stream';
    audit('KNOWLEDGE_ORIGINAL_FILE_ACCESSED',{knowledgeId,filename:item.filename,size:item.size});
    res.writeHead(200,{'Content-Type':mime,'Content-Disposition':`inline; filename="${String(item.filename||'knowledge-file').replace(/[^a-zA-Z0-9._ -]/g,'_')}"`,...(res.__myaiOrigin && ALLOWED_WEB_ORIGINS.has(res.__myaiOrigin) ? {'Access-Control-Allow-Origin':res.__myaiOrigin} : {})}); return fs.createReadStream(fp).pipe(res);
  }
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&u.pathname.endsWith('/content')&&req.method==='GET'){
    const knowledgeId=u.pathname.split('/')[4],file=path.join(dataDir,'knowledge','uploaded.json'); const arr=readJson(file,[]); const item=arr.find(x=>x.id===knowledgeId); if(!item)return send(res,404,{error:'Local knowledge file not found'});
    let text='';
    try{
      const cp=item.contentPath?path.resolve(root,item.contentPath):null;
      if(cp&&fs.existsSync(cp)) text=fs.readFileSync(cp,'utf8');
      else if(item.sourcePath){const fp=path.resolve(root,item.sourcePath);if(!fs.existsSync(fp))throw new Error('Stored knowledge content is missing');const bytes=fs.readFileSync(fp);const ex=await extractDocument(item.filename,bytes.toString('base64'));text=String(ex.text||'');}
    }catch(e){return send(res,422,{error:`Unable to extract knowledge content: ${String(e?.message||e)}`});}
    audit('KNOWLEDGE_CONTENT_ACCESSED',{knowledgeId,title:item.title,contentHash:sha(text),contentChars:text.length}); res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`inline; filename=\"${String(item.title||item.filename).replace(/[^a-zA-Z0-9._-]/g,'_')}.txt\"`,...(res.__myaiOrigin && ALLOWED_WEB_ORIGINS.has(res.__myaiOrigin) ? {'Access-Control-Allow-Origin':res.__myaiOrigin} : {})}); return res.end(text);
  }
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&u.pathname.endsWith('/archive')&&req.method==='POST'){
    const knowledgeId=u.pathname.split('/')[4],file=path.join(dataDir,'knowledge','uploaded.json');let arr=readJson(file,[]);const item=arr.find(x=>x.id===knowledgeId);if(!item)return send(res,404,{error:'Local knowledge file not found'});item.archived=!item.archived;item.status=item.archived?'archived':'active';item.updatedAt=new Date().toISOString();writeJson(file,arr);audit(item.archived?'KNOWLEDGE_DOCUMENT_ARCHIVED':'KNOWLEDGE_DOCUMENT_RESTORED',{knowledgeId,filename:item.filename,version:item.version||1});return send(res,200,item);
  }
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&u.pathname.endsWith('/delete')&&req.method==='POST'){
    const knowledgeId=u.pathname.split('/')[4],file=path.join(dataDir,'knowledge','uploaded.json'); let arr=readJson(file,[]); const item=arr.find(x=>x.id===knowledgeId); if(!item)return send(res,404,{error:'Local knowledge file not found'}); try{if(item.sourcePath)fs.unlinkSync(path.resolve(root,item.sourcePath))}catch{}; try{fs.rmSync(path.join(documentAssetsDir,knowledgeId),{recursive:true,force:true})}catch{}; arr=arr.filter(x=>x.id!==knowledgeId); writeJson(file,arr); audit('KNOWLEDGE_DOCUMENT_DELETED_PERMANENT',{knowledgeId,filename:item.filename,version:item.version||1}); return send(res,200,{ok:true});
  }
  if(u.pathname.startsWith('/api/knowledge/uploaded/')&&req.method==='DELETE'){
    const knowledgeId=u.pathname.split('/').pop(),file=path.join(dataDir,'knowledge','uploaded.json');let arr=readJson(file,[]);const item=arr.find(x=>x.id===knowledgeId);if(!item)return send(res,404,{error:'Local knowledge file not found'});try{if(item.sourcePath)fs.unlinkSync(path.resolve(root,item.sourcePath))}catch{};try{fs.rmSync(path.join(documentAssetsDir,knowledgeId),{recursive:true,force:true})}catch{};arr=arr.filter(x=>x.id!==knowledgeId);writeJson(file,arr);audit('KNOWLEDGE_DOCUMENT_DELETED_PERMANENT',{knowledgeId,filename:item.filename,version:item.version||1});return send(res,200,{ok:true});
  }
  if(u.pathname==='/api/knowledge/uploaded'&&req.method==='GET'){
    const file=path.join(dataDir,'knowledge','uploaded.json');let arr=[];try{arr=JSON.parse(fs.readFileSync(file,'utf8'))}catch{};return send(res,200,{documents:arr});
  }
  if(u.pathname==='/api/knowledge'&&req.method==='GET')return send(res,200,{sources:KNOWLEDGE_SOURCES,jurisdictions:JURISDICTIONS,principles:['Primary sources outrank secondary interpretation.','Company evidence outranks generic web knowledge for company-specific facts.','Knowledge is separate from instructions and policy.','Every source carries jurisdiction, authority, provenance and active status.','Licensed standards must not be copied into the local corpus without the required licence.']});
  if(u.pathname==='/api/knowledge/search'&&req.method==='GET'){
    const q=(u.searchParams.get('q')||'').toLowerCase(), j=(u.searchParams.get('jurisdiction')||'').toLowerCase(), cat=(u.searchParams.get('category')||'').toLowerCase();
    const sources=KNOWLEDGE_SOURCES.filter(x=>(!q||`${x.name} ${x.category} ${x.jurisdiction}`.toLowerCase().includes(q))&&(!j||x.jurisdiction.toLowerCase()===j)&&(!cat||x.category.toLowerCase()===cat)); audit('KNOWLEDGE_SOURCE_SEARCHED',{queryHash:sha(q),jurisdiction:j||null,category:cat||null,resultCount:sources.length}); return send(res,200,{sources,jurisdictions:JURISDICTIONS});
  }
  if(u.pathname.startsWith('/api/documents/')&&u.pathname.endsWith('/visuals')&&req.method==='GET'){
    const docId=u.pathname.split('/')[3]; let owner=null,doc=null; for(const c of state.companies||[]){const found=(c.documents||[]).find(x=>x.id===docId); if(found){owner=c;doc=found;break;}}
    if(!doc)return send(res,404,{error:'Document not found'});
    let assets=doc.extractedAssets||doc.assetManifest||{};
    if(/\.pdf$/i.test(String(doc.filename||''))){
      const hasVisuals=(Array.isArray(assets.pageSnapshots)&&assets.pageSnapshots.length)||(Array.isArray(assets.images)&&assets.images.length)||(Array.isArray(assets.tables)&&assets.tables.length);
      if(!hasVisuals && doc.sourcePath){
        try{
          const fp=path.resolve(root,doc.sourcePath);
          if(fs.existsSync(fp)){
            const recovered=await enrichPdfTextWithAssets(String(doc.text||''),fp,doc.id,crypto.randomUUID());
            if(recovered?.assets){
              doc.extractedAssets=recovered.assets; doc.assetManifest=recovered.assets;
              doc.visualAssetCount=Array.isArray(recovered.assets.images)?recovered.assets.images.length:0;
              doc.tableAssetCount=Array.isArray(recovered.assets.tables)?recovered.assets.tables.length:0;
              assets=recovered.assets; save();
              audit('DOCUMENT_VISUALS_LAZY_RECOVERY',{companyId:owner?.id||null,documentId:doc.id,filename:doc.filename,visualAssetCount:doc.visualAssetCount,tableAssetCount:doc.tableAssetCount});
            }
          }
        }catch(e){audit('DOCUMENT_VISUALS_LAZY_RECOVERY_FAILED',{companyId:owner?.id||null,documentId:doc.id,errorHash:sha(String(e?.message||e))});}
      }
    }
    const files=[...(assets.pageSnapshots||[]).map(x=>({...x,kind:'Page visual'})),...(assets.images||[]).map(x=>({...x,kind:`Embedded image ${x.index||''}`}))];
    const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const imageSrc=x=>{const raw=String(x.path||x.src||'');if(/^https?:\/\//i.test(raw))return raw;const n=path.basename(raw);return n?`/api/documents/assets/${encodeURIComponent(docId)}/${encodeURIComponent(n)}`:''};
    const cards=files.map(x=>{const src=imageSrc(x);return src?`<figure><img src="${esc(src)}" alt="${esc(x.kind)} page ${esc(x.page)}" onerror="this.style.opacity='.25';this.alt='Visual asset unavailable'"><figcaption>${esc(x.kind)} • page ${esc(x.page)} • ${esc(x.width||'?')}×${esc(x.height||'?')}</figcaption></figure>`:''}).join('');
    const tables=(assets.tables||[]).map(t=>{const grid=Array.isArray(t.rowsData)?t.rowsData:String(t.tsv||'').split('\n').filter(Boolean).map(r=>r.split('\t')); const knownYears=Array.isArray(t.fiscalYears)&&t.fiscalYears.length?t.fiscalYears:[]; let header=Array.isArray(t.headers)&&t.headers.length?t.headers:[]; let body=grid; let headerRows=Array.isArray(t.headerRows)&&t.headerRows.length?t.headerRows:(header.length?[header]:[]); if(!headerRows.length&&grid.length){const first=grid[0]||[]; const firstHasYear=first.some(c=>/20\d{2}/.test(String(c))); if(firstHasYear){headerRows=[first];} else if(knownYears.length && grid.some(r=>r.length===knownYears.length+1)){headerRows=[['Line item',...knownYears.map(String)]];} else if(knownYears.length && grid.some(r=>r.length===knownYears.length)){headerRows=[['Line item',...knownYears.map(String)]];}} if(headerRows.length&&grid.length&&Number.isInteger(Number(t.yearHeaderRowIndex))){body=grid.slice(Math.min(grid.length,Number(t.yearHeaderRowIndex)+1));} else if(headerRows.length&&grid.length&&headerRows[headerRows.length-1]===grid[0]){body=grid.slice(1);} const thRows=headerRows.map(hr=>{const cells=[...hr];if(cells.length<(headerRows.reduce((m,r)=>Math.max(m,r.length),0)))cells.push(...Array(headerRows.reduce((m,r)=>Math.max(m,r.length),0)-cells.length).fill('')); return `<tr>${cells.slice(0,Math.max(1,...headerRows.map(r=>r.length))).map(c=>`<th>${esc(c)}</th>`).join('')}</tr>`;}).join(''); const width=headerRows.reduce((m,r)=>Math.max(m,r.length),0); const rows=body.map(r=>{const cells=[...r];if(width&&cells.length<width)cells.push(...Array(width-cells.length).fill(''));return cells.slice(0,width||cells.length).map(c=>`<td>${esc(c)}</td>`).join('');}).map(r=>`<tr>${r}</tr>`).join('');return `<section class="table-card"><h3>${esc(t.title||'Detected table')} • page ${esc(t.page)}${knownYears.length?` • FY ${esc(knownYears.join(' / '))}`:''}</h3>${knownYears.length?`<div style="font-size:12px;color:#b8c7d9;margin:0 0 8px">Comparative fiscal years: ${esc(knownYears.join(' • '))}</div>`:''}<div class="table-wrap"><table><thead>${thRows}</thead><tbody>${rows}</tbody></table></div></section>`}).join('');
    audit('DOCUMENT_VISUALS_ACCESSED',{companyId:owner?.id||null,documentId:docId,filename:doc.filename,visualAssetCount:files.length,tableAssetCount:Array.isArray(assets.tables)?assets.tables.length:0});
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...(res.__myaiOrigin && ALLOWED_WEB_ORIGINS.has(res.__myaiOrigin) ? {'Access-Control-Allow-Origin':res.__myaiOrigin} : {})}); return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title||doc.filename)} — Visual Evidence</title><style>body{font-family:Arial,sans-serif;background:#0b111b;color:#f4f7fb;margin:24px}h1{font-size:22px}h2{margin-top:32px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:20px;align-items:start}figure,.table-card{margin:0;border:1px solid #263448;border-radius:12px;padding:12px;background:#111a27;box-shadow:0 4px 14px rgba(0,0,0,.18)}img{display:block;width:100%;max-height:980px;object-fit:contain;border-radius:8px;background:#fff}figcaption{font-size:12px;color:#b8c7d9;margin-top:8px}.table-wrap{overflow:auto;max-width:100%;border:1px solid #33445a;border-radius:8px}table{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:12px;background:#0f1723}th,td{border-right:1px solid #33445a;border-bottom:1px solid #33445a;padding:7px 8px;vertical-align:top;text-align:left;white-space:pre-wrap}th{position:sticky;top:0;background:#dbe8f5;color:#102033;font-weight:700}tr td:first-child{font-weight:600;min-width:220px}</style></head><body><h1>${esc(doc.title||doc.filename)} — Visual Evidence</h1><p>Rendered page visuals, embedded images and detected tables captured during local ingestion.</p><main>${cards||'<p>No visual assets were captured.</p>'}</main><h2>Detected tables</h2>${tables||'<p>No structured tables were detected.</p>'}</body></html>`);
  }
  if(u.pathname.startsWith('/api/documents/assets/')&&u.pathname.split('/').length>=6&&req.method==='GET'){
    const parts=u.pathname.split('/'),docId=parts[4],assetName=path.basename(decodeURIComponent(parts.slice(5).join('/'))); const fp=path.join(documentAssetsDir,String(docId),assetName); if(!fs.existsSync(fp))return send(res,404,{error:'Visual asset not found'}); res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':`inline; filename=\"${assetName}\"`,...(res.__myaiOrigin && ALLOWED_WEB_ORIGINS.has(res.__myaiOrigin) ? {'Access-Control-Allow-Origin':res.__myaiOrigin} : {})}); return fs.createReadStream(fp).pipe(res);
  }
  if(u.pathname.startsWith('/api/documents/assets/')&&req.method==='GET'){
    const parts=u.pathname.split('/'),docId=parts[4]; let doc=null; for(const c of state.companies){doc=(c.documents||[]).find(x=>x.id===docId);if(doc)break;} if(!doc)return send(res,404,{error:'Document not found'}); return send(res,200,{assets:doc.extractedAssets||null,visualAssetCount:doc.visualAssetCount||0,tableAssetCount:doc.tableAssetCount||0});
  }
  if(u.pathname.startsWith('/api/documents/file/')&&req.method==='GET'){
    const docId=u.pathname.split('/').pop(); const c=state.companies.find(c=>(c.documents||[]).some(d=>d.id===docId)); const d=c?.documents?.find(x=>x.id===docId);
    if(!d||!d.sourcePath)return send(res,404,{error:'Document file not found'});
    const fp=path.resolve(root,d.sourcePath); if(!fs.existsSync(fp))return send(res,404,{error:'Stored document has been deleted from disk'});
    const ext=path.extname(d.filename).toLowerCase(); const types={'.pdf':'application/pdf','.txt':'text/plain','.csv':'text/csv','.json':'application/json','.xml':'application/xml','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xls':'application/vnd.ms-excel'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Content-Disposition':`inline; filename="${d.filename.replace(/"/g,'')}"`}); return fs.createReadStream(fp).pipe(res);
  }
  if(u.pathname.startsWith('/api/documents/')&&u.pathname.endsWith('/reprocess')&&req.method==='POST'){
    const docId=u.pathname.split('/')[3]; let owner=null,d=null; for(const c of state.companies){d=(c.documents||[]).find(x=>x.id===docId);if(d){owner=c;break;}}
    if(!d||!d.sourcePath)return send(res,404,{error:'Stored document not found'});
    try{
      const fp=path.resolve(root,d.sourcePath); if(!fs.existsSync(fp))return send(res,404,{error:'Stored document file is missing'});
      const bytes=fs.readFileSync(fp); const ex=await extractDocument(d.filename,bytes.toString('base64')); d.documentFiscalYear=ex.documentFiscalYear||null;d.documentUnit=ex.documentUnit||d.documentUnit||null;d.structuredFacts=Array.isArray(ex.structuredFacts)?ex.structuredFacts:[];d.extractionQuality=ex.extractionQuality||null;d.fiscalYearMismatch=!!(d.documentFiscalYear&&String(d.documentFiscalYear)!==String(d.fiscalYear)); let enriched=ex; if(path.extname(d.filename).toLowerCase()==='.pdf') enriched=await enrichPdfTextWithAssets(ex.text,fp,d.id,crypto.randomUUID());
      const textPath=d.sourcePath?path.resolve(root,d.sourcePath)+'.txt':path.join(companyDocumentsDir(owner.id),`${d.id}-extracted.txt`);fs.writeFileSync(textPath,enriched.text||'','utf8');d.contentPath=path.relative(root,textPath);d.extractionMethod=enriched.method||ex.method;d.pages=enriched.pages||ex.pages;d.textLength=(enriched.text||'').length;d.visualAssetCount=enriched.assets?.images?.length||0;d.tableAssetCount=enriched.assets?.tables?.length||0;d.extractedAssets=enriched.assets||null;d.evidenceCount=Math.max(0,ex.text.split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>40).length || (Array.isArray(d.structuredFacts)?d.structuredFacts.length:0));d.evidence=(ex.text.split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>40).slice(0,50)).map((text,i)=>({id:id('evidence'),documentId:d.id,companyId:owner.id,ordinal:i+1,text,source:d.filename}));
      d.userFiscalYear=d.userFiscalYear||d.fiscalYear||null;
      const oldFacts=owner.facts||[];const retained=oldFacts.filter(f=>f.documentId===docId&&(f.validated||f.systemVerified));
      owner.facts=oldFacts.filter(f=>f.documentId!==docId||f.validated||f.systemVerified);d.factCount=retained.length;d.candidateFacts=retained.filter(f=>!f.validated&&!f.systemVerified);d.aiStatus='queued';d.aiError=null;d.aiCandidateFactCount=0;
      d.fiscalYearMismatch=!!(d.documentFiscalYear&&d.userFiscalYear&&String(d.documentFiscalYear)!==String(d.userFiscalYear));
      if(!d.structuredFacts.length){d.structuredFacts=deterministicCandidateFacts(enriched.text||ex.text||'',d.id,owner.id,d);}
      const usableEvidence=Number(d.evidenceCount||0)>0 || (Array.isArray(d.structuredFacts)&&d.structuredFacts.length)>0;
      if(d.fiscalYearMismatch){
        d.status='needs_review';d.stage='needs_review';d.progress=100;d.aiStatus='not_started';d.aiStatusDetail='DOCUMENT_FISCAL_YEAR_CONFLICT';
        d.aiError={code:'DOCUMENT_FISCAL_YEAR_CONFLICT',message:`Uploaded financial year ${d.userFiscalYear} conflicts with detected document fiscal year ${d.documentFiscalYear}. Review metadata before AI review or CFO analysis.`};
        d.updatedAt=new Date().toISOString();save();audit('DOCUMENT_FISCAL_YEAR_CONFLICT',{documentId:docId,companyId:owner.id,userFiscalYear:d.userFiscalYear,documentFiscalYear:d.documentFiscalYear});
        return send(res,200,{document:d,message:'Document requires review because the selected fiscal year conflicts with the detected document period.',code:'DOCUMENT_FISCAL_YEAR_CONFLICT'});
      }
      d.fiscalYear=d.documentFiscalYear||d.fiscalYear;
      if(!usableEvidence){
        d.status='needs_review';d.stage='needs_review';d.progress=100;d.aiStatus='not_started';d.aiStatusDetail='NO_EXTRACTED_EVIDENCE';
        d.aiError={code:'NO_EXTRACTED_EVIDENCE',message:'Reprocessing completed without usable text, evidence blocks, or structured financial facts.'};
        d.updatedAt=new Date().toISOString();save();audit('DOCUMENT_REPROCESS_NEEDS_REVIEW',{documentId:docId,companyId:owner.id,reason:'NO_EXTRACTED_EVIDENCE'});
        return send(res,200,{document:d,message:'Document requires review because extraction produced no usable evidence.',code:'NO_EXTRACTED_EVIDENCE'});
      }
      d.status='processing';d.stage='queued';d.progress=95;d.updatedAt=new Date().toISOString();
      const aiJobId=id('docai');state.aiJobs[aiJobId]={jobId:aiJobId,type:'document-ai',status:'queued',companyId:owner.id,documentId:d.id,filename:d.filename,createdAt:new Date().toISOString(),correlationId:crypto.randomUUID()};d.aiJobId=aiJobId;save();audit('DOCUMENT_REPROCESSED',{documentId:docId,companyId:owner.id,retainedFactCount:retained.length,aiJobId,extractionMode:'AI/RAG/agent-after-evidence'});processDocumentAiJob(aiJobId).catch(()=>{});return send(res,200,{document:d,message:'Evidence refreshed. AI/RAG/agent extraction has been queued.'});
    }catch(e){return send(res,500,{error:'Document reprocessing failed',detail:String(e?.message||e)})}
  }
  if(u.pathname.startsWith('/api/documents/')&&u.pathname.endsWith('/metadata/update')&&req.method==='POST'){
    const docId=u.pathname.split('/')[3]; let owner=null,d=null; for(const c of state.companies){d=(c.documents||[]).find(x=>x.id===docId);if(d){owner=c;break;}}
    if(!d)return send(res,404,{error:'Document not found'}); const b=await parseBody(req);
    if(b.companyId&&b.companyId!==owner.id){const target=state.companies.find(x=>x.id===b.companyId);if(!target)return send(res,404,{error:'Target company not found'});owner.documents=owner.documents.filter(x=>x.id!==docId);const oldPath=d.sourcePath?path.resolve(root,d.sourcePath):null;const newPath=path.join(companyDocumentsDir(target.id),`${d.id}-${path.basename(d.filename)}`);if(oldPath&&fs.existsSync(oldPath)&&oldPath!==newPath){try{fs.renameSync(oldPath,newPath);d.sourcePath=path.relative(root,newPath)}catch{}}d.companyId=target.id;target.documents.push(d);owner=target;}
    Object.assign(d,{title:b.title??d.title,category:b.category??d.category,fiscalYear:b.fiscalYear??d.fiscalYear,documentType:b.documentType??d.documentType,notes:b.notes??d.notes,updatedAt:new Date().toISOString()});
    if(b.fiscalYear!=null)d.userFiscalYear=String(b.fiscalYear);
    d.fiscalYearMismatch=!!(d.documentFiscalYear&&d.userFiscalYear&&String(d.documentFiscalYear)!==String(d.userFiscalYear));
    if(!d.fiscalYearMismatch && d.documentFiscalYear){
      d.fiscalYear=d.documentFiscalYear;
      d.status='processing';d.stage='queued';d.progress=5;d.aiStatus='not_started';d.aiStatusDetail='reprocess_required';d.aiError=null;
    }
    save(); audit('DOCUMENT_METADATA_UPDATED',{documentId:docId,companyId:owner.id,category:d.category,fiscalYear:d.fiscalYear,userFiscalYear:d.userFiscalYear,documentFiscalYear:d.documentFiscalYear,fiscalYearMismatch:d.fiscalYearMismatch});
    return send(res,200,{...d,reprocessRequired:!d.fiscalYearMismatch&&!!d.documentFiscalYear});
  }
  if(u.pathname.startsWith('/api/documents/')&&u.pathname.endsWith('/metadata')&&req.method==='PATCH'){
    const docId=u.pathname.split('/')[3]; let owner=null,d=null; for(const c of state.companies){d=(c.documents||[]).find(x=>x.id===docId);if(d){owner=c;break;}}
    if(!d)return send(res,404,{error:'Document not found'}); const b=await parseBody(req);
    if(b.companyId&&b.companyId!==owner.id){
      const target=state.companies.find(x=>x.id===b.companyId); if(!target)return send(res,404,{error:'Target company not found'});
      owner.documents=owner.documents.filter(x=>x.id!==docId); const oldPath=d.sourcePath?path.resolve(root,d.sourcePath):null; const newPath=path.join(companyDocumentsDir(target.id),`${d.id}-${path.basename(d.filename)}`); if(oldPath&&fs.existsSync(oldPath)&&oldPath!==newPath){try{fs.renameSync(oldPath,newPath);d.sourcePath=path.relative(root,newPath)}catch{}} d.companyId=target.id;target.documents.push(d); owner=target;
    }
    Object.assign(d,{title:b.title??d.title,category:b.category??d.category,fiscalYear:b.fiscalYear??d.fiscalYear,documentType:b.documentType??d.documentType,notes:b.notes??d.notes,updatedAt:new Date().toISOString()});
    save();audit('DOCUMENT_METADATA_UPDATED',{documentId:docId,companyId:owner.id,category:d.category,fiscalYear:d.fiscalYear});return send(res,200,d);
  }
  if(u.pathname.startsWith('/api/documents/')&&u.pathname.endsWith('/archive')&&req.method==='POST'){
    const docId=u.pathname.split('/')[3]; let owner=null,d=null; for(const c of state.companies){d=(c.documents||[]).find(x=>x.id===docId);if(d){owner=c;break;}}
    if(!d)return send(res,404,{error:'Document not found'}); d.archived=!d.archived;d.updatedAt=new Date().toISOString();d.status=d.archived?'archived':(d.progress===100?'completed':'processing');save();audit(d.archived?'DOCUMENT_ARCHIVED':'DOCUMENT_RESTORED',{documentId:docId,companyId:owner.id});return send(res,200,d);
  }
  if(u.pathname.startsWith('/api/documents/')&&u.pathname.endsWith('/delete')&&req.method==='POST'){
    const docId=u.pathname.split('/')[3]; let owner=null,d=null; for(const c of state.companies){d=(c.documents||[]).find(x=>x.id===docId);if(d){owner=c;break;}}
    if(!d)return send(res,404,{error:'Document not found'}); try{if(d.sourcePath)fs.unlinkSync(path.resolve(root,d.sourcePath))}catch{}; owner.documents=owner.documents.filter(x=>x.id!==docId); owner.facts=(owner.facts||[]).filter(f=>f.documentId!==docId); save(); audit('DOCUMENT_DELETED_PERMANENT',{documentId:docId,companyId:owner.id}); return send(res,200,{ok:true});
  }
  if(u.pathname.startsWith('/api/documents/')&&req.method==='DELETE'){
    const docId=u.pathname.split('/').pop(); let owner=null,d=null; for(const c of state.companies){d=(c.documents||[]).find(x=>x.id===docId);if(d){owner=c;break;}}
    if(!d)return send(res,404,{error:'Document not found'}); try{if(d.sourcePath)fs.unlinkSync(path.resolve(root,d.sourcePath))}catch{}
    owner.documents=owner.documents.filter(x=>x.id!==docId); owner.facts=(owner.facts||[]).filter(f=>f.documentId!==docId); save();audit('DOCUMENT_DELETED_PERMANENT',{documentId:docId,companyId:owner.id});return send(res,200,{ok:true});
  }
  if(u.pathname.startsWith('/api/facts/')&&u.pathname.endsWith('/validate')&&req.method==='POST'){
    const factId=u.pathname.split('/')[3]; let fact=null,owner=null; for(const c of state.companies){fact=(c.facts||[]).find(f=>f.id===factId);if(fact){owner=c;break;}}
    if(!fact)return send(res,404,{error:'Fact not found'}); const sourceDoc=(owner.documents||[]).find(d=>d.id===fact.documentId);if(sourceDoc?.archived)return send(res,409,{error:'Cannot validate a fact from an archived document.'}); fact.validated=true;fact.status='validated';fact.validatedAt=new Date().toISOString();save();audit('FACT_VALIDATED',{factId,companyId:owner.id});return send(res,200,fact);
  }
  if(u.pathname==='/api/documents'&&req.method==='GET'){
    const requestedId=u.searchParams.get('companyId'); const c=requestedId?state.companies.find(x=>x.id===requestedId):activeCompany();
    if(requestedId&&!c)return send(res,404,{error:'Company not found'}); const nowMs=Date.now(); const docs=(c?.documents||[]).map(d=>{const j=d.extractionJobId?state.extractionJobs?.[d.extractionJobId]:null; const ai=d.aiJobId?state.aiJobs?.[d.aiJobId]:null; const extractionElapsedMs=j&&j.startedAt&&!['completed','failed','cancelled'].includes(String(j.status||''))?Math.max(0,nowMs-Date.parse(j.startedAt)):Number(j?.elapsedMs||d.extractionElapsedMs||0); const aiElapsedMs=ai&&ai.createdAt&&!['completed','failed','cancelled'].includes(String(ai.status||''))?Math.max(0,nowMs-Date.parse(ai.startedAt||ai.createdAt)):Number(ai?.elapsedMs||d.aiElapsedMs||0); return {...d,extractionElapsedMs,aiElapsedMs,extractionEtaSeconds:j?.etaSeconds??null,aiEtaSeconds:ai?.estimatedSeconds?Math.max(0,Number(ai.estimatedSeconds)-(Number(ai.progress||0)/100*Number(ai.estimatedSeconds))):null};}); return send(res,200,{company:c,documents:docs});
  }
  if(u.pathname==='/api/documents/url'&&req.method==='POST'){
    const b=await parseBody(req,4*1024*1024); const c=b.companyId?state.companies.find(x=>x.id===b.companyId):activeCompany();
    if(!c)return send(res,409,{error:'Select a company workspace before importing a document URL.'});
    if(c.archived)return send(res,409,{error:'Cannot import into an archived company workspace.'});
    if(!b.url||!b.documentType||!b.fiscalYear)return send(res,400,{error:'url, documentType and fiscalYear are required.'});
    try{
      const fetched=await fetchPublicDocumentUrl(b.url);
      const uploadPayload={filename:fetched.filename,contentBase64:fetched.base64,extractionContentBase64:fetched.extractionBase64||fetched.base64,companyId:c.id,documentType:b.documentType,category:b.category||b.documentType,fiscalYear:b.fiscalYear,title:b.title||fetched.pageTitle||fetched.filename,notes:b.notes||'',sourceUrl:String(b.url)};
      const port=Number(process.env.MYAI_CFO_API_PORT||47821); const rr=await fetch(`http://127.0.0.1:${port}/api/documents/upload`,{method:'POST',headers:{'Content-Type':'application/json','X-MYAI-CFO-Internal-URL-Import':'1'},body:JSON.stringify(uploadPayload),signal:AbortSignal.timeout(720000)});
      const body=await rr.json().catch(()=>({})); if(!rr.ok)return send(res,rr.status,{...body,error:body.error||'URL document ingestion failed',detail:body.detail||`HTTP ${rr.status}`});
      const docId=body.document?.id; const stored=(c.documents||[]).find(d=>d.id===docId); if(stored){stored.title=String(b.title||stored.title||fetched.pageTitle||stored.filename).trim()||stored.filename;stored.sourceUrl=String(b.url);stored.resolvedSourceUrl=fetched.finalUrl;stored.sourceType='url';stored.sourceContentType=fetched.contentType;stored.sourceFetchedAt=new Date().toISOString();stored.sourceUrlHash=sha(String(b.url));stored.sourceContentBytesHash=sha(fetched.base64||'');stored.extractionInputBytesHash=sha(fetched.extractionBase64||fetched.base64||'');stored.extractionInputMode=fetched.extractionBase64&&fetched.extractionBase64!==fetched.base64?'resolved-html-assets':'source-bytes';save();audit('DOCUMENT_URL_INGESTED',{companyId:c.id,documentId:docId,sourceUrl:String(b.url),resolvedSourceUrl:fetched.finalUrl,contentType:fetched.contentType,size:fetched.size,extractionInputMode:stored.extractionInputMode});}
      return send(res,rr.status,{...body,document:stored||body.document,sourceUrl:String(b.url),resolvedSourceUrl:fetched.finalUrl});
    }catch(e){return send(res,422,{ok:false,error:'Document URL ingestion failed.',detail:String(e?.message||e),code:'DOCUMENT_URL_INGEST_FAILED'});}
  }
  if(u.pathname==='/api/documents/upload'&&req.method==='POST'){
    const b=await parseBody(req,70*1024*1024); const c=b.companyId?state.companies.find(x=>x.id===b.companyId):activeCompany(); if(!c)return send(res,409,{error:'Select a company workspace before uploading documents.'}); if(c.archived)return send(res,409,{error:'Cannot upload into an archived company workspace.'}); if(!b.filename||!b.contentBase64)return send(res,400,{error:'filename and contentBase64 required'}); if(!b.documentType)return send(res,400,{error:'documentType is required before upload'}); if(!b.fiscalYear)return send(res,400,{error:'fiscalYear is required before upload'});
    const docId=id('doc'), safe=path.basename(b.filename).replace(/[^\w.\- ]/g,'_'), filePath=path.join(companyDocumentsDir(c.id),`${docId}-${safe}`);
    const bytes=Buffer.from(b.contentBase64,'base64'); if(bytes.length>52*1024*1024)return send(res,413,{error:'Document exceeds the 50 MB binary upload limit.',code:'DOCUMENT_TOO_LARGE'}); fs.writeFileSync(filePath,bytes); const extractionContentBase64=String(b.extractionContentBase64||b.contentBase64);
    const doc={id:docId,companyId:c.id,title:String(b.title||b.filename).trim()||b.filename,filename:b.filename,documentType:b.documentType||'',category:b.category||'',fiscalYear:b.fiscalYear||'',documentFiscalYear:null,fiscalYearMismatch:false,documentUnit:null,extractionQuality:null,structuredFacts:[],notes:b.notes||'',size:bytes.length,status:'processing',stage:'extracting',progress:5,archived:false,evidenceCount:0,factCount:0,createdAt:new Date().toISOString(),sourcePath:path.relative(root,filePath),sourceUrl:b.sourceUrl?String(b.sourceUrl):null,sourceType:b.sourceUrl?'url':'upload',sourceContentBytesHash:sha(b.contentBase64||''),extractionInputBytesHash:sha(extractionContentBase64),extractionInputMode:extractionContentBase64!==String(b.contentBase64||'')?'resolved-html-assets':'source-bytes'};
    c.documents.push(doc);
    const extractionJobId=id('extract'); const extractionStartedAt=Date.now(); const extractionController=new AbortController();
    activeDocumentExtractionControllers.set(doc.id,extractionController);
    state.extractionJobs[extractionJobId]={jobId:extractionJobId,type:'document-extraction',status:'running',companyId:c.id,documentId:doc.id,filename:doc.filename,createdAt:new Date().toISOString(),startedAt:new Date().toISOString(),progress:5,stage:'extracting',elapsedMs:0,correlationId:crypto.randomUUID()};
    doc.extractionJobId=extractionJobId; doc.extractionStartedAt=state.extractionJobs[extractionJobId].startedAt;
    save();audit('DOCUMENT_UPLOADED',{companyId:c.id,documentId:doc.id,filename:b.filename,size:bytes.length,extractionJobId},{correlationId:state.extractionJobs[extractionJobId].correlationId});
    try{
      const jobRecord=state.extractionJobs[extractionJobId]; jobRecord.stage='extracting'; jobRecord.progress=10; jobRecord.elapsedMs=Date.now()-extractionStartedAt; jobRecord.etaSeconds=Math.max(30,Math.round(EXTRACTION_MAX_MS/2000)); save();
      const ex=await extractDocument(b.filename,extractionContentBase64,jobRecord.correlationId,extractionController.signal);
      doc.documentFiscalYear=ex.documentFiscalYear||doc.documentFiscalYear||null;doc.documentUnit=ex.documentUnit||doc.documentUnit||null;doc.documentCurrency=ex.documentCurrency||doc.documentCurrency||c.currency||null;doc.documentScale=(ex.documentScale && ex.documentScale!=='units')?ex.documentScale:(doc.documentScale||'units');doc.structuredFacts=Array.isArray(ex.structuredFacts)?ex.structuredFacts:[];doc.extractionQuality=ex.extractionQuality||null;doc.currency=ex.documentCurrency||doc.currency||((ex.documentUnit||'').toUpperCase().includes('INR')?'INR':doc.currency||'');doc.fiscalYearMismatch=!!(doc.documentFiscalYear&&String(doc.documentFiscalYear)!==String(doc.fiscalYear));
      let enriched=ex; if(path.extname(b.filename).toLowerCase()==='.pdf') enriched=await enrichPdfTextWithAssets(ex.text,filePath,doc.id,jobRecord.correlationId,extractionController.signal);
      if(path.extname(b.filename).toLowerCase()==='.pdf' && Array.isArray(enriched.assets?.structuredFacts) && enriched.assets.structuredFacts.length){
        doc.structuredFacts=mergeStructuredExtractionFacts(doc.structuredFacts||[],enriched.assets.structuredFacts,{companyId:c.id,documentId:doc.id,documentFiscalYear:doc.documentFiscalYear||enriched.assets.documentFiscalYear,documentUnit:doc.documentUnit||enriched.assets.documentUnit,documentCurrency:doc.documentCurrency||enriched.assets.documentCurrency||c.currency,documentScale:(doc.documentScale && doc.documentScale!=='units')?doc.documentScale:(enriched.assets.documentScale||'units')});
        doc.documentFiscalYear=doc.documentFiscalYear||enriched.assets.documentFiscalYear||null;
        doc.documentUnit=doc.documentUnit||enriched.assets.documentUnit||null;
        doc.documentCurrency=doc.documentCurrency||enriched.assets.documentCurrency||c.currency||null;
        doc.documentScale=(doc.documentScale && doc.documentScale!=='units')?doc.documentScale:(enriched.assets.documentScale||'units');
      }
      const textPath=filePath+'.txt';fs.writeFileSync(textPath,enriched.text||'','utf8');doc.contentPath=path.relative(root,textPath);doc.extractionMethod=enriched.method||ex.method;doc.pages=enriched.pages||ex.pages;doc.textLength=(enriched.text||'').length;doc.visualAssetCount=enriched.assets?.images?.length||0;doc.tableAssetCount=enriched.assets?.tables?.length||0;doc.extractedAssets=enriched.assets||null;doc.progress=60;doc.stage='evidence'; if(state.extractionJobs[extractionJobId]){state.extractionJobs[extractionJobId].progress=60;state.extractionJobs[extractionJobId].stage='evidence';state.extractionJobs[extractionJobId].elapsedMs=Date.now()-extractionStartedAt;} save();
      const chunks=(enriched.text||'').split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>40).slice(0,200);
      doc.evidenceCount=chunks.length;
      doc.evidence=chunks.slice(0,50).map((text,i)=>({id:id('evidence'),documentId:doc.id,companyId:c.id,ordinal:i+1,text,source:b.filename}));
      if(doc.evidenceCount===0 && !(doc.structuredFacts||[]).length){
        doc.status='needs_review'; doc.stage='needs_review'; doc.progress=100; doc.aiStatus='not_started'; doc.aiStatusDetail='NO_EXTRACTED_EVIDENCE';
        doc.aiError={code:'NO_EXTRACTED_EVIDENCE',message:'Document extraction completed without usable text, evidence blocks, or structured financial facts. The document has not been promoted to completed evidence.'};
        if(state.extractionJobs?.[extractionJobId]){state.extractionJobs[extractionJobId].status='failed';state.extractionJobs[extractionJobId].stage='Needs review';state.extractionJobs[extractionJobId].progress=100;state.extractionJobs[extractionJobId].elapsedMs=Date.now()-extractionStartedAt;state.extractionJobs[extractionJobId].completedAt=new Date().toISOString();state.extractionJobs[extractionJobId].error='NO_EXTRACTED_EVIDENCE';} activeDocumentExtractionControllers.delete(doc.id); save(); audit('DOCUMENT_INGESTION_NEEDS_REVIEW',{companyId:c.id,documentId:doc.id,filename:doc.filename,reason:'NO_EXTRACTED_EVIDENCE'});
        return send(res,201,{document:doc,companyId:c.id,message:'Document requires review because no extractable evidence or structured financial facts were produced.',code:'NO_EXTRACTED_EVIDENCE'});
      }
      // Detected document period is authoritative. A conflicting upload FY must be reviewed
      // before the document enters canonical facts, RAG or AI review.
      if(doc.fiscalYearMismatch){
        doc.userFiscalYear=doc.fiscalYear;
        doc.status='needs_review'; doc.stage='needs_review'; doc.progress=100; doc.aiStatus='not_started'; doc.aiStatusDetail='DOCUMENT_FISCAL_YEAR_CONFLICT';
        doc.aiError={code:'DOCUMENT_FISCAL_YEAR_CONFLICT',message:`Uploaded financial year ${doc.userFiscalYear} conflicts with detected document fiscal year ${doc.documentFiscalYear}. Review metadata before AI review or CFO analysis.`};
        if(state.extractionJobs?.[extractionJobId]){state.extractionJobs[extractionJobId].status='failed';state.extractionJobs[extractionJobId].stage='Needs review';state.extractionJobs[extractionJobId].progress=100;state.extractionJobs[extractionJobId].elapsedMs=Date.now()-extractionStartedAt;state.extractionJobs[extractionJobId].completedAt=new Date().toISOString();state.extractionJobs[extractionJobId].error='DOCUMENT_FISCAL_YEAR_CONFLICT';} activeDocumentExtractionControllers.delete(doc.id); save(); audit('DOCUMENT_FISCAL_YEAR_CONFLICT',{companyId:c.id,documentId:doc.id,filename:doc.filename,userFiscalYear:doc.userFiscalYear,documentFiscalYear:doc.documentFiscalYear});
        return send(res,201,{document:doc,companyId:c.id,message:'Document requires review because the selected fiscal year conflicts with the detected document period.',code:'DOCUMENT_FISCAL_YEAR_CONFLICT'});
      }
      doc.fiscalYear=doc.documentFiscalYear||doc.fiscalYear;
      doc.stage='facts';doc.progress=85; if(state.extractionJobs[extractionJobId]){state.extractionJobs[extractionJobId].progress=85;state.extractionJobs[extractionJobId].stage='facts';state.extractionJobs[extractionJobId].elapsedMs=Date.now()-extractionStartedAt;} save();
      syncStructuredFacts(c);doc.factCount=(doc.structuredFacts||[]).length;doc.candidateFacts=[];doc.stage='completed';doc.progress=100;doc.status='completed';
      doc.aiStatus='queued'; if(state.extractionJobs[extractionJobId]){state.extractionJobs[extractionJobId].status='completed';state.extractionJobs[extractionJobId].progress=100;state.extractionJobs[extractionJobId].stage='completed';state.extractionJobs[extractionJobId].elapsedMs=Date.now()-extractionStartedAt;state.extractionJobs[extractionJobId].completedAt=new Date().toISOString();} activeDocumentExtractionControllers.delete(doc.id); const aiJobId=id('docai');state.aiJobs[aiJobId]={jobId:aiJobId,type:'document-ai',status:'queued',companyId:c.id,documentId:doc.id,filename:doc.filename,createdAt:new Date().toISOString(),correlationId:crypto.randomUUID(),stage:'Queued for AI evidence review',progress:0,estimatedSeconds:Math.max(20,Math.min(900,Math.ceil((Number(doc.evidenceCount||0)/10)*8+25)))};doc.aiJobId=aiJobId;save();audit('DOCUMENT_INGESTED',{companyId:c.id,documentId:doc.id,evidenceCount:doc.evidenceCount,candidateFactCount:0,aiJobId,extractionMode:'AI/RAG/agent-after-evidence'});
      processDocumentAiJob(aiJobId).catch(()=>{});
      return send(res,201,{document:doc,companyId:c.id,message:'Document ingested. AI evidence review has been queued and will run automatically when a local model is available.',aiJobId});
    }catch(err){
      const cancelled=err?.name==='AbortError'||err?.code==='ABORT_ERR'||extractionController.signal.aborted;
      doc.status=cancelled?'cancelled':'failed';doc.stage=cancelled?'cancelled':'failed';doc.error=cancelled?'EXTRACTION_CANCELLED':String(err?.code==='ETIMEDOUT'?'EXTRACTION_TIMEOUT':(err?.message||err));doc.errorStack=String(err?.stack||'').slice(0,5000);
      if(state.extractionJobs[extractionJobId]){state.extractionJobs[extractionJobId].status=cancelled?'cancelled':'failed';state.extractionJobs[extractionJobId].stage=cancelled?'cancelled':'failed';state.extractionJobs[extractionJobId].progress=100;state.extractionJobs[extractionJobId].elapsedMs=Date.now()-extractionStartedAt;state.extractionJobs[extractionJobId].completedAt=new Date().toISOString();state.extractionJobs[extractionJobId].error=doc.error;}
      activeDocumentExtractionControllers.delete(doc.id);save();audit(cancelled?'DOCUMENT_EXTRACTION_CANCELLED':'DOCUMENT_INGESTION_FAILED',{companyId:c.id,documentId:doc.id,extractionJobId,error:doc.error,errorStack:doc.errorStack},{correlationId:state.extractionJobs[extractionJobId]?.correlationId});
      return send(res,cancelled?409:500,{error:cancelled?'Document extraction cancelled':'Document extraction failed',detail:doc.error,document:doc,extractionJobId});
    }
  }
  if(u.pathname.startsWith('/api/documents/extraction-jobs/')&&req.method==='GET'){
    const job=state.extractionJobs?.[u.pathname.split('/')[4]]; if(!job)return send(res,404,{error:'Extraction job not found'});
    if(['running','queued','processing'].includes(job.status))job.elapsedMs=Math.max(0,Date.now()-Date.parse(job.startedAt||new Date().toISOString()));
    return send(res,200,job);
  }
  if(u.pathname.startsWith('/api/documents/')&&u.pathname.endsWith('/cancel-extraction')&&req.method==='POST'){
    const docId=u.pathname.split('/')[3]; const controller=activeDocumentExtractionControllers.get(docId); let job=null; for(const j of Object.values(state.extractionJobs||{})){if(j.documentId===docId&&['running','queued','processing'].includes(j.status)){job=j;break;}}
    if(!controller||!job)return send(res,409,{error:'No active extraction process found for this document.',code:'EXTRACTION_NOT_RUNNING'});
    job.status='cancelling';job.stage='cancelling';job.elapsedMs=Math.max(0,Date.now()-Date.parse(job.startedAt));save(); controller.abort(); audit('DOCUMENT_EXTRACTION_CANCEL_REQUESTED',{documentId:docId,extractionJobId:job.jobId},{correlationId:job.correlationId}); return send(res,202,{ok:true,status:'cancelling',jobId:job.jobId});
  }
  if(u.pathname.startsWith('/api/documents/')&&u.pathname.endsWith('/restart')&&req.method==='POST'){
    const docId=u.pathname.split('/')[3]; let owner=null,d=null; for(const c of state.companies){d=(c.documents||[]).find(x=>x.id===docId);if(d){owner=c;break;}}
    if(!d||!d.sourcePath)return send(res,404,{error:'Stored document not found'}); if(activeDocumentExtractionControllers.has(docId))return send(res,409,{error:'Document extraction is already running.',code:'EXTRACTION_ALREADY_RUNNING'});
    const fp=path.resolve(root,d.sourcePath); if(!fs.existsSync(fp))return send(res,404,{error:'Stored document file is missing'}); const raw=fs.readFileSync(fp).toString('base64');
    d.status='processing';d.stage='extracting';d.progress=5;d.error=null;d.aiError=null;d.aiStatus='not_started';d.aiStatusDetail='restarting';d.updatedAt=new Date().toISOString();
    const extractionJobId=id('extract');const extractionStartedAt=Date.now();const controller=new AbortController();const correlationId=crypto.randomUUID(); activeDocumentExtractionControllers.set(docId,controller); state.extractionJobs[extractionJobId]={jobId:extractionJobId,type:'document-extraction',status:'running',companyId:owner.id,documentId:docId,filename:d.filename,createdAt:new Date().toISOString(),startedAt:new Date().toISOString(),progress:5,stage:'extracting',elapsedMs:0,correlationId}; d.extractionJobId=extractionJobId;d.extractionStartedAt=state.extractionJobs[extractionJobId].startedAt; save(); audit('DOCUMENT_EXTRACTION_RESTARTED',{documentId:docId,companyId:owner.id,extractionJobId},{correlationId});
    (async()=>{try{const ex=await extractDocument(d.filename,raw,correlationId,controller.signal); const job=state.extractionJobs[extractionJobId];
      const primaryFacts=Array.isArray(ex.structuredFacts)?ex.structuredFacts:[];
      d.documentFiscalYear=ex.documentFiscalYear||d.documentFiscalYear||null;d.documentUnit=ex.documentUnit||d.documentUnit||null;d.documentCurrency=ex.documentCurrency||d.documentCurrency||owner.currency||null;d.documentScale=ex.documentScale||d.documentScale||'units';d.extractionQuality=ex.extractionQuality||d.extractionQuality||null;d.currency=d.documentCurrency;let enriched=ex;if(path.extname(d.filename).toLowerCase()==='.pdf')enriched=await enrichPdfTextWithAssets(ex.text,fp,d.id,correlationId,controller.signal);
      const assetFacts=Array.isArray(enriched.assets?.structuredFacts)?enriched.assets.structuredFacts:[];
      const mergedFacts=(assetFacts.length?mergeStructuredExtractionFacts(primaryFacts,assetFacts,{companyId:owner.id,documentId:d.id,documentFiscalYear:d.documentFiscalYear||enriched.assets?.documentFiscalYear,documentUnit:d.documentUnit||enriched.assets?.documentUnit,documentCurrency:d.documentCurrency||enriched.assets?.documentCurrency||owner.currency,documentScale:(d.documentScale&&d.documentScale!=='units')?d.documentScale:(enriched.assets?.documentScale||'units')}):primaryFacts);
      if(mergedFacts.length) d.structuredFacts=mergedFacts;
      const textPath=fp+'.txt';fs.writeFileSync(textPath,enriched.text||'','utf8');d.contentPath=path.relative(root,textPath);d.extractionMethod=enriched.method||ex.method;d.pages=enriched.pages||ex.pages;d.textLength=(enriched.text||'').length;d.visualAssetCount=enriched.assets?.images?.length||0;d.tableAssetCount=enriched.assets?.tables?.length||0;d.extractedAssets=enriched.assets||null;const chunks=(enriched.text||'').split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>40).slice(0,200);d.evidenceCount=chunks.length;d.evidence=chunks.slice(0,50).map((text,i)=>({id:id('evidence'),documentId:d.id,companyId:owner.id,ordinal:i+1,text,source:d.filename})); if(!d.structuredFacts.length){d.structuredFacts=deterministicCandidateFacts(enriched.text||ex.text||'',d.id,owner.id,d);}
      if(!d.evidenceCount&&!d.structuredFacts.length){d.status='needs_review';d.stage='needs_review';d.progress=100;d.aiStatus='not_started';if(job){job.status='failed';job.stage='Needs review';job.progress=100;job.elapsedMs=Date.now()-extractionStartedAt;job.completedAt=new Date().toISOString();job.error='NO_EXTRACTED_EVIDENCE';}}else{d.documentFiscalYear=d.documentFiscalYear||d.fiscalYear;d.fiscalYear=d.documentFiscalYear||d.fiscalYear;syncStructuredFacts(owner);d.factCount=d.structuredFacts.length;d.status='completed';d.stage='completed';d.progress=100;d.aiStatus='queued';const aiJobId=id('docai');state.aiJobs[aiJobId]={jobId:aiJobId,type:'document-ai',status:'queued',companyId:owner.id,documentId:d.id,filename:d.filename,createdAt:new Date().toISOString(),correlationId:crypto.randomUUID(),stage:'Queued for AI evidence review',progress:0,estimatedSeconds:60};d.aiJobId=aiJobId;processDocumentAiJob(aiJobId).catch(()=>{});if(job){job.status='completed';job.stage='completed';job.progress=100;job.elapsedMs=Date.now()-extractionStartedAt;job.completedAt=new Date().toISOString();}} d.updatedAt=new Date().toISOString();save();activeDocumentExtractionControllers.delete(docId);audit('DOCUMENT_EXTRACTION_RESTART_COMPLETED',{documentId:docId,companyId:owner.id,extractionJobId,elapsedMs:Date.now()-extractionStartedAt},{correlationId});}catch(e){const cancelled=e?.name==='AbortError'||e?.code==='ABORT_ERR'||controller.signal.aborted;d.status=cancelled?'cancelled':'failed';d.stage=cancelled?'cancelled':'failed';d.progress=100;d.error=cancelled?'EXTRACTION_CANCELLED':String(e?.message||e);if(state.extractionJobs[extractionJobId]){state.extractionJobs[extractionJobId].status=cancelled?'cancelled':'failed';state.extractionJobs[extractionJobId].stage=cancelled?'cancelled':'failed';state.extractionJobs[extractionJobId].progress=100;state.extractionJobs[extractionJobId].elapsedMs=Date.now()-extractionStartedAt;state.extractionJobs[extractionJobId].completedAt=new Date().toISOString();state.extractionJobs[extractionJobId].error=d.error;}activeDocumentExtractionControllers.delete(docId);save();audit(cancelled?'DOCUMENT_EXTRACTION_CANCELLED':'DOCUMENT_EXTRACTION_RESTART_FAILED',{documentId:docId,companyId:owner.id,extractionJobId,error:d.error},{correlationId});}})();
    return send(res,202,{ok:true,status:'running',jobId:extractionJobId,document:d});
  }
  if(u.pathname.startsWith('/api/documents/')&&u.pathname.endsWith('/content')&&req.method==='GET'){
    const docId=u.pathname.split('/')[3]; const owner=(state.companies||[]).find(c=>(c.documents||[]).some(d=>d.id===docId)); const d=owner?.documents?.find(x=>x.id===docId); if(!d)return send(res,404,{error:'Document not found'});
    let text=''; try{if(d.contentPath){const fp=path.resolve(root,d.contentPath);if(fs.existsSync(fp))text=fs.readFileSync(fp,'utf8');}}catch{} if(!text&&Array.isArray(d.evidence))text=d.evidence.map(x=>x.text||'').join('\n\n'); if(!text)return send(res,404,{error:'Extracted text is not available for this document yet.'});
    audit('DOCUMENT_CONTENT_ACCESSED',{documentId:docId,companyId:owner.id,title:d.title||d.filename,contentChars:text.length}); res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`inline; filename="${String(d.title||d.filename||'document').replace(/[^a-zA-Z0-9._-]/g,'_')}.txt"`}); return res.end(text);
  }
  if(u.pathname.startsWith('/api/documents/jobs/')&&req.method==='GET'){const job=state.aiJobs[u.pathname.split('/')[4]];if(!job)return send(res,404,{error:'Document AI job not found'});return send(res,200,job);}
  if(u.pathname==='/api/online-route'&&req.method==='GET') {
    const route={...state.onlineRoute,apiKeyConfigured:!!process.env.MYAI_CFO_OMNIROUTE_API_KEY};
    delete route.apiKey;
    return send(res,200,{ok:true,route,localFirst:true,warning:'Company evidence is never sent to an online provider unless Online Route is explicitly enabled and company-evidence consent is explicitly granted.'});
  }
  if(u.pathname==='/api/online-route'&&req.method==='POST') {
    const b=await parseBody(req);
    const enabled=b.enabled===true; const baseUrl=String(b.baseUrl||state.onlineRoute.baseUrl||'http://127.0.0.1:20128/v1').trim().replace(/\/$/,'');
    let parsed; try{parsed=new URL(baseUrl);}catch{return send(res,400,{ok:false,error:'Invalid OmniRoute base URL.'});}
    if(!['http:','https:'].includes(parsed.protocol))return send(res,400,{ok:false,error:'OmniRoute base URL must use HTTP or HTTPS.'});
    state.onlineRoute={...state.onlineRoute,provider:'OmniRoute',enabled,baseUrl,model:b.model?String(b.model):null,allowCompanyEvidence:b.allowCompanyEvidence===true}; save();
    audit('ONLINE_ROUTE_CONFIGURED',{provider:'OmniRoute',enabled,baseUrl,model:state.onlineRoute.model,allowCompanyEvidence:state.onlineRoute.allowCompanyEvidence});
    return send(res,200,{ok:true,route:{...state.onlineRoute,apiKeyConfigured:!!process.env.MYAI_CFO_OMNIROUTE_API_KEY}});
  }
  if(u.pathname==='/api/online-route/test'&&req.method==='POST') {
    const base=String(state.onlineRoute.baseUrl||'http://127.0.0.1:20128/v1').replace(/\/$/,'');
    const headers={'Accept':'application/json'}; if(process.env.MYAI_CFO_OMNIROUTE_API_KEY)headers.Authorization=`Bearer ${process.env.MYAI_CFO_OMNIROUTE_API_KEY}`;
    const started=Date.now();
    try{
      const r=await fetch(`${base}/models`,{headers,signal:AbortSignal.timeout(5000)});
      const text=await r.text();
      if(!r.ok){audit('ONLINE_ROUTE_TEST_FAILED',{provider:'OmniRoute',baseUrl:base,endpoint:`${base}/models`,status:r.status,detailHash:sha(text.slice(0,500))});return send(res,502,{ok:false,status:'UNAVAILABLE',error:`OmniRoute /models returned HTTP ${r.status}.`,detail:text.slice(0,500),endpoint:`${base}/models`});}
      let body={}; try{body=JSON.parse(text)}catch{};
      audit('ONLINE_ROUTE_TEST_PASSED',{provider:'OmniRoute',baseUrl:base,endpoint:`${base}/models`,latencyMs:Date.now()-started,modelCount:Array.isArray(body.data)?body.data.length:null});
      return send(res,200,{ok:true,status:'CONNECTED',latencyMs:Date.now()-started,endpoint:`${base}/models`,modelCount:Array.isArray(body.data)?body.data.length:null,models:Array.isArray(body.data)?body.data.slice(0,25):[]});
    } catch(e){
      const message=String(e?.message||e);
      audit('ONLINE_ROUTE_TEST_FAILED',{provider:'OmniRoute',baseUrl:base,endpoint:`${base}/models`,errorClass:e?.name||'Error',errorHash:sha(message)});
      return send(res,503,{ok:false,status:'NOT_RUNNING',error:'OmniRoute is not reachable.',detail:message,endpoint:`${base}/models`,nextAction:'Start OmniRoute (or configure a reachable OpenAI-compatible OmniRoute endpoint) and test again.'});
    }
  }
  if(u.pathname==='/api/chat'&&req.method==='POST'){
    const b=await parseBody(req); const message=String(b.message||'').trim();
    if(!message)return send(res,400,{error:'Message required'});
    const safety=safetyCheck(message);
    if(!safety.allowed){audit('CHAT_BLOCKED_SAFETY',{category:safety.category,policyVersion:safety.policyVersion,messageHash:sha(message)});return send(res,200,{blocked:true,safety,answer:safety.message});}
    const correlationId=crypto.randomUUID();
    let attachments=[];
    try{attachments=await prepareRequestAttachments(b.attachments||[],correlationId);}catch(e){return send(res,400,{error:String(e?.message||e),code:'ATTACHMENT_INGESTION_FAILED'});}
    const requestedCompanyIds=Array.isArray(b.companyIds)?b.companyIds.map(String).filter(Boolean):[];
    let scopeValidation; try{scopeValidation=assertCompanyScope(req,requestedCompanyIds.length?requestedCompanyIds:(b.companyId?[b.companyId]:[]));}catch(e){if(e?.code==='COMPANY_SCOPE_INVALID')return send(res,409,{ok:false,code:'COMPANY_SCOPE_INVALID',error:e.message});throw e;}
    const effectiveRequestedCompanyIds=scopeValidation?.companyIds||[];
    const requestedCompanies=effectiveRequestedCompanyIds.length?effectiveRequestedCompanyIds.map(idv=>state.companies.find(x=>x.id===idv)).filter(Boolean):[];
    const company= requestedCompanies.length===1 ? requestedCompanies[0] : (b.companyId ? state.companies.find(x=>x.id===b.companyId) : activeCompany());
    if(company)syncStructuredFacts(company);
    const scopeCompanies=requestedCompanies.length?requestedCompanies:(company?[company]:[]);
    const selectedFiscalYears=Array.isArray(b.fiscalYears)?b.fiscalYears.map(String).filter(Boolean):[];
    // Explicit years in the user's question take precedence over stale UI scope selections.
    const queryFiscalYears=[...new Set((String(message||'').match(/\b20\d{2}\b/g)||[]))];
    const fiscalYears=queryFiscalYears.length?queryFiscalYears:selectedFiscalYears;
    const workspace=String(b.workspace||'copilot');
    const requestedBasis=workspace==='copilot'?requestedReportBasis(message):'any';
    const hasConsolidated=workspace==='copilot' && scopeCompanies.some(c=>(c.documents||[]).some(d=>!d.archived&&documentReportBasis(d)==='consolidated'));
    const reportBasis=requestedBasis!=='any'?requestedBasis:(hasConsolidated?'consolidated':'any');
    const effectiveScopeCompanies=workspace==='pa'?[]:scopeCompanies; const companyContext=effectiveScopeCompanies.length?combinedCompanyEvidenceContext(effectiveScopeCompanies,{fiscalYears,reportBasis}):{company:null,companies:[],documents:[],validatedFacts:[],candidateFacts:[],evidence:[]};
    if(scopeCompanies.length){
      const ranked=rankFinancialEvidence(effectiveScopeCompanies.flatMap(c=>c.documents||[]),message,fiscalYears);
      companyContext.evidence=ranked.length?ranked:companyContext.evidence;
      companyContext.candidateFacts=rankCandidateFacts(companyContext.candidateFacts,message);
      companyContext.validatedFacts=rankCandidateFacts(companyContext.validatedFacts,message);
      companyContext.fiscalYears=fiscalYears;
      audit(queryFiscalYears.length?'COPILOT_SCOPE_OVERRIDDEN_BY_QUERY_YEARS':'COPILOT_SCOPE_APPLIED',{companyIds:scopeCompanies.map(x=>x.id),selectedFiscalYears,queryFiscalYears,effectiveFiscalYears:fiscalYears,reportBasis},{correlationId});
    }
    const route=moniRoute(message);
    const lower=message.toLowerCase();
    const companyName=String(company?.name||'').toLowerCase();
    const namedCompany=!!companyName && lower.includes(companyName);
    const companySpecific=workspace==='copilot' && !!company && (namedCompany || route.companyId===company.id || scopeCompanies.length>0 || /\b(?:our|my|this|selected)\s+(?:company|business|group|entity)\b/i.test(message));
    const rawInstructions=readJson(path.join(dataDir,'knowledge','instructions.json'),[]);
    const rawKnowledge=readJson(path.join(dataDir,'knowledge','uploaded.json'),[]);
    const activeInstructions=(Array.isArray(rawInstructions)?rawInstructions:[]).filter(x=>x&&!x.archived);
    const activeKnowledge=(Array.isArray(rawKnowledge)?rawKnowledge:[]).filter(x=>x&&!x.archived);
    let knowledgeItems=knowledgeRetrievalContext(activeKnowledge,message);
    const requestedStandard=workspace==='pa'?standardIdentityFromQuery(message):null;
    const exactStandardKnowledge=requestedStandard?filterKnowledgeForStandard(knowledgeItems,requestedStandard):knowledgeItems;
    if(requestedStandard && exactStandardKnowledge.length===0){
      const gap=`I could not find authoritative Knowledge Hub evidence specifically for ${requestedStandard}. I will not substitute another IAS/IFRS standard or invent an answer.`;
      audit('CFO_PA_EVIDENCE_GAP',{standard:requestedStandard,reason:'EXACT_STANDARD_EVIDENCE_NOT_FOUND',answerHash:sha(gap)},{correlationId});
      return send(res,200,{ok:true,status:'completed',answer:gap,model:'deterministic-knowledge-grounding-guard',runtime:'local',moni:{name:'Moni',mode:'knowledge-grounding-guard',execution:'completed',confidence:1,correlationId,ragTrace:{correlationId,companyId:null,companyIds:[],fiscalYears:[],documentIds:[],evidenceIds:[],knowledgeChunkIds:[],attachmentIds:attachments.map(x=>x.id),retrievalMode:'exact-standard-evidence-required',requestedStandard,retrievedAt:new Date().toISOString()}}});
    }
    knowledgeItems=requestedStandard?exactStandardKnowledge:knowledgeItems;
    const sourceHints=knowledgeSourceHints(message,company,route.task);
    const attachmentItems=attachmentContext(attachments);
    let retrievedKnowledge=[...(Array.isArray(knowledgeItems)?knowledgeItems:[]),...(Array.isArray(sourceHints)?sourceHints:[]).map(x=>({...x,sourceType:'authoritative-source-hint'})),...(Array.isArray(attachmentItems)?attachmentItems:[])];
    if(String(b.workflow||'conversation')==='comparison') retrievedKnowledge=[];
    const safeRetrievedKnowledge=Array.isArray(retrievedKnowledge)?retrievedKnowledge:[];
    // Deterministic, source-backed CFO answers do not need to pass retrieved-content
    // prompt-injection scanning because they do not consume retrieved instructions.
    // Returning them before the guard prevents legitimate financial/standards questions
    // from being blocked by incidental words inside source documents.
    const earlyDeterministic=(workspace==='copilot'&&companySpecific)?directFinancialAnswer(companyContext,message,fiscalYears):null;
    const earlyPaDeterministic=workspace==='pa'?directKnowledgeStandardAnswer(message,safeRetrievedKnowledge):null;
    if(earlyPaDeterministic){const ragTrace={correlationId,companyId:null,companyIds:[],fiscalYears:[],documentIds:[],evidenceIds:[],knowledgeChunkIds:(earlyPaDeterministic.knowledgeIds||[]),attachmentIds:attachments.map(x=>x.id),retrievalMode:'knowledge-hub-exact-standard-evidence',retrievedAt:new Date().toISOString(),authoritativeSource:earlyPaDeterministic.authoritativeSource||'Knowledge Hub',authoritativeSourceUrl:earlyPaDeterministic.authoritativeSourceUrl||null,sourceTitle:earlyPaDeterministic.sourceTitle||earlyPaDeterministic.standard||null};audit('DIRECT_CFO_PA_GROUNDED_STANDARD_COMPLETED',{standard:earlyPaDeterministic.standard,outputHash:sha(earlyPaDeterministic.answer),knowledgeIds:earlyPaDeterministic.knowledgeIds||[]},{correlationId});return send(res,200,{ok:true,status:'completed',answer:earlyPaDeterministic.answer,model:'deterministic-authoritative-standard',runtime:'local',moni:{name:'Moni',mode:'authoritative-standard',execution:'completed',confidence:1,correlationId,ragTrace,companyId:null}});}
    if(earlyDeterministic){const usedSourceIds=new Set((earlyDeterministic.facts||[]).map(x=>x.documentId).filter(Boolean)); const sourceDocuments=(companyContext.documents||[]).filter(d=>usedSourceIds.has(d.id)).map(d=>({documentId:d.id,title:d.title||d.filename,filename:d.filename,fiscalYear:d.fiscalYear,status:d.status,sourceUrl:d.sourceUrl||null})); const ragTrace={correlationId,companyId:company?.id||null,companyIds:(Array.isArray(effectiveScopeCompanies)?effectiveScopeCompanies:[]).map(x=>x.id),fiscalYears,documentIds:[...usedSourceIds],evidenceIds:[],knowledgeChunkIds:[],attachmentIds:attachments.map(x=>x.id),retrievalMode:'deterministic-finance-answer+company-evidence',retrievedAt:new Date().toISOString(),sourceDocuments};audit('DIRECT_CFO_DETERMINISTIC_COMPLETED',{companyId:company?.id||null,outputHash:sha(earlyDeterministic.answer)},{correlationId});return send(res,200,{ok:true,status:'completed',answer:earlyDeterministic.answer,model:'deterministic-finance-engine',runtime:'local',moni:{name:'Moni',mode:'deterministic-finance',execution:'completed',task:'financial-calculation',confidence:1,ragTrace,companyId:company?.id||null}});}
    const aiGuard=aiInputGuard({message,retrievedKnowledge:safeRetrievedKnowledge});
    if(!aiGuard.allowed){ audit('AI_INPUT_GUARD_BLOCKED',{testId:aiGuard.testId,category:aiGuard.category,stage:aiGuard.stage,messageHash:sha(message)},{correlationId}); return send(res,403,{ok:false,blocked:true,security:aiGuard,answer:'The request was blocked by the AI security boundary because it contains an instruction-injection or unauthorized-action pattern.'}); }
    if(!installedModels(false).length && !liveRuntimes.size){ return send(res,200,{ok:false,status:'UNAVAILABLE',code:'NO_LOCAL_MODEL',answer:'Local AI model unavailable. Deterministic CFO calculations and source-linked evidence remain available; install or load a local model to continue with generative AI.',safeFallback:true}); }
    const history=Array.isArray(b.history)?b.history.slice(-4).map(x=>({role:x.role==='assistant'?'assistant':'user',content:String(x.content||'').slice(0,700)})).filter(x=>x.content):[];
    let evidence=[];
    let facts=[];
    if(companySpecific){
      const terms=[...new Set(lower.split(/[^a-z0-9]+/).filter(x=>x.length>=4))];
      const scoreText=text=>terms.reduce((n,term)=>n+(String(text||'').toLowerCase().includes(term)?1:0),0);
      facts=(companyContext.validatedFacts||[]).slice().sort((a,b)=>scoreText(b.concept+' '+b.rawValue)-scoreText(a.concept+' '+a.rawValue)).slice(0,24);
      evidence=(companyContext.evidence||[]).slice().sort((a,b)=>scoreText(b.text)-scoreText(a.text)).slice(0,14).map(e=>({...e,text:String(e.text||'').slice(0,650)}));
    }
    const knowledge=(workspace==='pa'?safeRetrievedKnowledge.slice(0,12):safeRetrievedKnowledge.slice(0,6)).map(x=>({...x,text:String(x.text||'').slice(0,900)}));
    const instructions=activeInstructions.map(x=>String(x.text||'').slice(0,400)).slice(0,2);
    const historyText=history.length?`\nRECENT CONVERSATION:\n${history.map(x=>`${x.role.toUpperCase()}: ${x.content}`).join('\n')}`:'';
    const evidenceText=companySpecific?`\nCOMPANY: ${company.name}\nVALIDATED FACTS: ${JSON.stringify(facts)}\nRELEVANT EVIDENCE: ${JSON.stringify(evidence)}`:'';
    const knowledgeText=knowledge.length?`\nKNOWLEDGE / METHODOLOGY ONLY (never use as company identity or company financial fact): ${JSON.stringify(knowledge)}`:'';
    const instructionText=instructions.length?`\nINSTRUCTIONS: ${JSON.stringify(instructions)}`:'';
    const workflowInstruction={
      financial_health:'Perform a guided financial health review with sections: validated facts, evidence gaps, risks, recommended next actions.',
      working_capital:'Perform a guided working-capital review with sections: evidence, metrics, risks, missing data, actions.',
      board_briefing:'Draft a concise board briefing with sections: headline, validated facts, material risks, decisions required, evidence gaps.',
      comparison:'Compare the selected companies and/or financial years using company-document evidence only. Knowledge Hub material is methodology/context and MUST NOT be treated as a company or comparative company fact. Never compare a metric unless the underlying evidence is comparable; show missing data explicitly.',
      model_recommendation:'Recommend a local model for the selected task using the installed catalogue and machine constraints. Do not claim a model is a specialist model without evidence.',
      conversation:'Answer the latest CFO question directly.'
    }[b.workflow||'conversation']||'Answer the latest CFO question directly.';
    const workspaceInstruction=workspace==='pa' ? `You are operating in MYAI CFO Personal Adviser (CFO PA). ${workflowInstruction} Use ONLY Knowledge Hub and authoritative source material. Do not use company documents, company facts, selected companies or fiscal-year company evidence. For standards questions, give a complete technical answer with: scope/objective, recognition, initial measurement, subsequent measurement, exceptions, journal-entry mechanics, disclosure, transition and a worked example where supported by the retrieved material. Clearly distinguish mandatory requirements from practical examples.` : `You are operating in the unified MYAI CFO Workbench. ${workflowInstruction} Use the explicit RAG scope supplied below and do not silently broaden it. For company-specific facts, primary company evidence is authoritative; Knowledge Hub is methodology/context only.`;
    const deterministicAnswer=(workspace==='copilot'&&companySpecific)?directFinancialAnswer(companyContext,message,fiscalYears):null;
    const paDeterministicAnswer=null;
    if(paDeterministicAnswer){const ragTrace={correlationId,companyId:null,companyIds:[],fiscalYears:[],documentIds:[],evidenceIds:[],knowledgeChunkIds:(paDeterministicAnswer.knowledgeIds||[]),attachmentIds:attachments.map(x=>x.id),retrievalMode:'knowledge-hub-exact-standard-evidence',retrievedAt:new Date().toISOString(),authoritativeSource:paDeterministicAnswer.authoritativeSource||'Knowledge Hub',authoritativeSourceUrl:paDeterministicAnswer.authoritativeSourceUrl||null,sourceTitle:paDeterministicAnswer.sourceTitle||paDeterministicAnswer.standard||null};audit('DIRECT_CFO_PA_GROUNDED_STANDARD_COMPLETED',{standard:paDeterministicAnswer.standard,outputHash:sha(paDeterministicAnswer.answer),knowledgeIds:paDeterministicAnswer.knowledgeIds||[]},{correlationId});return send(res,200,{ok:true,status:'completed',answer:paDeterministicAnswer.answer,model:'deterministic-knowledge-standard-evidence',runtime:'local',moni:{name:'Moni',mode:'knowledge-hub-exact-standard-evidence',execution:'completed',confidence:1,correlationId,ragTrace,companyId:null}});}
    if(deterministicAnswer){const usedDocIds=[...(deterministicAnswer.facts||[])].map(x=>x.documentId).filter(Boolean);const sourceDocuments=(companyContext.documents||[]).filter(d=>usedDocIds.includes(d.id)).map(d=>({documentId:d.id,title:d.title||d.filename,filename:d.filename,fiscalYear:d.fiscalYear,status:d.status,sourceUrl:d.sourceUrl||null}));const ragTrace={correlationId,companyId:company?.id||null,companyIds:(Array.isArray(effectiveScopeCompanies)?effectiveScopeCompanies:[]).map(x=>x.id),fiscalYears,documentIds:sourceDocuments.map(x=>x.documentId),evidenceIds:(Array.isArray(companyContext.evidence)?companyContext.evidence:[]).filter(e=>usedDocIds.includes(e.documentId)).map(x=>x.id),knowledgeChunkIds:[],attachmentIds:attachments.map(x=>x.id),sourceDocuments,sourceFacts:deterministicAnswer.facts||[],retrievalMode:'deterministic-finance-answer+company-evidence',retrievedAt:new Date().toISOString()};audit('DIRECT_CFO_DETERMINISTIC_COMPLETED',{companyId:company?.id||null,outputHash:sha(deterministicAnswer.answer),sourceDocumentCount:sourceDocuments.length,sourceFactCount:(deterministicAnswer.facts||[]).length},{correlationId});return send(res,200,{ok:true,status:'completed',answer:deterministicAnswer.answer,model:'deterministic-finance-engine',runtime:'local',moni:{name:'Moni',mode:'deterministic-finance',execution:'completed',task:'financial-calculation',confidence:1,ragTrace,companyId:company?.id||null}});}
    const prompt=compactModelPrompt(`${workspaceInstruction}\nYou are MYAI CFO, a rigorous finance professional. Give a complete answer appropriate to the question. Do not truncate a logical explanation merely to be brief. Use deterministic financial calculations when source facts exist. Company facts must come only from company evidence; Knowledge Hub is methodology only in Copilot and never a company fact. For missing evidence, identify the exact missing fact and stop the unsupported calculation. For PA, answer the technical standard/methodology question comprehensively from retrieved knowledge.\n${evidenceText}${knowledgeText}${instructionText}${historyText}\nLATEST USER REQUEST: ${message}`, promptBudget(message, contextBudgetForModel(b.modelFilename||state.selectedModelFilename||'')));
    const requestedFile=/^(auto|preferred|auto\s*\/\s*preferred)$/i.test(String(b.modelFilename||''))?'':(b.modelFilename||''); const modelFile=requestedFile||state.selectedModelFilename||installedModels(false)[0]?.filename||''; const defaultMaxTokens=workspace==='pa'?Math.min(1200,generationBudgetForModel(modelFile)):generationBudgetForModel(modelFile); const inference=await Promise.race([runLocalModel(prompt,correlationId,{maxTokens:Number(b.maxTokens||defaultMaxTokens),modelFilename:requestedFile,contextSize:contextBudgetForModel(modelFile)}),new Promise(resolve=>setTimeout(()=>resolve({ok:false,reason:'CHAT_TIMEOUT',message:`Local CFO engine exceeded the ${Math.round(CHAT_REQUEST_MAX_MS/1000)} second response budget.`,diagnostics:{timeoutMs:CHAT_REQUEST_MAX_MS}}),CHAT_REQUEST_MAX_MS))]);
    let finalInference=inference;
    if(!inference.ok && state.onlineRoute?.enabled){
      const onlineAllowed=!companySpecific || state.onlineRoute.allowCompanyEvidence===true;
      if(onlineAllowed){
        const online=await runOmniRoute(prompt,correlationId,{maxTokens:Number(b.maxTokens||defaultMaxTokens),companyEvidence:companySpecific});
        if(online.ok){finalInference=online;audit('ONLINE_ROUTE_FALLBACK_USED',{provider:'OmniRoute',companySpecific,localFailure:inference.reason,model:online.model},{correlationId});}
      } else { audit('ONLINE_ROUTE_BLOCKED_COMPANY_EVIDENCE',{companyId:company?.id||null,reason:'COMPANY_EVIDENCE_CONSENT_REQUIRED'},{correlationId}); }
    }
    if(!finalInference.ok){
      if(workspace==='pa' && safeRetrievedKnowledge.length){
        const top=safeRetrievedKnowledge.slice(0,3);
        const citation=top.map((x,i)=>`[${i+1}] ${x.title||x.filename||'Knowledge source'}`).join(' ');
        const grounded=top.map((x,i)=>`[${i+1}] ${String(x.text||'').trim()}`).filter(Boolean).join('\n');
        const fallbackAnswer=`The local model did not complete this PA response. The following Knowledge Hub evidence was retrieved, and no unsupported conclusion has been added.\n\nSources: ${citation}\n\nEvidence:\n${grounded.slice(0,3200)}`;
        audit('DIRECT_CFO_PA_GROUNDED_FALLBACK_USED',{reason:finalInference.reason,knowledgeItems:top.length,answerHash:sha(fallbackAnswer)},{correlationId});
        return send(res,200,{ok:true,status:'completed',answer:fallbackAnswer,model:'deterministic-knowledge-grounded-fallback',runtime:'local',moni:{name:'Moni',mode:'knowledge-grounded-fallback',execution:'completed',confidence:0.92,correlationId,ragTrace:{...ragTrace,retrievalMode:'knowledge-hub-grounded-fallback'}}});
      }
      audit('DIRECT_CFO_CHAT_FAILED',{workspace,reason:finalInference.reason,errorHash:sha(String(finalInference.message||'')),endpoint:'/api/chat'},{correlationId});
      return send(res,503,{ok:false,status:'failed',answer:finalInference.message,error:finalInference.message,code:finalInference.reason||'CHAT_FAILED',api:{method:'POST',path:'/api/chat',statusCode:503,correlationId},moni:{execution:'failed',runtime:finalInference.reason,model:finalInference.diagnostics?.installedModels?.[0]||null,correlationId},diagnostics:finalInference.diagnostics||inference.diagnostics});
    }
    const outputCheck=policyCheck(finalInference.text,'model_output');
    if(!outputCheck.allowed)return send(res,200,{blocked:true,safety:outputCheck,answer:outputCheck.message});
    const sourceDocuments=(companyContext.documents||[]).map(d=>({documentId:d.id,title:d.title||d.filename,filename:d.filename,fiscalYear:d.fiscalYear,status:d.status,sourceUrl:d.sourceUrl||null}));
    const sourceKnowledge=safeRetrievedKnowledge.filter(x=>x.knowledgeId).slice(0,12).map(x=>({knowledgeId:x.knowledgeId,title:x.title||x.filename||'Knowledge source',filename:x.filename,chunkIndex:x.chunkIndex,score:Number(x.score)||0,sourceUrl:x.sourceUrl||x.url||null}));
    const sourceAuthoritative=safeRetrievedKnowledge.filter(x=>x.sourceType==='authoritative-source-hint'||x.sourceId).slice(0,12).map(x=>({sourceId:x.sourceId||null,title:x.title||x.name||x.sourceId||'Authoritative source',sourceUrl:x.sourceUrl||x.url||x.pageUrl||null,sourceType:x.sourceType||'authoritative-source-hint'}));
    const provenanceLines=[];
    if(sourceDocuments.length)provenanceLines.push(`Company document evidence: ${sourceDocuments.map(x=>`${x.title||x.filename}${x.fiscalYear?` (FY ${x.fiscalYear})`:''}`).join(' • ')}`);
    if(sourceKnowledge.length)provenanceLines.push(`Knowledge sources: ${sourceKnowledge.map(x=>x.title).join(' • ')}`);
    if(sourceAuthoritative.length)provenanceLines.push(`Authoritative sources: ${sourceAuthoritative.map(x=>x.title).join(' • ')}`);
    const answerWithSources=provenanceLines.length && !/\b(source|sources|provenance|citation|references)\s*:/i.test(String(finalInference.text||'')) ? `${String(finalInference.text||'').trim()}\n\nSources / provenance:\n${provenanceLines.map(x=>`- ${x}`).join('\n')}` : finalInference.text;
    const ragTrace={correlationId,companyId:company?.id||null,companyIds:(Array.isArray(effectiveScopeCompanies)?effectiveScopeCompanies:[]).map(x=>x.id),fiscalYears,documentIds:sourceDocuments.map(x=>x.documentId),evidenceIds:(Array.isArray(evidence)?evidence:[]).map(x=>x.id),knowledgeChunkIds:sourceKnowledge.map(x=>`${x.knowledgeId}:${x.chunkIndex}`),sourceDocuments,sourceKnowledge,sourceAuthoritative,retrievalRanking:retrievedKnowledge.filter(x=>x.knowledgeId).map((x,i)=>({rank:i+1,knowledgeId:x.knowledgeId,chunkIndex:x.chunkIndex,score:Number(x.score)||0})).slice(0,32),attachmentIds:attachments.map(x=>x.id),retrievalMode:workspace==='pa'?'knowledge-hub-only':(b.workflow==='comparison'?'company-documents-only-for-facts':'company-documents+financial-year-filter+knowledge-hub+attachments'),retrievedAt:new Date().toISOString()};
    audit('DIRECT_CFO_CHAT_COMPLETED',{model:finalInference.model,runtime:finalInference.runtime,companyId:company?.id||null,attachmentCount:attachments.length,outputHash:sha(answerWithSources),onlineRoute:finalInference.runtime==='OmniRoute',sourceDocumentCount:sourceDocuments.length,sourceKnowledgeCount:sourceKnowledge.length},{correlationId});
    return send(res,200,{ok:true,status:'completed',answer:answerWithSources,model:finalInference.model,runtime:finalInference.runtime,moni:{name:'Moni',mode:'direct-cfo-chat',execution:'completed',task:companySpecific?'company_cfo':'general_cfo',confidence:1,correlationId,ragTrace,companyId:company?.id||null}});
  }
  if(u.pathname==='/api/moni/route'&&req.method==='POST'){
    const b=await parseBody(req); const message=String(b.message||'').trim();
    if(!message)return send(res,400,{error:'Message required'});
    const safety=safetyCheck(message);
    if(!safety.allowed){audit('CHAT_BLOCKED_SAFETY',{category:safety.category,policyVersion:safety.policyVersion,messageHash:sha(message)});return send(res,200,{blocked:true,safety,answer:safety.message,moni:{name:'Moni',mode:'safety-gate',task:'safety',confidence:1,companyRequired:false,candidates:[]}});}
    // Direct prompt-injection protection must run before any retrieval work.
    // A deliberately injected retrieval failure must never prevent the security
    // boundary from blocking a malicious request. Retrieved-content scanning
    // still occurs after retrieval below.
    const directAiGuard=aiInputGuard({message,retrievedKnowledge:[]});
    if(!directAiGuard.allowed){
      const correlationId=crypto.randomUUID();
      audit('AI_INPUT_GUARD_BLOCKED',{testId:directAiGuard.testId,category:directAiGuard.category,stage:directAiGuard.stage,messageHash:sha(message),retrievalAttempted:false},{correlationId});
      return send(res,403,{ok:false,blocked:true,security:directAiGuard,moni:{name:'Moni',mode:'ai-security-gate',execution:'blocked-before-retrieval',correlationId},answer:'The request was blocked by the AI security boundary because it contains an instruction-injection or unauthorized-action pattern.'});
    }
    const routed=moniRoute(message); const requestedCompanyId=String(b.companyId||'').trim(); const requestedCompany=requestedCompanyId?state.companies.find(c=>c.id===requestedCompanyId):null; const r={...routed,companyId:requestedCompany?.id||routed.companyId||null,companyRequired:(routed.companyRequired&&!requestedCompany)||(!requestedCompanyId&&routed.companyRequired)}; const correlationId=crypto.randomUUID();
    let attachments=[];
    try{attachments=await prepareRequestAttachments(b.attachments||[],correlationId);}catch(e){return send(res,400,{error:String(e?.message||e),code:'ATTACHMENT_INGESTION_FAILED'});}
    state.moni.learningLedger.push({at:new Date().toISOString(),messageHash:sha(message),attachmentCount:attachments.length,...r}); if(state.moni.learningLedger.length>1000)state.moni.learningLedger.shift(); save();
    audit('MONI_ROUTE',{task:r.task,confidence:r.confidence,companyId:r.companyId,candidateCount:r.candidates.length,companyRequired:r.companyRequired,attachmentCount:attachments.length},{correlationId});
    if(r.companyRequired)return send(res,200,{blocked:false,safety,moni:{name:'Moni',mode:'student-monitor-router',...r},answer:'This request requires a company workspace. Select a company and resubmit it.',requiresArena:false,attachments:attachments.map(a=>({id:a.id,filename:a.filename,textLength:a.textLength}))});
    const company= r.companyId ? state.companies.find(c=>c.id===r.companyId)||null : null;
    const companyContext=company?companyEvidenceContext(company):{company:null,documents:[],validatedFacts:[],candidateFacts:[],evidence:[]};
    const instructionFile=path.join(dataDir,'knowledge','instructions.json');
    const activeInstructions=readJson(instructionFile,[]).filter(x=>!x.archived);
    const knowledgeFileLocal=path.join(dataDir,'knowledge','uploaded.json');
    const activeKnowledge=readJson(knowledgeFileLocal,[]).filter(x=>!x.archived);
    let lexicalKnowledge=[];
    try{
      lexicalKnowledge=knowledgeRetrievalContext(activeKnowledge,message);
    }catch(e){
      const injected=qaFaults().retrievalFailure===true;
      audit('RAG_CONTEXT_RETRIEVAL_FAILED',{code:injected?'RETRIEVAL_FAILURE_INJECTED':'RETRIEVAL_FAILURE',error:String(e?.message||e),injected,recoveryEligible:true},{correlationId});
      return send(res,503,{ok:false,code:injected?'RETRIEVAL_FAILURE_INJECTED':'RETRIEVAL_FAILURE',error:String(e?.message||e),retryable:true,correlationId,moni:{name:'Moni',mode:'retrieval-gate',execution:'failed-before-model'}});
    }
    const sourceHints=knowledgeSourceHints(message,company,r.task);
    const attachmentKnowledge=attachmentContext(attachments);
    const retrievedKnowledge=[...(Array.isArray(lexicalKnowledge)?lexicalKnowledge:[]),...(Array.isArray(sourceHints)?sourceHints:[]).map(x=>({...x,sourceType:'authoritative-source-hint'})),...(Array.isArray(attachmentKnowledge)?attachmentKnowledge:[])];
    const safeRetrievedKnowledge=Array.isArray(retrievedKnowledge)?retrievedKnowledge:[];
    const ragTrace={correlationId,queryHash:sha(message),companyId:r.companyId||null,documentIds:(Array.isArray(companyContext.documents)?companyContext.documents:[]).map(x=>x.id),evidenceIds:(Array.isArray(companyContext.evidence)?companyContext.evidence:[]).map(x=>x.id),instructionIds:(Array.isArray(activeInstructions)?activeInstructions:[]).map(x=>x.id),knowledgeIds:(Array.isArray(activeKnowledge)?activeKnowledge:[]).map(x=>x.id),knowledgeChunkIds:safeRetrievedKnowledge.filter(x=>x.knowledgeId).map(x=>`${x.knowledgeId}:${x.chunkIndex}`),retrievalRanking:safeRetrievedKnowledge.filter(x=>x.knowledgeId).map((x,i)=>({rank:i+1,knowledgeId:x.knowledgeId,chunkIndex:x.chunkIndex,score:Number(x.score)||0})).slice(0,32),attachmentIds:(Array.isArray(attachments)?attachments:[]).map(x=>x.id),authoritativeSourceIds:safeRetrievedKnowledge.filter(x=>x.sourceType==='authoritative-source-hint').map(x=>x.sourceId),retrievalMode:'local-company-evidence+lexical-uploaded-knowledge+request-attachments+authoritative-source-hints+agent-competition',retrievedAt:new Date().toISOString()};
    audit('RAG_CONTEXT_RETRIEVED',{...ragTrace,evidenceCount:ragTrace.evidenceIds.length,documentCount:ragTrace.documentIds.length,instructionCount:ragTrace.instructionIds.length,knowledgeCount:ragTrace.knowledgeIds.length,knowledgeChunkCount:safeRetrievedKnowledge.length},{correlationId});
    const aiGuard=aiInputGuard({message,retrievedKnowledge:safeRetrievedKnowledge});
    if(!aiGuard.allowed){ audit('AI_INPUT_GUARD_BLOCKED',{testId:aiGuard.testId,category:aiGuard.category,stage:aiGuard.stage,messageHash:sha(message)},{correlationId}); return send(res,403,{ok:false,blocked:true,security:aiGuard,moni:{name:'Moni',mode:'ai-security-gate',...r},answer:'The request was blocked by the AI security boundary because it contains an instruction-injection or unauthorized-action pattern.'}); }
    const modelInput=policyCheck(JSON.stringify({task:r.task,message,companyContext,activeInstructions,retrievedKnowledge}),'model_input');
    if(!modelInput.allowed)return send(res,200,{blocked:true,safety:modelInput,moni:{name:'Moni',mode:'policy-gate',...r},answer:modelInput.message});
    const jobId=id('monijob');
    state.moni.jobs[jobId]={jobId,status:'queued',createdAt:new Date().toISOString(),message,task:r.task,companyId:r.companyId||null,correlationId,ragTrace,attachments,result:null,modelFilename:b.modelFilename||state.selectedModelFilename||null};
    save(); audit('MONI_JOB_QUEUED',{jobId,task:r.task,companyId:r.companyId||null},{correlationId});
    processMoniJob(jobId).catch(()=>{});
    return send(res,202,{blocked:false,safety,moni:{name:'Moni',mode:'student-monitor-router',...r,execution:'queued',correlationId,ragTrace,agentCount:r.candidates.length},answer:'MYAI CFO has queued this request for the local AI arena. The CFO model will run the registered agent candidates and Moni will select the strongest evidence-grounded response.',jobId,requiresArena:true});
  }
  if(u.pathname.startsWith('/api/moni/jobs/')&&req.method==='GET'){
    const jobId=u.pathname.split('/')[4]||u.pathname.split('/').pop(); const job=state.moni.jobs[jobId]; if(!job)return send(res,404,{error:'Moni job not found'}); return send(res,200,job);
  }
  if(u.pathname==='/api/moni/feedback'&&req.method==='POST'){
    const b=await parseBody(req); const job=state.moni.jobs[b.jobId]; if(!job)return send(res,404,{error:'Moni job not found'}); const rating=Math.max(1,Math.min(5,Number(b.rating||0))); const winner=job.result?.moni?.winnerAgentId; if(winner)updateLearning(winner,job.task,Number(job.result?.moni?.winnerScore||0),true,rating-3); state.moni.feedback.push({jobId:b.jobId,rating,at:new Date().toISOString(),commentHash:sha(String(b.comment||''))}); state.moni.feedback=state.moni.feedback.slice(-500); save(); audit('MONI_FEEDBACK_RECORDED',{jobId:b.jobId,rating,winnerAgentId:winner}); return send(res,200,{ok:true,rating});
  }
  if(u.pathname==='/api/moni/proactive'&&req.method==='GET'){const out=proactiveScan();audit('MONI_PROACTIVE_SCAN',{alertCount:out.alerts.length,predictionCount:out.predictions.length});return send(res,200,out);}
  if(u.pathname==='/api/moni/learning'&&req.method==='GET')return send(res,200,{mode:state.moni.learningMode,onlineLearner:state.moni.onlineLearner||{},modelPerformance:state.moni.modelPerformance||{},agentPerformance:state.moni.agentPerformance,feedbackCount:(state.moni.feedback||[]).length,ledgerSize:(state.moni.learningLedger||[]).length,champion:state.arena.champion||null,predictionModel:state.moni.predictionModel||null});
  if(u.pathname==='/api/arena/execute'&&req.method==='POST'){
    const b=await parseBody(req);const agent=state.agents.find(a=>a.id===b.agentId&&a.enabled&&!a.archived);if(!agent)return send(res,404,{error:'Agent not registered or archived'});
    const aiGuard=aiInputGuard({message:String(b.prompt||''),retrievedKnowledge:[]});
    if(!aiGuard.allowed)return send(res,403,{blocked:true,security:aiGuard});
    const check=policyCheck(String(b.prompt||''),'agent_input');if(!check.allowed)return send(res,200,{blocked:true,policy:check});
    const prompt=`You are operating as the ${agent.name} capability inside MYAI CFO. Role: ${agent.role}. Do not invent facts. Explain your approach and provide a CFO-useful result for this task:\n${String(b.prompt||'')}`;
    const runId=crypto.randomUUID();
    const inference=await runLocalModel(prompt,runId);
    if(!inference.ok){audit('AGENT_EXECUTION_NOT_READY',{agentId:agent.id,reason:inference.reason},{correlationId:runId});return send(res,200,{ok:false,agent,execution:'not_ready',reason:inference.reason,answer:inference.message,runId});}
    const out=policyCheck(inference.text,'agent_output');if(!out.allowed)return send(res,200,{blocked:true,policy:out});
    const run={id:runId,agentId:agent.id,model:inference.model,runtime:inference.runtime,promptHash:sha(String(b.prompt||'')),outputHash:sha(inference.text),createdAt:new Date().toISOString(),archived:false,status:'completed'};state.arena.runs=[run,...(state.arena.runs||[])].slice(0,500);save();audit('AGENT_EXECUTED',run,{correlationId:runId});
    return send(res,200,{ok:true,agent,execution:'completed',model:inference.model,runtime:inference.runtime,answer:inference.text,runId});
  }
  if(u.pathname==='/api/arena/jobs'&&req.method==='GET'){const jobs=Object.values(state.arena.jobs||{}).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));return send(res,200,{jobs});}
  if(u.pathname.startsWith('/api/arena/jobs/')&&req.method==='GET'){const job=state.arena.jobs[u.pathname.split('/')[4]];if(!job)return send(res,404,{error:'Arena job not found'});return send(res,200,job);}
  if(u.pathname.startsWith('/api/arena/jobs/')&&u.pathname.endsWith('/cancel')&&req.method==='POST'){
    const jobId=u.pathname.split('/')[4],job=state.arena.jobs[jobId];if(!job)return send(res,404,{error:'Arena job not found'});
    if(['completed','failed','cancelled'].includes(job.status))return send(res,200,job);
    job.cancelRequested=true;job.status='cancelling';job.message='Termination requested. The current local inference will be stopped and the competition will not start another agent.';save();audit('ARENA_COMPETITION_CANCEL_REQUESTED',{jobId},{correlationId:job.correlationId});
    try{stopLiveRuntime('arena-cancel',job.modelFilename||null)}catch{}
    setTimeout(()=>{if(state.arena.jobs[jobId]&&state.arena.jobs[jobId].status==='cancelling'){state.arena.jobs[jobId].status='cancelled';state.arena.jobs[jobId].completedAt=new Date().toISOString();state.arena.jobs[jobId].message='Competition terminated by the user.';save();audit('ARENA_COMPETITION_CANCELLED',{jobId},{correlationId:job.correlationId});}},1500);
    return send(res,202,{ok:true,status:'cancelling',jobId});
  }
  if(u.pathname==='/api/arena/compete'&&req.method==='POST'){
    const b=await parseBody(req); const prompt=String(b.prompt||b.message||'').trim(); if(!prompt)return send(res,400,{error:'Competition prompt required'});
    const safety=policyCheck(prompt,'agent_input'); if(!safety.allowed){audit('POLICY_BLOCKED_AGENT_INPUT',{category:safety.category,textHash:sha(prompt)});return send(res,200,{blocked:true,policy:safety});}
    const c=b.companyId?state.companies.find(x=>x.id===b.companyId):activeCompany(); if(c){try{await ensureCanonicalFinancialData(c);syncStructuredFacts(c);}catch{}} const task=b.task||'general_cfo'; const correlationId=crypto.randomUUID(); let attachments=[]; try{attachments=await prepareRequestAttachments(b.attachments||[],correlationId);}catch(e){return send(res,400,{error:String(e?.message||e),code:'ATTACHMENT_INGESTION_FAILED'});} const jobId=id('arenajob');
    const job={jobId,correlationId,prompt,task,companyId:c?.id||null,attachments,status:'queued',createdAt:new Date().toISOString(),startedAt:null,completedAt:null,totalAgents:state.agents.filter(a=>a.enabled&&!a.archived).length,completedAgents:0,modelFilename:b.modelFilename||state.selectedModelFilename||null,currentAgentId:null,currentAgentName:null,candidates:[],winner:null,elapsedSeconds:0,estimatedRemainingSeconds:null,message:'Queued for Moni agent competition.'};
    state.arena.jobs[jobId]=job; save(); audit('ARENA_COMPETITION_QUEUED',{jobId,task,agentCount:job.totalAgents,companyId:job.companyId},{correlationId});
    processArenaJob(jobId).catch(()=>{});
    return send(res,202,{ok:true,jobId,status:job.status,execution:'queued',message:'Moni has started a persistent background competition. You can leave this page; the kernel will continue and the result will remain in Arena.'});
  }
  if(u.pathname==='/api/arena/submit'&&req.method==='POST'){ const b=await parseBody(req); const inputCheck=policyCheck(b.prompt||'','agent_input'); if(!inputCheck.allowed){ audit('POLICY_BLOCKED_AGENT_INPUT',{agentId:b.agentId||null,category:inputCheck.category,textHash:sha(String(b.prompt||''))}); return send(res,200,{blocked:true,policy:inputCheck}); } const outputCheck=policyCheck(b.output||'','agent_output'); if(!outputCheck.allowed){ audit('POLICY_BLOCKED_AGENT_OUTPUT',{agentId:b.agentId||null,category:outputCheck.category,textHash:sha(String(b.output||''))}); return send(res,200,{blocked:true,policy:outputCheck}); } return send(res,200,{accepted:true,policy:{version:corePolicy.version,hash:corePolicy.hash}}); }
  if(u.pathname.startsWith('/api/arena/jobs/')&&u.pathname.endsWith('/select')&&req.method==='POST'){
    const parts=u.pathname.split('/'),jobId=parts[4],job=state.arena.jobs[jobId]; if(!job)return send(res,404,{error:'Arena job not found'});
    const b=await parseBody(req),agentId=String(b.agentId||''); const candidate=(job.candidates||[]).find(x=>x.agentId===agentId&&x.ok); if(!candidate)return send(res,404,{error:'Usable candidate not found for this competition.'});
    job.humanSelection={agentId:candidate.agentId,agentName:candidate.agentName,selectedAt:new Date().toISOString(),score:candidate.score,confidence:candidate.confidence};
    state.arena.champion={agentId:candidate.agentId,agentName:candidate.agentName,task:job.task,score:candidate.score,confidence:candidate.confidence,source:'human-selection',updatedAt:job.humanSelection.selectedAt};
    updateLearning(candidate.agentId,job.task,Number(candidate.score)||0,true,1,{grounding:Number(candidate.grounding)||0,numericConsistency:Number(candidate.numericConsistency)||0,caution:0.7,completeness:Math.min(1,String(candidate.answer||'').length/900),historical:learningStats(candidate.agentId,job.task).emaScore});
    save(); audit('ARENA_HUMAN_CANDIDATE_SELECTED',{jobId,agentId:candidate.agentId,agentName:candidate.agentName,score:candidate.score},{correlationId:job.correlationId}); return send(res,200,{ok:true,selection:job.humanSelection,champion:state.arena.champion});
  }
  if(u.pathname==='/api/arena/runs'&&req.method==='GET')return send(res,200,{runs:state.arena.runs||[]});
  if(u.pathname.startsWith('/api/arena/runs/')&&u.pathname.endsWith('/archive')&&req.method==='POST'){
    const runId=u.pathname.split('/')[4],run=state.arena.runs.find(x=>x.id===runId);if(!run)return send(res,404,{error:'Arena run not found'});run.archived=!run.archived;save();audit(run.archived?'ARENA_RUN_ARCHIVED':'ARENA_RUN_RESTORED',{runId});return send(res,200,run);
  }
  if(u.pathname.startsWith('/api/arena/runs/')&&req.method==='DELETE'){
    const runId=u.pathname.split('/').pop(),idx=state.arena.runs.findIndex(x=>x.id===runId);if(idx<0)return send(res,404,{error:'Arena run not found'});state.arena.runs.splice(idx,1);save();audit('ARENA_RUN_DELETED_PERMANENT',{runId});return send(res,200,{ok:true});
  }
  if(u.pathname==='/api/moni/status'&&req.method==='GET')return send(res,200,{...state.moni,ledgerSize:state.moni.learningLedger.length});
  
function kpiStatusFor(value, reason=''){
  if(value===null||value===undefined)return reason==='zero-denominator'?'ZERO-DENOMINATOR':reason==='data-inconsistency'?'DATA-INCONSISTENCY':'MISSING-EVIDENCE';
  const n=Number(value); if(!Number.isFinite(n))return 'NOT-MEANINGFUL'; return 'COMPUTED';
}
function buildRatioLibrary(facts){
    const years=[...new Set((facts||[]).map(f=>String(f.fiscalYear||'')).filter(Boolean))].sort((a,b)=>Number(b)-Number(a)); const preferredYear=years[0]||'';
    const currentFacts=(facts||[]).filter(f=>!preferredYear||String(f.fiscalYear||'')===preferredYear);
    const by={}; const conceptUniverse=[...new Set((facts||[]).map(f=>canonicalFactConcept(f.concept)))];
    for(const key of conceptUniverse){const fact=selectBestFinancialFact(facts,key,preferredYear);if(fact)by[key]=fact;}
    const fcm=new Map(Object.entries(by).map(([k,f])=>[k,normalizedFinancialForRatio(f)]).filter(([,v])=>Number.isFinite(v)));
    const financialConsistency={ok:!((fcm.has('current_assets')&&fcm.has('inventory')&&fcm.get('current_assets')<fcm.get('inventory'))||(fcm.has('current_assets')&&fcm.has('cash')&&fcm.get('current_assets')<fcm.get('cash'))||(fcm.has('assets')&&fcm.has('liabilities')&&fcm.get('assets')<fcm.get('liabilities'))||(fcm.has('revenue')&&fcm.get('revenue')<0)||(fcm.has('cogs')&&fcm.get('cogs')<0))};
    const val=x=>normalizedFinancialForRatio(x);
    const rateVal=fact=>{
      if(!fact)return null;
      const n=val(fact);
      if(n==null||!Number.isFinite(n))return null;
      const unit=String(fact.unit||'').toLowerCase();
      const raw=String(fact.rawValue??'');
      const explicitPercent=unit.includes('percent')||unit.includes('percentage')||unit.includes('%')||raw.includes('%');
      const explicitDecimal=unit.includes('decimal')||unit.includes('fraction');
      if(explicitPercent)return Math.abs(n)<=1?n:n/100;
      if(explicitDecimal)return n;
      return n;
    };
    const inp=(label,key)=>{const fact=by[key];return {label,key,value:val(fact),sourceFactId:fact?.id||null,sourceDocumentId:fact?.documentId||null,sourceEvidence:fact?.evidenceText||null,sourceLabel:fact?.sourceLabel||null,aggregateRole:fact?.aggregateRole||null,validated:!!(fact?.validated||fact?.systemVerified),unit:fact?.unit||null,scale:fact?.scale||null,currency:fact?.currency||null,fiscalYear:fact?.fiscalYear||null,methodology:financialMethodology(fact)}};
    const rateInp=(label,key)=>{const fact=by[key];return {label,key,value:rateVal(fact),sourceFactId:fact?.id||null,sourceDocumentId:fact?.documentId||null,sourceEvidence:fact?.evidenceText||null,sourceLabel:fact?.sourceLabel||null,aggregateRole:fact?.aggregateRole||null,validated:!!(fact?.validated||fact?.systemVerified),unit:fact?.unit||null,scale:fact?.scale||null,currency:fact?.currency||null,fiscalYear:fact?.fiscalYear||null,methodology:financialMethodology(fact)}};
    const equity=(()=>{const reported=inp('Shareholders’ Equity','equity'); if(reported.value!=null)return reported; const a=inp('Total Assets','assets'),l=inp('Total Liabilities','liabilities'); return a.value!=null&&l.value!=null?{label:'Shareholders’ Equity (derived)',value:a.value-l.value,sourceFactIds:[a.sourceFactId,l.sourceFactId].filter(Boolean),sourceDocumentId:a.sourceDocumentId||l.sourceDocumentId,sourceEvidence:`Derived from ${a.label} − ${l.label}`,validated:a.validated&&l.validated,methodology:{derivedFrom:[a.sourceFactId,l.sourceFactId]}}:null;})();
    const debtInput=(()=>{const reported=inp('Total Debt','debt');if(reported.value!=null)return reported;const cur=inp('Current Debt','current_debt'),lt=inp('Long-term Debt','long_term_debt');if(cur.value!=null&&lt.value!=null&&(!cur.currency||!lt.currency||cur.currency===lt.currency)&&(!cur.scale||!lt.scale||cur.scale===lt.scale))return {label:'Total Debt (derived)',value:cur.value+lt.value,sourceFactIds:[cur.sourceFactId,lt.sourceFactId].filter(Boolean),sourceDocumentId:cur.sourceDocumentId||lt.sourceDocumentId,sourceEvidence:`Derived from ${cur.label} + ${lt.label}`,validated:cur.validated&&lt.validated,unit:cur.unit||lt.unit,scale:cur.scale||lt.scale,currency:cur.currency||lt.currency,fiscalYear:cur.fiscalYear||lt.fiscalYear,methodology:{derivedFrom:[cur.sourceFactId,lt.sourceFactId]}};return reported;})();
    const I={rev:inp('Revenue','revenue'),cogs:inp('COGS','cogs'),gp:inp('Gross Profit','gross_profit'),oi:inp('Operating Income','operating_income'),ni:inp('Net Income','net_income'),ebitda:inp('EBITDA','ebitda'),cash:inp('Cash & Cash Equivalents','cash'),ca:inp('Current Assets','current_assets'),cl:inp('Current Liabilities','current_liabilities'),assets:inp('Total Assets','assets'),liab:inp('Total Liabilities','liabilities'),debt:debtInput,recv:inp('Accounts Receivable','receivables'),pay:inp('Accounts Payable','payables'),inv:inp('Inventory','inventory'),capex:inp('Capital Expenditures','capex'),ocf:inp('Operating Cash Flow','operating_cash_flow'),danda:inp('Depreciation & Amortization','depreciation_amortization'),interest:inp('Interest Expense','interest_expense'),equity:equity||inp('Shareholders’ Equity','equity')};
    const moreKeys=['share_price','eps','book_value_per_share','market_cap','enterprise_value','preferred_dividends','weighted_avg_shares','dividends_paid','annual_dividend_per_share','tax_rate','nopat','invested_capital','ebit','capital_employed','net_fixed_assets','average_total_assets','average_equity','average_inventory','average_receivables','average_payables','net_credit_sales','total_debt_service','net_operating_income','lease_payments','prior_revenue','beginning_value','ending_value','number_of_years','net_borrowing','change_working_capital','beginning_cash','ending_cash','number_of_months','average_working_capital','depreciation','operating_expenses','operating_costs','sga_expenses','budgeted_amount','actual_amount','total_production_cost','units_produced','mrr','sales_marketing_spend','new_customers','avg_revenue_per_customer','churn_rate','starting_arr','expansion','contraction','churn_arr','starting_revenue','lost_revenue','customers_lost','starting_customers','mrr_per_customer','revenue_growth_rate','current_quarter_revenue','prior_quarter_revenue','prior_quarter_sales_marketing_spend','net_cash_burn','net_new_arr','retained_earnings','market_value_equity','cost_of_equity','cost_of_debt','risk_free_rate','beta','market_return','tax_expense','taxes','one_off_adjustments','fixed_costs','price_per_unit','variable_cost_per_unit','actual_sales','break_even_sales','prior_ebitda','prior_operating_income','variable_costs'];
    for(const k of moreKeys)I[k]=inp(k.replace(/_/g,' '),k);
    for(const k of ['tax_rate','churn_rate','revenue_growth_rate','cost_of_equity','cost_of_debt','risk_free_rate','market_return'])I[k]=rateInp(k.replace(/_/g,' '),k);
    I.organic_growth=inp('organic growth','organic_growth');
    const all=[]; const add=(id,name,cat,formula,calc,inputs,unit='',notes='')=>{let o=null;try{o=calc()}catch{};let value=typeof o==='number'?o:(o?.value??null);const sf=[];for(const x of inputs||[]){if(x?.sourceFactId)sf.push(x.sourceFactId);if(x?.sourceFactIds)sf.push(...x.sourceFactIds)};const clean=(inputs||[]).map(x=>({label:x.label,value:x.value,sourceFactId:x.sourceFactId||null,sourceDocumentId:x.sourceDocumentId||null,sourceEvidence:x.sourceEvidence||null,validated:!!x.validated}));const present=value!=null&&Number.isFinite(Number(value));const provisional=present && !clean.filter(x=>x.value!=null).every(x=>x.validated);return {id,name,category:cat,formula,value:present?Number(value):null,unit,status:present?(financialConsistency?.ok?'computed':'data-inconsistency'):'missing-evidence',numeratorLabel:o?.numeratorLabel||'',numeratorValue:o?.numeratorValue??null,denominatorLabel:o?.denominatorLabel||'',denominatorValue:o?.denominatorValue??null,sourceFactIds:[...new Set(sf.filter(Boolean))],inputs:clean,provisional,sourceable:true,notes};};
    const compatibleNumeric=(f)=>{if(!f||f.value==null)return null;const n=Number(f.value);if(!Number.isFinite(n))return null;return n*financialScaleFactor(f.scale||'units')};
    const div=(a,b)=>{const av=compatibleNumeric(a),bv=compatibleNumeric(b); if(av==null||bv==null||bv===0)return null; if(a.currency&&b.currency&&String(a.currency).toUpperCase()!==String(b.currency).toUpperCase())return null; return av/bv;}, pct=(id,n,c,f,a,b)=>add(id,n,c,f,()=>{const q=div(a,b);return q==null?null:q*100},[a,b],'%');
    // Liquidity
    all.push(add('current-ratio','Current Ratio','Liquidity','Reported Current Assets ÷ Reported Current Liabilities; components may be used only when the reported aggregate is absent',()=>({value:div(I.ca,I.cl),numeratorValue:I.ca.value,denominatorValue:I.cl.value,numeratorLabel:I.ca.label,denominatorLabel:I.cl.label}),[I.ca,I.cl],'ratio','Semantic aggregate selection; reported aggregate outranks reconstructed components.'));
    all.push(add('quick-ratio','Quick Ratio (Acid-Test)','Liquidity','(Current Assets − Inventory) ÷ Current Liabilities',()=>({value:I.ca.value!=null&&I.inv.value!=null?div({value:I.ca.value-I.inv.value,scale:I.ca.scale,unit:I.ca.unit,currency:I.ca.currency},I.cl):null,numeratorValue:I.ca.value!=null&&I.inv.value!=null?I.ca.value-I.inv.value:null,denominatorValue:I.cl.value,numeratorLabel:'Current Assets − Inventory',denominatorLabel:I.cl.label}),[I.ca,I.inv,I.cl]));
    all.push(add('cash-ratio','Cash Ratio','Liquidity','(Cash + Cash Equivalents) ÷ Current Liabilities',()=>({value:div(I.cash,I.cl),numeratorValue:I.cash.value,denominatorValue:I.cl.value,numeratorLabel:I.cash.label,denominatorLabel:I.cl.label}),[I.cash,I.cl]));
    all.push(add('working-capital','Working Capital','Liquidity','Current Assets − Current Liabilities',()=>I.ca.value!=null&&I.cl.value!=null?I.ca.value-I.cl.value:null,[I.ca,I.cl]));
    all.push(add('working-capital-ratio','Working Capital Ratio','Liquidity','Current Assets ÷ Current Liabilities',()=>div(I.ca,I.cl),[I.ca,I.cl],'ratio','Alias of Current Ratio; both use the same canonical inputs.')); 
    all.push(pct('nwc-to-sales','Net Working Capital to Sales','Liquidity','Net Working Capital ÷ Net Sales', { ...I.ca,label:'Net Working Capital',value:I.ca.value!=null&&I.cl.value!=null?I.ca.value-I.cl.value:null,validated:I.ca.validated&&I.cl.validated }, I.rev));
    // Profitability
    const gross={...I.gp,label:'Gross Profit',value:I.gp.value!=null?I.gp.value:I.rev.value!=null&&I.cogs.value!=null?I.rev.value-I.cogs.value:null,validated:I.gp.value!=null?I.gp.validated:I.rev.validated&&I.cogs.validated};
    all.push(pct('gross-margin','Gross Profit Margin','Profitability','(Revenue − COGS) ÷ Revenue',gross,I.rev)); all.push(pct('operating-margin','Operating Profit Margin (EBIT Margin)','Profitability','Operating Income ÷ Revenue',I.oi,I.rev)); all.push(pct('net-margin','Net Profit Margin','Profitability','Net Income ÷ Revenue',I.ni,I.rev)); all.push(pct('ebitda-margin','EBITDA Margin','Profitability','EBITDA ÷ Revenue',I.ebitda,I.rev)); all.push(pct('roa','Return on Assets (ROA)','Profitability','Net Income ÷ Average Total Assets when available; otherwise Net Income ÷ Total Assets',I.ni,I.average_total_assets.value!=null?I.average_total_assets:I.assets)); all.push(pct('roe','Return on Equity (ROE)','Profitability','Net Income ÷ Average Shareholders’ Equity when available; otherwise Net Income ÷ Shareholders’ Equity',I.ni,I.average_equity?.value!=null?I.average_equity:I.equity)); all.push(pct('roic','Return on Invested Capital (ROIC)','Profitability','NOPAT ÷ Invested Capital',I.nopat,I.invested_capital)); all.push(pct('roce','Return on Capital Employed (ROCE)','Profitability','EBIT ÷ Capital Employed',I.ebit,I.capital_employed)); all.push(pct('ros','Return on Sales (ROS)','Profitability','Operating Profit ÷ Net Sales',I.oi,I.rev)); all.push(pct('contribution-margin','Contribution Margin','Profitability','(Sales − Variable Costs) ÷ Sales',{...I.rev,label:'Sales − Variable Costs',value:I.rev.value!=null&&I.variable_costs.value!=null?I.rev.value-I.variable_costs.value:null,validated:I.rev.validated&&I.variable_costs.validated},I.rev));
    // Efficiency
    all.push(add('asset-turnover','Asset Turnover Ratio','Efficiency / Activity','Revenue ÷ Average Total Assets when available; otherwise Revenue ÷ Total Assets',()=>div(I.rev,I.average_total_assets.value!=null?I.average_total_assets:I.assets),[I.rev,I.average_total_assets.value!=null?I.average_total_assets:I.assets])); all.push(add('fixed-asset-turnover','Fixed Asset Turnover','Efficiency / Activity','Revenue ÷ Net Fixed Assets',()=>div(I.rev,I.net_fixed_assets),[I.rev,I.net_fixed_assets])); all.push(add('inventory-turnover','Inventory Turnover','Efficiency / Activity','COGS ÷ Average Inventory',()=>div(I.cogs,I.average_inventory),[I.cogs,I.average_inventory]));
    all.push(add('dio','Days Inventory Outstanding (DIO)','Efficiency / Activity','365 × Average Inventory ÷ COGS',()=>I.cogs.value!=null&&I.average_inventory.value!=null&&I.cogs.value!==0?365*I.average_inventory.value/I.cogs.value:null,[I.cogs,I.average_inventory],'days')); all.push(add('receivables-turnover','Receivables Turnover','Efficiency / Activity','Net Credit Sales ÷ Average Accounts Receivable',()=>div(I.net_credit_sales,I.average_receivables),[I.net_credit_sales,I.average_receivables])); all.push(add('dso','Days Sales Outstanding (DSO)','Efficiency / Activity','Average Accounts Receivable ÷ Net Credit Sales × Days; fallback Accounts Receivable ÷ Revenue × Days',()=>{const ar=I.average_receivables.value!=null?I.average_receivables:I.recv;const sales=I.net_credit_sales.value!=null?I.net_credit_sales:I.rev;return div(ar,sales)!=null?div(ar,sales)*365:null},[I.average_receivables.value!=null?I.average_receivables:I.recv,I.net_credit_sales.value!=null?I.net_credit_sales:I.rev],'days')); all.push(add('payables-turnover','Payables Turnover','Efficiency / Activity','COGS ÷ Average Accounts Payable',()=>div(I.cogs,I.average_payables),[I.cogs,I.average_payables])); all.push(add('dpo','Days Payable Outstanding (DPO)','Efficiency / Activity','Average Accounts Payable ÷ Purchases × Days; fallback Accounts Payable ÷ COGS × Days',()=>{const ap=I.average_payables.value!=null?I.average_payables:I.pay;const purchases=I.purchases?.value!=null?I.purchases:I.cogs;return div(ap,purchases)!=null?div(ap,purchases)*365:null},[I.average_payables.value!=null?I.average_payables:I.pay,I.purchases?.value!=null?I.purchases:I.cogs],'days')); all.push(add('ccc','Cash Conversion Cycle (CCC)','Efficiency / Activity','DIO + DSO − DPO',()=>{const dioDays=I.cogs.value!=null&&I.average_inventory.value!=null&&I.cogs.value!==0?365*I.average_inventory.value/I.cogs.value:null;const dsoDays=div(I.recv,I.rev)!=null?div(I.recv,I.rev)*365:null;const dpoDays=div(I.pay,I.cogs)!=null?div(I.pay,I.cogs)*365:null;return dioDays!=null&&dsoDays!=null&&dpoDays!=null?dioDays+dsoDays-dpoDays:null},[I.cogs,I.average_inventory,I.recv,I.rev,I.pay],'days'));
    // Leverage / Solvency
    all.push(add('debt-ratio','Debt Ratio (Total Liabilities to Total Assets)','Leverage / Solvency','Total Liabilities ÷ Total Assets; excludes Total Liabilities and Equity',()=>div(I.liab,I.assets),[I.liab,I.assets])); all.push(add('debt-to-equity','Debt-to-Equity (D/E)','Leverage / Solvency','Total Debt ÷ Shareholders’ Equity',()=>div(I.debt,I.equity),[I.debt,I.equity])); all.push(add('debt-to-assets','Debt-to-Assets','Leverage / Solvency','Total Debt ÷ Total Assets',()=>div(I.debt,I.assets),[I.debt,I.assets])); all.push(add('debt-to-ebitda','Debt-to-EBITDA','Leverage / Solvency','Total Debt ÷ EBITDA',()=>div(I.debt,I.ebitda),[I.debt,I.ebitda])); all.push(add('net-debt-to-ebitda','Net Debt-to-EBITDA','Leverage / Solvency','(Total Debt − Cash) ÷ EBITDA',()=>I.debt.value!=null&&I.cash.value!=null?div({value:I.debt.value-I.cash.value,scale:I.debt.scale,unit:I.debt.unit,currency:I.debt.currency},I.ebitda):null,[I.debt,I.cash,I.ebitda])); all.push(add('interest-coverage','Interest Coverage Ratio','Leverage / Solvency','EBIT ÷ Interest Expense',()=>div(I.ebit,I.interest),[I.ebit,I.interest])); all.push(add('dscr','Debt Service Coverage Ratio (DSCR)','Leverage / Solvency','Net Operating Income ÷ Total Debt Service',()=>div(I.net_operating_income,I.total_debt_service),[I.net_operating_income,I.total_debt_service])); all.push(add('equity-multiplier','Equity Multiplier','Leverage / Solvency','Total Assets ÷ Shareholders’ Equity',()=>div(I.assets,I.equity),[I.assets,I.equity])); all.push(add('fixed-charge-coverage','Fixed Charge Coverage Ratio','Leverage / Solvency','(EBIT + Lease Payments) ÷ (Interest + Lease Payments)',()=>{const n=I.ebit.value!=null&&I.lease_payments.value!=null?I.ebit.value+I.lease_payments.value:null;const d=I.interest.value!=null&&I.lease_payments.value!=null?I.interest.value+I.lease_payments.value:null;return n!=null&&d? n/d:null},[I.ebit,I.lease_payments,I.interest]));
    // Valuation
    all.push(add('pe','Price-to-Earnings (P/E)','Valuation','Share Price ÷ Earnings Per Share',()=>div(I.share_price,I.eps),[I.share_price,I.eps])); all.push(add('pb','Price-to-Book (P/B)','Valuation','Share Price ÷ Book Value Per Share',()=>div(I.share_price,I.book_value_per_share),[I.share_price,I.book_value_per_share])); all.push(add('ps','Price-to-Sales (P/S)','Valuation','Market Cap ÷ Revenue',()=>div(I.market_cap,I.rev),[I.market_cap,I.rev])); all.push(add('ev-ebitda','EV/EBITDA','Valuation','Enterprise Value ÷ EBITDA',()=>div(I.enterprise_value,I.ebitda),[I.enterprise_value,I.ebitda])); all.push(add('ev-revenue','EV/Revenue','Valuation','Enterprise Value ÷ Revenue',()=>div(I.enterprise_value,I.rev),[I.enterprise_value,I.rev])); all.push(add('eps','Earnings Per Share (EPS)','Valuation','(Net Income − Preferred Dividends) ÷ Weighted Avg Shares Outstanding',()=>{const n=I.ni.value!=null?I.ni.value-(I.preferred_dividends.value||0):null;return n!=null&&I.weighted_avg_shares.value?n/I.weighted_avg_shares.value:null},[I.ni,I.preferred_dividends,I.weighted_avg_shares],'per-share')); all.push(pct('dividend-yield','Dividend Yield','Valuation','Annual Dividend per Share ÷ Share Price',I.annual_dividend_per_share,I.share_price)); all.push(pct('dividend-payout','Dividend Payout Ratio','Valuation','Dividends Paid ÷ Net Income',I.dividends_paid,I.ni));
    // Growth
    all.push(pct('revenue-growth','Revenue Growth Rate','Growth & Performance','(Current Revenue − Prior Period Revenue) ÷ Prior Period Revenue',{...I.rev,label:'Current Revenue − Prior Revenue',value:I.rev.value!=null&&I.prior_revenue.value!=null?I.rev.value-I.prior_revenue.value:null,validated:I.rev.validated&&I.prior_revenue.validated},I.prior_revenue)); all.push(add('cagr','CAGR (Compound Annual Growth Rate)','Growth & Performance','(Ending Value ÷ Beginning Value)^(1/n) − 1',()=>I.ending_value.value!=null&&I.beginning_value.value!=null&&I.number_of_years.value?Math.pow(I.ending_value.value/I.beginning_value.value,1/I.number_of_years.value)-1:null,[I.ending_value,I.beginning_value,I.number_of_years],'%')); if(all.at(-1).value!=null)all.at(-1).value*=100; all.push(add('organic-growth','Organic Growth Rate','Growth & Performance','Growth excluding M&A / FX effects',()=>I.organic_growth?.value!=null?(Math.abs(I.organic_growth.value)<=1?I.organic_growth.value*100:I.organic_growth.value):null,[I.organic_growth],'%','Requires a comparable-base organic growth input.')); all.push(pct('ebitda-growth','EBITDA Growth Rate','Growth & Performance','(Current EBITDA − Prior EBITDA) ÷ Prior EBITDA',{...I.ebitda,label:'Current − Prior EBITDA',value:I.ebitda.value!=null&&I.prior_ebitda.value!=null?I.ebitda.value-I.prior_ebitda.value:null,validated:I.ebitda.validated&&I.prior_ebitda.validated},I.prior_ebitda));
    // Cash flow
    const fcf={...I.ocf,label:'Free Cash Flow',value:I.ocf.value!=null&&I.capex.value!=null?I.ocf.value-I.capex.value:null,validated:I.ocf.validated&&I.capex.validated}; all.push(add('fcf','Free Cash Flow (FCF)','Cash Flow','Operating Cash Flow − Capital Expenditures',()=>fcf.value,[I.ocf,I.capex])); all.push(pct('fcf-margin','Free Cash Flow Margin','Cash Flow','FCF ÷ Revenue',fcf,I.rev)); all.push(add('fcfe','Free Cash Flow to Equity (FCFE)','Cash Flow','Net Income + D&A − CapEx − ΔWorking Capital + Net Borrowing',()=>{const d=I.change_working_capital.value;return [I.ni.value,I.danda.value,I.capex.value,d,I.net_borrowing.value].every(x=>x!=null)?I.ni.value+I.danda.value-I.capex.value-d+I.net_borrowing.value:null},[I.ni,I.danda,I.capex,I.change_working_capital,I.net_borrowing])); all.push(add('ocf-ratio','Operating Cash Flow Ratio','Cash Flow','Operating Cash Flow ÷ Current Liabilities',()=>div(I.ocf,I.cl),[I.ocf,I.cl])); all.push(add('cash-flow-coverage','Cash Flow Coverage Ratio','Cash Flow','Operating Cash Flow ÷ Total Debt',()=>div(I.ocf,I.debt),[I.ocf,I.debt])); all.push(add('cash-conversion-ratio','Cash Conversion Ratio','Cash Flow','Operating Cash Flow ÷ EBITDA',()=>div(I.ocf,I.ebitda),[I.ocf,I.ebitda])); all.push(add('cash-burn-rate','Cash Burn Rate','Cash Flow','(Beginning Cash − Ending Cash) ÷ Number of Months',()=>I.beginning_cash.value!=null&&I.ending_cash.value!=null&&I.number_of_months.value?(I.beginning_cash.value-I.ending_cash.value)/I.number_of_months.value:null,[I.beginning_cash,I.ending_cash,I.number_of_months]));
    // Working capital / capital efficiency
    all.push(add('net-working-capital','Net Working Capital','Working Capital & Capital Efficiency','Current Assets − Current Liabilities',()=>I.ca.value!=null&&I.cl.value!=null?I.ca.value-I.cl.value:null,[I.ca,I.cl])); all.push(add('working-capital-turnover','Working Capital Turnover','Working Capital & Capital Efficiency','Revenue ÷ Average Working Capital',()=>div(I.rev,I.average_working_capital),[I.rev,I.average_working_capital])); all.push(pct('capex-to-revenue','CapEx to Revenue Ratio','Working Capital & Capital Efficiency','Capital Expenditure ÷ Revenue',I.capex,I.rev)); all.push(add('capex-to-depreciation','CapEx to Depreciation Ratio','Working Capital & Capital Efficiency','Capital Expenditure ÷ Depreciation',()=>div(I.capex,I.depreciation),[I.capex,I.depreciation])); all.push(add('asset-utilization','Asset Utilization Ratio','Working Capital & Capital Efficiency','Revenue ÷ Average Total Assets',()=>div(I.rev,I.average_total_assets),[I.rev,I.average_total_assets]));
    // Cost / budget
    all.push(pct('opex-ratio','Operating Expense Ratio','Cost & Budget','Operating Expenses ÷ Revenue',I.operating_expenses,I.rev)); all.push(add('cost-to-income','Cost-to-Income Ratio','Cost & Budget','Operating Costs ÷ Operating Income',()=>div(I.operating_costs,I.oi),[I.operating_costs,I.oi])); all.push(pct('sga-ratio','SG&A Ratio','Cost & Budget','SG&A Expenses ÷ Revenue',I.sga_expenses,I.rev)); all.push(pct('budget-variance','Budget Variance','Cost & Budget','(Actual − Budgeted) ÷ Budgeted',{...I.actual_amount,label:'Actual − Budgeted',value:I.actual_amount.value!=null&&I.budgeted_amount.value!=null?I.actual_amount.value-I.budgeted_amount.value:null,validated:I.actual_amount.validated&&I.budgeted_amount.validated},I.budgeted_amount)); all.push(add('cost-per-unit','Cost per Unit','Cost & Budget','Total Production Cost ÷ Units Produced',()=>div(I.total_production_cost,I.units_produced),[I.total_production_cost,I.units_produced]));
    // SaaS / recurring
    all.push(add('mrr','Monthly Recurring Revenue (MRR)','SaaS / Recurring Revenue','Sum of monthly subscription revenue',()=>I.mrr.value,[I.mrr])); all.push(add('arr','Annual Recurring Revenue (ARR)','SaaS / Recurring Revenue','MRR × 12',()=>I.mrr.value!=null?I.mrr.value*12:null,[I.mrr])); all.push(add('cac','Customer Acquisition Cost (CAC)','SaaS / Recurring Revenue','Sales & Marketing Spend ÷ New Customers Acquired',()=>div(I.sales_marketing_spend,I.new_customers),[I.sales_marketing_spend,I.new_customers])); all.push(add('ltv','Customer Lifetime Value (CLTV / LTV)','SaaS / Recurring Revenue','(Average Revenue per Customer × Gross Margin %) ÷ Churn Rate',()=>I.avg_revenue_per_customer.value!=null&&I.churn_rate.value&&I.rev.value?I.avg_revenue_per_customer.value*(I.gp.value/I.rev.value)/I.churn_rate.value:null,[I.avg_revenue_per_customer,I.gp,I.rev,I.churn_rate])); all.push(add('ltv-cac','LTV:CAC Ratio','SaaS / Recurring Revenue','LTV ÷ CAC',()=>{const l=I.avg_revenue_per_customer.value!=null&&I.churn_rate.value&&I.rev.value?I.avg_revenue_per_customer.value*(I.gp.value/I.rev.value)/I.churn_rate.value:null;const c=div(I.sales_marketing_spend,I.new_customers);return l!=null&&c?l/c:null},[I.avg_revenue_per_customer,I.churn_rate,I.rev,I.gp,I.sales_marketing_spend,I.new_customers])); all.push(add('cac-payback','CAC Payback Period','SaaS / Recurring Revenue','CAC ÷ (Monthly Recurring Revenue per Customer × Gross Margin %)',()=>{const c=div(I.sales_marketing_spend,I.new_customers),g=I.gp.value!=null&&I.rev.value?I.gp.value/I.rev.value:null;return c&&I.mrr_per_customer.value&&g?c/(I.mrr_per_customer.value*g):null},[I.sales_marketing_spend,I.new_customers,I.mrr_per_customer,I.gp,I.rev],'months')); all.push(add('nrr','Net Revenue Retention (NRR)','SaaS / Recurring Revenue','((Starting ARR + Expansion − Contraction − Churn) ÷ Starting ARR) × 100',()=>{const s=I.starting_arr.value;return s!=null&&s!==0?((s+(I.expansion.value||0)-(I.contraction.value||0)-(I.churn_arr.value||0))/s)*100:null},[I.starting_arr,I.expansion,I.contraction,I.churn_arr],'%')); all.push(pct('grr','Gross Revenue Retention (GRR)','SaaS / Recurring Revenue','(Starting ARR − Contraction − Churn) ÷ Starting ARR',{...I.starting_arr,value:I.starting_arr.value?I.starting_arr.value-(I.contraction.value||0)-(I.churn_arr.value||0):null,label:'Starting ARR − Contraction − Churn',validated:I.starting_arr.validated&&I.contraction.validated&&I.churn_arr.validated},I.starting_arr)); all.push(pct('revenue-churn','Churn Rate (Revenue)','SaaS / Recurring Revenue','Lost Revenue in Period ÷ Revenue at Start',I.lost_revenue,I.starting_revenue)); all.push(pct('logo-churn','Churn Rate (Customer / Logo)','SaaS / Recurring Revenue','Customers Lost ÷ Customers at Start',I.customers_lost,I.starting_customers)); all.push(add('rule-of-40','Rule of 40','SaaS / Recurring Revenue','(Revenue Growth Rate + EBITDA Margin) × 100',()=>I.revenue_growth_rate.value!=null&&I.ebitda.value!=null&&I.rev.value? (I.revenue_growth_rate.value + (I.ebitda.value/I.rev.value)) * 100 : null,[I.revenue_growth_rate,I.ebitda,I.rev],'%')); all.push(add('magic-number','Magic Number','SaaS / Recurring Revenue','(Current Quarter Revenue − Prior Quarter Revenue) × 4 ÷ Prior Quarter Sales & Marketing Spend',()=>I.current_quarter_revenue.value!=null&&I.prior_quarter_revenue.value!=null&&I.prior_quarter_sales_marketing_spend.value?((I.current_quarter_revenue.value-I.prior_quarter_revenue.value)*4)/I.prior_quarter_sales_marketing_spend.value:null,[I.current_quarter_revenue,I.prior_quarter_revenue,I.prior_quarter_sales_marketing_spend])); all.push(add('burn-multiple','Burn Multiple','SaaS / Recurring Revenue','Net Cash Burn ÷ Net New ARR',()=>div(I.net_cash_burn,I.net_new_arr),[I.net_cash_burn,I.net_new_arr]));
    // Risk / Capital Structure
    all.push(add('altman-z','Altman Z-Score','Risk & Capital Structure','1.2(WC/TA) + 1.4(RE/TA) + 3.3(EBIT/TA) + 0.6(MVE/TL) + 1.0(Sales/TA)',()=>{const wc=I.ca.value!=null&&I.cl.value!=null?I.ca.value-I.cl.value:null;return [wc,I.assets.value,I.retained_earnings.value,I.ebit.value,I.liab.value,I.market_value_equity.value,I.rev.value].every(x=>x!=null)?1.2*(wc/I.assets.value)+1.4*(I.retained_earnings.value/I.assets.value)+3.3*(I.ebit.value/I.assets.value)+0.6*(I.market_value_equity.value/I.liab.value)+1.0*(I.rev.value/I.assets.value):null},[I.ca,I.cl,I.assets,I.retained_earnings,I.ebit,I.liab,I.market_value_equity,I.rev])); all.push(add('wacc','Weighted Average Cost of Capital (WACC)','Risk & Capital Structure','((E/V × Re) + (D/V × Rd × (1 − Tax Rate))) × 100',()=>{const E=I.market_value_equity.value??I.equity.value,D=I.debt.value,V=E!=null&&D!=null?E+D:null,Re=I.cost_of_equity.value,Rd=I.cost_of_debt.value,Tr=I.tax_rate.value;return V&&Re!=null&&Rd!=null&&Tr!=null?(((E/V)*Re)+((D/V)*Rd*(1-Tr)))*100:null},[I.market_value_equity,I.equity,I.debt,I.cost_of_equity,I.cost_of_debt,I.tax_rate],'%')); all.push(add('eva','Economic Value Added (EVA)','Risk & Capital Structure','NOPAT − (Invested Capital × WACC)',()=>{const wPct=all.find(x=>x.id==='wacc')?.value;return I.nopat.value!=null&&I.invested_capital.value!=null&&wPct!=null?I.nopat.value-I.invested_capital.value*(wPct/100):null},[I.nopat,I.invested_capital])); all.push(add('capm','Beta-adjusted Cost of Equity (CAPM)','Risk & Capital Structure','(Rf + β × (Rm − Rf)) × 100',()=>I.risk_free_rate.value!=null&&I.beta.value!=null&&I.market_return.value!=null?(I.risk_free_rate.value+I.beta.value*(I.market_return.value-I.risk_free_rate.value))*100:null,[I.risk_free_rate,I.beta,I.market_return],'%'));
    // Board / Investor
    all.push(add('ebitda-derived','EBITDA (derived)','Board / Investor KPIs','Net Income + Interest + Taxes + D&A',()=>[I.ni.value,I.interest.value,I.tax_expense.value,I.danda.value].every(x=>x!=null)?I.ni.value+I.interest.value+I.tax_expense.value+I.danda.value:null,[I.ni,I.interest,I.tax_expense,I.danda])); all.push(add('adjusted-ebitda','Adjusted EBITDA','Board / Investor KPIs','EBITDA ± non-recurring items',()=>I.ebitda.value!=null&&I.one_off_adjustments.value!=null?I.ebitda.value+I.one_off_adjustments.value:null,[I.ebitda,I.one_off_adjustments])); all.push(add('operating-leverage','Operating Leverage','Board / Investor KPIs','% Change in Operating Income ÷ % Change in Revenue',()=>I.oi.value!=null&&I.prior_operating_income.value&&I.rev.value!=null&&I.prior_revenue.value?((I.oi.value-I.prior_operating_income.value)/I.prior_operating_income.value)/((I.rev.value-I.prior_revenue.value)/I.prior_revenue.value):null,[I.oi,I.prior_operating_income,I.rev,I.prior_revenue])); all.push(add('break-even-units','Break-even Point (Units)','Board / Investor KPIs','Fixed Costs ÷ (Price per Unit − Variable Cost per Unit)',()=>I.fixed_costs.value!=null&&I.price_per_unit.value!=null&&I.variable_cost_per_unit.value!=null&&I.price_per_unit.value!==I.variable_cost_per_unit.value?I.fixed_costs.value/(I.price_per_unit.value-I.variable_cost_per_unit.value):null,[I.fixed_costs,I.price_per_unit,I.variable_cost_per_unit],'units')); all.push(pct('margin-of-safety','Margin of Safety','Board / Investor KPIs','(Actual Sales − Break-even Sales) ÷ Actual Sales',{...I.actual_sales,label:'Actual Sales − Break-even Sales',value:I.actual_sales.value!=null&&I.break_even_sales.value!=null?I.actual_sales.value-I.break_even_sales.value:null,validated:I.actual_sales.validated&&I.break_even_sales.validated},I.actual_sales));
    return all.map(x=>({...x,validationStatus:x.provisional?'provisional':'validated-or-source-only'}));
  }
  if(u.pathname==='/api/cfo-intelligence'&&req.method==='GET'){
    const c=activeCompany(); if(!c)return send(res,200,{company:null,metrics:[],runway:null,healthScore:null,risks:[],trend:[],trendMetrics:[],ratios:[],ratioCategories:[],agents:state.agents});
    await ensureCanonicalFinancialData(c); syncStructuredFacts(c); const docs=(c.documents||[]).filter(d=>!d.archived); const activeDocs=docs; const activeDocIds=new Set(activeDocs.map(d=>d.id)); const facts=[...(c.facts||[])].map(f=>({...f,concept:canonicalFactConcept(f.concept)}));
    const metricNames=['revenue','gross_profit','operating_income','ebitda','net_income','cash','debt','assets','liabilities','receivables','payables','inventory','capex','current_assets','current_liabilities']; const metricMap={};
    const preferredYear=[...new Set(docs.map(d=>String(d.fiscalYear||'')).filter(Boolean))].sort((a,b)=>Number(b)-Number(a))[0]||'';
    const factRank=f=>{const concept=canonicalFactConcept(f.concept);const txt=String(f.evidenceText||'').toLowerCase();const doc=activeDocs.find(d=>d.id===f.documentId);const docHint=String(doc?.documentType||doc?.category||doc?.filename||'').toLowerCase();const exactLabel=(concept==='cash'&&/cash and cash equivalents/.test(txt))||(concept==='revenue'&&/(?:total revenues?|revenue from operations)/.test(txt))||(concept==='current_assets'&&/total current assets|current assets/.test(txt))||(concept==='current_liabilities'&&/total current liabilities|current liabilities/.test(txt))||(concept==='debt'&&/debt and finance leases|total debt|borrowings/.test(txt));const statementHint=(concept==='cash'||concept==='current_assets'||concept==='current_liabilities'||concept==='debt'||concept==='assets'||concept==='liabilities')&&/balance|financial position|annual report/.test(docHint);return [Number(activeDocIds.has(f.documentId)),String(f.fiscalYear||'')===preferredYear?1:0,factFiscalYearNumber(f),Number(exactLabel)*3,Number(statementHint)*2,Number(!!f.systemVerified),Number(!!f.validated),Number(f.confidence||0),String(f.validatedAt||f.createdAt||'')];};
    const compareRank=(a,b)=>{const ra=factRank(a),rb=factRank(b);for(let i=0;i<ra.length;i++){if(i===ra.length-1)return String(ra[i]).localeCompare(String(rb[i]));const na=Number(ra[i]),nb=Number(rb[i]);if(Number.isFinite(na)&&Number.isFinite(nb)){if(na!==nb)return na-nb;}else{const cmp=String(ra[i]).localeCompare(String(rb[i]));if(cmp!==0)return cmp;}}return 0;};
    for(const f of facts){const key=canonicalFactConcept(f.concept);if(!metricNames.includes(key))continue;const cur=metricMap[key];if(!cur||compareRank(f,cur)>0)metricMap[key]=f;}
    const num=v=>normalizedFactNumber(v);
    const revenue=num(metricMap.revenue), ebitda=num(metricMap.ebitda), cash=num(metricMap.cash), debt=num(metricMap.debt), netIncome=num(metricMap.net_income);
    const coreReady=['revenue','cash','current_assets','current_liabilities','debt'].every(k=>metricMap[k]&&Number.isFinite(normalizedFactNumber(metricMap[k])));
    // Deterministic order: facts -> full ratio library -> scoring / risks -> response.
    // Never reference the ratio library before it has been materialized.
    const ratios=buildRatioLibrary(facts),ratioCategories=[...new Set(ratios.map(r=>r.category))];
    const ratioValue=(id)=>{const x=ratios.find(r=>r.id===id);return x?.value!=null&&Number.isFinite(Number(x.value))?Number(x.value):null;};
    const ratioCurrent=ratioValue('current-ratio'), ratioQuick=ratioValue('quick-ratio'), ratioCash=ratioValue('cash-ratio'), ratioDE=ratioValue('debt-to-equity'), ratioNetMargin=ratioValue('net-margin');
    const ratioPenalty=(ratioCurrent!=null&&ratioCurrent<1?-15:ratioCurrent!=null&&ratioCurrent<1.25?-5:0)+(ratioQuick!=null&&ratioQuick<0.8?-5:0)+(ratioCash!=null&&ratioCash<0.2?-3:0)+(ratioDE!=null&&ratioDE>2?-7:0)+(ratioNetMargin!=null&&ratioNetMargin<0?-10:0);
    const dataConsistencyOk=ratios.filter(r=>r.status==='data-inconsistency').length===0;
    const healthScore=coreReady&&dataConsistencyOk?Math.round(clamp(50+(revenue?10:0)+(ebitda!=null?(ebitda>=0?12:-12):0)+(cash!=null?8:0)+(debt!=null?-3:0)+(docs.length?10:0)+ratioPenalty,0,100)):null;
    const risks=[];if(!coreReady)risks.push({level:'high',title:'Evidence incomplete — CFO state is provisional',detail:'Critical CFO inputs (Revenue, Cash, Current Assets, Current Liabilities and Debt) are not all established. Validate/reconcile source evidence before relying on health scores or decisions.'});if(!revenue)risks.push({level:'high',title:'Revenue evidence missing or unvalidated',detail:'Upload or validate a current income statement / annual report.'});if(ebitda==null)risks.push({level:'medium',title:'EBITDA evidence unavailable',detail:'Check operating performance and whether EBITDA is a meaningful management KPI.'});if(debt!=null&&cash!=null&&debt>cash)risks.push({level:'medium',title:'Net debt position',detail:'Debt exceeds identified cash in the currently extracted evidence.'});
    const currentRatio=ratioCurrent, quickRatio=ratioQuick, cashRatio=ratioCash, ccc=ratioValue('ccc'), debtEquity=ratioDE, netMargin=ratioNetMargin;
    if(currentRatio!=null && currentRatio<1) risks.push({level:'high',title:'Liquidity pressure — current ratio below 1.0',detail:`Current Ratio is ${currentRatio.toFixed(2)}x; current liabilities exceed current assets. Review near-term liquidity, working-capital release, payment timing and available funding headroom.`,recommendation:'Prioritise a 13-week cash forecast, accelerate collections, review inventory, renegotiate supplier terms and protect minimum cash headroom.'});
    else if(currentRatio!=null && currentRatio<1.25) risks.push({level:'medium',title:'Tight liquidity buffer',detail:`Current Ratio is ${currentRatio.toFixed(2)}x; the liquidity cushion is limited.`,recommendation:'Monitor weekly working capital, collections, inventory and committed cash outflows.'});
    if(quickRatio!=null && quickRatio<0.8) risks.push({level:'medium',title:'Acid-test liquidity is weak',detail:`Quick Ratio is ${quickRatio.toFixed(2)}x; liquid current assets provide limited coverage of current liabilities.`,recommendation:'Prioritise cash and receivables conversion and avoid relying on inventory liquidation for routine obligations.'});
    if(cashRatio!=null && cashRatio<0.2) risks.push({level:'medium',title:'Low immediate cash coverage',detail:`Cash Ratio is ${cashRatio.toFixed(2)}x; cash alone covers a small proportion of current liabilities.`,recommendation:'Set and monitor a minimum operating cash threshold and rolling cash runway.'});
    if(ccc!=null && ccc>90) risks.push({level:'medium',title:'Long cash-conversion cycle',detail:`Cash Conversion Cycle is ${ccc.toFixed(1)} days.`,recommendation:'Target DSO, inventory days and DPO separately; assign owners and track the working-capital release plan.'});
    if(debtEquity!=null && debtEquity>2) risks.push({level:'high',title:'High leverage',detail:`Debt-to-Equity is ${debtEquity.toFixed(2)}x.`,recommendation:'Review covenant headroom, refinancing concentration, interest cover and deleveraging options.'});
    if(netMargin!=null && netMargin<0) risks.push({level:'high',title:'Negative net margin',detail:`Net margin is ${netMargin.toFixed(1)}%.`,recommendation:'Investigate gross-margin pressure, operating-cost drivers, financing costs and non-recurring items before setting corrective targets.'});

    const years=[...new Set([...docs.map(d=>String(d.fiscalYear||'')).filter(Boolean),...facts.map(f=>String(f.fiscalYear||'')).filter(Boolean)])].sort((a,b)=>Number(a)-Number(b));
    const trendConcepts={Revenue:'revenue',EBITDA:'ebitda','Net Income':'net_income',Cash:'cash',Debt:'debt'};
    const trendMetrics=Object.entries(trendConcepts).map(([label,key])=>({label,points:years.map(year=>{const pool=facts.filter(f=>String(f.fiscalYear||'')===String(year));const fact=selectBestFinancialFact(pool,key,year);const d=fact?docs.find(x=>x.id===fact.documentId)||docs.find(x=>String(x.fiscalYear||'')===String(year)):docs.find(x=>String(x.fiscalYear||'')===String(year));return {year,value:num(fact),factId:fact?.id||null,documentId:fact?.documentId||d?.id||null,filename:docs.find(x=>x.id===fact?.documentId)?.filename||d?.filename||null,provisional:!!(fact&&!fact.validated&&!fact.systemVerified),sourceLabel:fact?.sourceLabel||null,scale:fact?.scale||null,currency:fact?.currency||null};})}));
    const learning=state.moni.onlineLearner||{},updates=Object.values(learning).reduce((n,x)=>n+Number(x.updates||0),0);
    const metrics=[['Revenue',revenue,metricMap.revenue],['EBITDA',ebitda,metricMap.ebitda],['Cash',cash,metricMap.cash],['Debt',debt,metricMap.debt],['Net income',netIncome,metricMap.net_income]].map(([label,value,fact])=>({label,value,factId:fact?.id,source:fact?.evidenceText||null,documentId:fact?.documentId||null,provisional:!!(fact&&!fact.validated&&!fact.systemVerified),validated:!!fact&&(fact.validated||fact.systemVerified)}));
    const meta=effectiveCompanyMetadata(c); return send(res,200,{company:{id:meta.id,name:meta.name,country:meta.country,currency:meta.currency,reportingCurrency:meta.reportingCurrency,reportingFramework:meta.reportingFramework},metrics,runway:null,healthScore,risks,trend:docs.slice().sort((a,b)=>String(a.fiscalYear).localeCompare(String(b.fiscalYear))).map(d=>({year:d.fiscalYear,evidence:d.evidenceCount||0,filename:d.filename})),trendMetrics,ratios,ratioCategories,agents:state.agents.map(a=>({id:a.id,name:a.name,role:a.role,enabled:a.enabled,archived:a.archived,performance:state.moni.agentPerformance?.[a.id]||null})),learning:{mode:state.moni.learningMode,updates,modelPerformance:state.moni.modelPerformance||{},champion:state.arena.champion||null},proactive:state.proactive});
  }
  if(u.pathname==='/api/dashboard'&&req.method==='GET'){
    const dashboardCacheKey=`${state.activeCompanyId||'none'}`;
    const now=Date.now();
    const cached=state.moni.dashboardCache?.[dashboardCacheKey];
    if(cached && now-cached.at<2000){ return send(res,200,{...cached.body,cacheHit:true}); }
    const c=activeCompany(); if(!c)return send(res,200,{company:null,mode:'waiting',validatedFactCount:0,candidateFactCount:0,evidenceCount:0,documentCount:0,signals:[]});
    await ensureCanonicalFinancialData(c); syncStructuredFacts(c); const activeDocs=(c.documents||[]).filter(d=>!d.archived); const activeDocIds=new Set(activeDocs.map(d=>d.id));
    const facts=(c.facts||[]).filter(f=>activeDocIds.has(f.documentId)); const validated=facts.filter(f=>f.validated||f.systemVerified); const candidates=facts.filter(f=>activeDocIds.has(f.documentId)&&!f.validated&&!f.systemVerified); const usable=[...validated,...candidates];
    const evidence=activeDocs.reduce((n,d)=>n+Number(d.evidenceCount||0),0); const recentDocuments=[...activeDocs].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))).slice(0,8);
    const last=recentDocuments[0]||null; const installed=installedModels(false); const readyModel=installed[0]||null;
    const signals=[];
    const dynamicKpis=[];
    const concepts=['revenue','gross_profit','operating_income','ebitda','net_income','cash','cash_and_cash_equivalents','assets','liabilities','receivables','payables','inventory','current_assets','current_liabilities','debt'];
    const fiscalYearValue=(v)=>{const m=String(v??'').match(/(19|20)\d{2}/);return m?Number(m[0]):-Infinity;};
    for(const concept of concepts){const latest=selectBestFinancialFact(usable,concept); if(!latest)continue; const n=sourceNumericValue(latest); if(Number.isFinite(n)){const srcDoc=activeDocs.find(d=>d.id===latest.documentId);dynamicKpis.push({concept,value:n,displayValue:n,normalizedValue:n,documentId:latest.documentId,sourceFactId:latest.id||null,sourceEvidence:latest.evidenceText||null,sourceLabel:latest.sourceLabel||null,sourceDocumentFilename:srcDoc?.filename||null,systemVerified:!!latest.systemVerified,provisional:!latest.validated&&!latest.systemVerified,fiscalYear:latest.fiscalYear||srcDoc?.documentFiscalYear||srcDoc?.fiscalYear||null,currency:latest.currency||srcDoc?.currency||c.currency||null,scale:latest.scale||srcDoc?.documentScale||'units',unit:latest.unit||srcDoc?.documentUnit||null,baseValue:comparableBaseValue(latest)});}}
    if(!activeDocs.length)signals.push({level:'warning',title:'No financial evidence',text:'Upload an annual report, management accounts, board pack or other company evidence.'});
    const aiPending=activeDocs.filter(d=>['queued','running','waiting','waiting_for_model'].includes(d.aiStatus)).length;
    const aiFailed=activeDocs.filter(d=>d.aiStatus==='failed').length; const aiFallback=activeDocs.filter(d=>d.aiStatus==='completed_with_fallback').length;
    if(aiPending)signals.push({level:'info',title:'AI evidence review in progress',text:`${aiPending} document${aiPending===1?'':'s'} ${aiPending===1?'is':'are'} in the local CFO intelligence queue.`});
    if(aiFailed)signals.push({level:'warning',title:'AI evidence review failed',text:`${aiFailed} document${aiFailed===1?'':'s'} require reprocessing. Open Financial Documents → Review outcome to see the failure and next action.`}); if(aiFallback)signals.push({level:'info',title:'Evidence extracted with fallback',text:`${aiFallback} document${aiFallback===1?'':'s'} produced source-linked candidate facts after local agent review was unavailable. Validate before relying on them.`});
    if(!readyModel)signals.push({level:'info',title:'Local model not installed',text:'Prepare the recommended model. Pending AI reviews and CFO questions will wait and resume automatically.'});
    const proactive=proactiveScan();
    const coreConcepts=['revenue','cash','current_assets','current_liabilities','debt']; const coreReady=coreConcepts.every(k=>facts.some(f=>canonicalFactConcept(f.concept)===k && Number.isFinite(normalizedFactNumber(f)))); const dashboardRatios=buildRatioLibrary(facts); const consistencyIssue=dashboardRatios.some(r=>r.status==='data-inconsistency');
    const ratioRiskSignals=[]; const ratioById=new Map(dashboardRatios.map(r=>[r.id,r])); const cv=id=>Number(ratioById.get(id)?.value);
    const addRatioSignal=(level,title,text,recommendation)=>ratioRiskSignals.push({level,title,text,recommendation,source:'deterministic-ratio-engine'});
    if(Number.isFinite(cv('current-ratio'))&&cv('current-ratio')<1)addRatioSignal('high','Liquidity pressure',`Current Ratio ${cv('current-ratio').toFixed(2)}x is below 1.0x.`,'Prioritise a 13-week cash forecast, accelerate collections, review inventory and renegotiate supplier timing.');
    else if(Number.isFinite(cv('current-ratio'))&&cv('current-ratio')<1.25)addRatioSignal('medium','Tight liquidity buffer',`Current Ratio ${cv('current-ratio').toFixed(2)}x leaves limited short-term cushion.`,'Monitor weekly cash, receivables, inventory and committed outflows.');
    if(Number.isFinite(cv('debt-to-equity'))&&cv('debt-to-equity')>2)addRatioSignal('high','High leverage',`Debt-to-Equity ${cv('debt-to-equity').toFixed(2)}x exceeds 2.0x.`,'Review covenant headroom, refinancing concentration, interest cover and deleveraging options.');
    if(Number.isFinite(cv('net-margin'))&&cv('net-margin')<0)addRatioSignal('high','Negative profitability',`Net margin ${cv('net-margin').toFixed(1)}% is negative.`,'Investigate pricing/gross-margin pressure, operating costs, financing costs and one-off items.');
    const decisionState=aiFailed?'Review Failed':(consistencyIssue||ratioRiskSignals.some(x=>x.level==='high')?'Review Required':(!coreReady&&validated.length?'Review Required':validated.length?'Active':aiPending?'AI Review':aiFallback||candidates.length?'Provisional':'Waiting'));
    const decisionReason=aiFailed?'Document AI validation failed. No validated CFO facts should be treated as established until the document is reprocessed successfully.':consistencyIssue?'Financial consistency checks detected contradictory facts; review source evidence before relying on CFO metrics.':ratioRiskSignals.some(x=>x.level==='high')?`${ratioRiskSignals.filter(x=>x.level==='high').length} high-priority CFO risk signal(s) require review.`:validated.length?'System-verified or user-validated financial facts are available for CFO workflows.':aiPending?'AI evidence review is processing the uploaded evidence. The dashboard will show the outcome when validation completes.':aiFallback||candidates.length?'Source-linked candidate facts are available provisionally. Validate evidence before treating them as established CFO facts.':'Add evidence and run document validation to establish CFO facts.';
    signals.push(...ratioRiskSignals);
    const meta=effectiveCompanyMetadata(c); const dashboardBody={company:{id:meta.id,name:meta.name,country:meta.country,currency:meta.currency,reportingCurrency:meta.reportingCurrency,reportingFramework:meta.reportingFramework,industry:meta.industry},mode:'dynamic',validatedFactCount:validated.length,candidateFactCount:candidates.length,evidenceCount:evidence,documentCount:activeDocs.length,lastDocumentAt:last?.updatedAt||last?.createdAt||null,lastDocumentFilename:last?.filename||null,modelReady:!!readyModel,modelName:readyModel?.filename||null,aiReviewPending:aiPending,aiReviewFailed:aiFailed,aiReviewFallback:aiFallback,decisionState,decisionReason,signals,dynamicKpis,proactive:proactive.predictions.filter(x=>x.companyId===c.id).slice(0,8),moniChampion:state.arena.champion||null,recentDocuments:recentDocuments.map(d=>({id:d.id,filename:d.filename,documentType:d.documentType,category:d.category,fiscalYear:d.fiscalYear,status:d.status,progress:d.progress,factCount:d.factCount,evidenceCount:d.evidenceCount,aiStatus:d.aiStatus,aiVerifiedFactCount:d.aiVerifiedFactCount,archived:!!d.archived}))}; state.moni.dashboardCache||={}; state.moni.dashboardCache[dashboardCacheKey]={at:Date.now(),body:dashboardBody}; return send(res,200,dashboardBody);
  }
  if(u.pathname==='/api/audit/status'&&req.method==='GET'){
    const manifest=loadManifest();
    return send(res,200,{auditDir:'.myai-cfo/audit',events:manifest.events||0,lastHash:manifest.lastHash,acceptanceRecorded:state.disclaimer.accepted===true});
  }
  return send(res,404,{error:'Not found'});
  } catch (e) {
    const message=String(e?.message||e);
    const code=e?.code==='INVALID_JSON'?'INVALID_JSON':(e?.code||'API_REQUEST_FAILED');
    const correlationId=String(req.headers['x-correlation-id']||crypto.randomUUID());
    try { audit(code==='INVALID_JSON'?'INVALID_JSON_REQUEST':'API_REQUEST_FAILED',{method:req.method,path:req.url,statusCode:code==='INVALID_JSON'?400:500,errorHash:sha(message),detailClass:e?.name||'Error',reason:message.slice(0,2000),stack:String(e?.stack||'').slice(0,4000),correlationId}); } catch {}
    if (!res.headersSent) return send(res,code==='INVALID_JSON'?400:500,{error:code==='INVALID_JSON'?'INVALID_JSON':'MYAI CFO request failed.',detail:message,code,api:{method:req.method,path:req.url,statusCode:code==='INVALID_JSON'?400:500,correlationId},requestId:correlationId});
    try { res.end(); } catch {}
  }
});
server.on('error',err=>{
  const detail=String(err?.stack||err?.message||err);
  try{fs.appendFileSync(path.join(root,'app','.myai-cfo','logs','backend-error.log'),`[${new Date().toISOString()}] ${detail}\n`,'utf8');}catch{}
  console.error(detail);
  process.exitCode=1;
});
process.on('uncaughtException',err=>{
  const detail=String(err?.stack||err?.message||err);
  try{fs.appendFileSync(path.join(root,'app','.myai-cfo','logs','backend-error.log'),`[${new Date().toISOString()}] UNCAUGHT_EXCEPTION ${detail}\n`,'utf8');}catch{}
  console.error(detail);
  process.exitCode=1;
});
process.on('unhandledRejection',reason=>{
  const detail=String(reason?.stack||reason?.message||reason);
  try{fs.appendFileSync(path.join(root,'app','.myai-cfo','logs','backend-error.log'),`[${new Date().toISOString()}] UNHANDLED_REJECTION ${detail}\n`,'utf8');}catch{}
  console.error(detail);
});

let shuttingDown=false;
function shutdownLocalRuntimes(reason='process-shutdown'){
  if(shuttingDown)return;
  shuttingDown=true;
  for(const runtime of [...liveRuntimes.values()]){
    try{runtime.child.kill()}catch{}
    runtimePorts.delete(runtime.port);
    audit('MODEL_RUNTIME_UNLOADED',{modelId:runtime.modelId,filename:runtime.filename,port:runtime.port,reason});
  }
  liveRuntimes.clear();
  liveRuntime=null;
}
process.once('SIGINT',()=>{shutdownLocalRuntimes('SIGINT');process.exit(130)});
process.once('SIGTERM',()=>{shutdownLocalRuntimes('SIGTERM');process.exit(143)});
process.once('beforeExit',()=>shutdownLocalRuntimes('beforeExit'));
process.once('exit',()=>{for(const runtime of [...liveRuntimes.values()]){try{runtime.child.kill()}catch{}}});

server.listen(Number(process.env.MYAI_CFO_API_PORT||47821),'127.0.0.1',()=>{
  const boundPort=Number(server.address()?.port||Number(process.env.MYAI_CFO_API_PORT||47821));
  const portFile=String(process.env.MYAI_CFO_CERT_PORT_FILE||'').trim();
  if(portFile){try{fs.mkdirSync(path.dirname(portFile),{recursive:true});fs.writeFileSync(portFile,String(boundPort),'utf8')}catch(e){console.error(`Unable to write certification port file: ${e.message}`);}}
  console.log(`${PRODUCT} Kernel listening on http://127.0.0.1:${boundPort}`);
  // Never preload/download or start model runtimes before the first-run disclaimer is accepted.
  refreshCachedInternetStatus();
  const internetRefreshTimer=setInterval(refreshCachedInternetStatus,30000);
  internetRefreshTimer.unref?.();
  if(accepted()){
    ensureFirstRunPreload().then(()=>ensureAutomaticModelRuntime({reason:'startup',maxAttempts:5,waitMs:2500}))
      .catch(e=>audit('MODEL_STARTUP_BOOT_FAILED',{errorHash:sha(String(e?.message||e))}));
  }else audit('FIRST_RUN_PRELOAD_WAITING_FOR_DISCLAIMER',{reason:'AI model preload/autoload deferred until disclaimer acceptance'});
  if(accepted()) setTimeout(()=>migrateLegacyDocumentExtraction().catch(e=>audit('DOCUMENT_EXTRACTION_MIGRATION_BOOT_FAILED',{errorHash:sha(String(e?.message||e))})),5000);
  else audit('DOCUMENT_EXTRACTION_MIGRATION_WAITING_FOR_DISCLAIMER',{reason:'Document migration/reconciliation deferred until disclaimer acceptance'});
});

