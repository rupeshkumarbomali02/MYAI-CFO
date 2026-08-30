import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const failures=[]; const checks=[];
const add=(id,ok,detail)=>{checks.push({id,status:ok?'PASS':'FAIL',ok:Boolean(ok),detail});if(!ok)failures.push({id,detail});};
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const version=read('VERSION.txt').trim();

const staleReleaseRefs=[];
const skipDirs=new Set(['node_modules','.git','dist','qa/results','app/data/diagnostics']);
const skipFiles=new Set(['qa/REGRESSION-DEFECT-FAMILIES.json','qa/tests/source-workflow-sanity.mjs','SOURCE-WORKFLOW-AUDIT-1.24.0.md','SOURCE-WORKFLOW-AUDIT-1.24.1.md']);
function scanCurrentReleaseTree(dir){
  let ents=[]; try{ents=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const ent of ents){
    const full=path.join(dir,ent.name); const rel=path.relative(root,full).replaceAll('\\','/');
    if(ent.isDirectory()){
      if(skipDirs.has(rel)||[...skipDirs].some(d=>rel.startsWith(d+'/'))) continue;
      scanCurrentReleaseTree(full);
    }else if(/\.(?:md|json|jsonl|txt|mjs|ps1|bat|cmd|yml|yaml|html|js|jsx|ts|tsx)$/i.test(ent.name) && !skipFiles.has(rel)){
      let s=''; try{s=fs.readFileSync(full,'utf8');}catch{continue;}
      const matches=[...s.matchAll(/\b(?:1\.24\.0|1\.23\.0|1\.5\.10(?:-[A-Z0-9-]+)?|PRODUCTION-FIX(?:[0-9]+))\b/g)];
      for(const m of matches){ staleReleaseRefs.push({file:rel,token:m[0]}); if(staleReleaseRefs.length>=100) return; }
    }
  }
}
scanCurrentReleaseTree(root);
add('NO-STALE-RELEASE-REFERENCES', staleReleaseRefs.length===0, staleReleaseRefs.length?`Stale/current-line release references detected: ${JSON.stringify(staleReleaseRefs.slice(0,25))}`:`No stale 1.24.0/1.23.0/FIX release references found in current package metadata/source.`);
add('VERSION-CONSISTENT', /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) && ['app/backend/package.json','app/frontend/package.json'].every(rel=>JSON.parse(read(rel)).version===version), `VERSION=${version}`);
const policy=JSON.parse(read('qa/certification-policy.json')); add('POLICY-VERSION-CONSISTENT', policy.releaseVersion===version, `policy.releaseVersion=${policy.releaseVersion}; VERSION=${version}`);
const countries=JSON.parse(read('app/data/reference/countries.json')); const currencies=JSON.parse(read('app/data/reference/currencies.json')); const publicCountries=JSON.parse(read('app/frontend/public/reference/countries.json')); const publicCurrencies=JSON.parse(read('app/frontend/public/reference/currencies.json'));
add('REFERENCE-DATA-PACKAGED', Array.isArray(countries)&&countries.length>200&&Array.isArray(currencies)&&currencies.length>100&&Array.isArray(publicCountries)&&publicCountries.length===countries.length&&Array.isArray(publicCurrencies)&&publicCurrencies.length===currencies.length, `countries=${countries.length}; currencies=${currencies.length}; publicCountries=${publicCountries.length}; publicCurrencies=${publicCurrencies.length}.`);
add('REGRESSION-MAP-COMPLETE', (()=>{try{const r=JSON.parse(read('qa/REGRESSION-DEFECT-FAMILIES.json')); const ids=(r.defectFamilies||[]).map(x=>x.id); return ['REG-001','REG-002','REG-003','REG-004','REG-005','REG-006','REG-007','REG-008','REG-009','REG-010','REG-011','REG-012','REG-013'].every(id=>ids.includes(id));}catch{return false}})(), 'Permanent regression map covers version, references, harness, evidence sync, financial facts, RAG, agents, recovery, models, isolation, contamination and reproducibility.');
add('NO-PATCH-METADATA', !fs.existsSync(path.join(root,'HOTFIX_VERSION.txt')) && !fs.existsSync(path.join(root,'RELEASE_PATCH.txt')), 'No patch metadata files present.');
const server=read('app/backend/server.mjs');
add('REFERENCE-DATA-ENDPOINTS', /readReferenceArray\(/.test(server)&&/frontendReferenceDir/.test(server), 'Backend reference loading supports bundled data and frontend-public fallback.');
add('ABORT-SIGNAL-CONTRACT', /function withOptionalAbortSignal\(/.test(server) && /withOptionalAbortSignal\(\{timeout:EXTRACTION_MAX_MS/.test(server) && !/execFileAsync\([^\n]+\{[^\n]*,signal\}\)/.test(server), 'PDF/document child-process extraction omits null signals and passes only real AbortSignal instances.');
add('FINANCIAL-SPINE-COVERS-ALL-DOCS', server.includes('for(const doc of (company.documents||[]).filter(d=>!d.archived))') && !server.includes('.filter(d=>!d.archived).slice(0,8)'), 'Financial spine refresh iterates every active document; no first-eight truncation remains.');
add('RESTART-MERGES-ASSET-FACTS', /const assetFacts=Array\.isArray\(enriched\.assets\?\.structuredFacts\)/.test(server) && /mergeStructuredExtractionFacts\(primaryFacts,assetFacts/.test(server), 'Document restart/reprocess merges enriched comparative structured facts before committing the financial spine.');
add('COMPARATIVE-SPINE-REGRESSION', fs.existsSync(path.join(root,'qa','tests','comparative-period-extraction-regression.mjs')) && fs.existsSync(path.join(root,'qa','tests','financial-spine-safety.mjs')), 'Comparative-period and financial-spine regression suites are packaged.');
add('REPROCESS-SIGNAL-PATH', /const\s+controller\s*=\s*new\s+AbortController\(\)/.test(server) && /activeDocumentExtractionControllers\.set\(docId,controller\)/.test(server) && /extractDocument\(d\.filename,raw,correlationId,controller\.signal\)/.test(server), 'Document reprocess/restart path uses a real cancellable controller and passes only its AbortSignal.');
add('SMOKE-FUNC-DEFINED', /const smokeModelFilenames=new Set\(\['Qwen2\.5-1\.5B-Instruct-Q4_K_M\.gguf'\]\);/.test(server) && /const smokeModelInstalled=installed\.some/.test(server), 'Smoke model detection is declared before diagnostic use.');
add('SMOKE-PRELOAD-CONTRACT', /qwen25-1\.5b-q4/.test(server) && /Qwen2\.5-1\.5B-Instruct-Q4_K_M\.gguf/.test(server), '1B–1.5B smoke model preload contract is present.');
add('NO-BETA-UNDEFINED-MODEL', !/PRELOAD_POLICY\.modelId/.test(server), 'No stale PRELOAD_POLICY.modelId reference remains.');
const core=read('qa/Run-ProductionCertification-Core.ps1');
add('CERT-STAGE-004A', /CERT-004A/.test(core), 'Certification backend lifecycle stage present.');
add('CERT-STAGE-008B', /CERT-008B/.test(core), 'Audit forensics stage present.');
add('CERT-API-REBOUND', /\$ApiBase=\$script:certApiBase/.test(core), 'Certification event API is rebound to the actual isolated backend.');
add('RELEASE-GATE-SANDBOX', /release-gate\.mjs.*\$BuildRoot/.test(core) || /Join-Path \$BuildRoot 'qa\\release-gate\.mjs'.*\$BuildRoot/.test(core), 'Final gate consumes the same isolated certification evidence tree.');
add('PREVIEW-EPHEMERAL', /\$previewPort=Get-FreeLoopbackPort/.test(core), 'Browser preview uses an ephemeral loopback port.');
const fxManifest=JSON.parse(read('qa/fixtures/synthetic-financial-statements-manifest.json'));
add('FIXTURE-STATEMENT-COUNT', Array.isArray(fxManifest.manifest) && fxManifest.manifest.length>=9, `Packaged synthetic financial statement fixtures: ${fxManifest.manifest?.length||0}.`);
const synthProvision=read('qa/tests/provision-synthetic-evidence.mjs');
add('SYNTHETIC-COMPANY-BEFORE-DOCUMENT', /const preCompany=await requireCompanyVisible/.test(synthProvision) && /const up=await callAt\(apiBase,'\/documents\/upload'/.test(synthProvision), 'Synthetic provisioning explicitly verifies company visibility before each financial document upload.');
add('FIXTURE-STATEMENT-TYPES', Array.isArray(fxManifest.manifest) && ['Income Statement','Balance Sheet','Cash Flow Statement'].every(t=>fxManifest.manifest.some(x=>x.statementType===t)), 'Income Statement, Balance Sheet and Cash Flow Statement fixtures are packaged.');
add('FIXTURE-KNOWLEDGE-DATA', typeof fxManifest.knowledgePdf==='string' && typeof fxManifest.knowledgeUrl==='string', 'Knowledge PDF and public URL fixtures are declared.');
add('VISIBLE-CERTIFICATION-API', /MYAI_CFO_VISIBLE_CERTIFICATION/.test(core) && /MYAI_CFO_VISIBLE_API_BASE/.test(core) && /\$VisibleApiBase/.test(core) && !/127\.0\.0\.1:47821/.test(core), 'Certification provisions synthetic evidence into the user-visible application backend through the explicit parent API base; no certification hard-coded port is allowed.');

const gate=read('qa/release-gate.mjs');
add('GATE-JOB-BOUND', /sameJob\(assurance\)/.test(gate) && /synthetic\?\.jobId===currentJob/.test(gate), 'Release gate requires same-job evidence.');
add('GATE-STRICT-ASSURANCE', Number(policy?.productionCertification?.minimumAssuranceTests||0)>=42 && /minimumAssuranceTests/.test(gate) && !/minimumAssuranceTests:42/.test(gate), `Final gate reads policy minimumAssuranceTests=${policy?.productionCertification?.minimumAssuranceTests}.`);
add('GATE-STRICT-LIVE', Number(policy?.productionCertification?.minimumLiveTests||0)>=11 && /minimumLiveTests/.test(gate) && /MODEL-002/.test(gate) && /RAG-004/.test(gate) && /AGENT-003/.test(gate) && /RECOVERY-006/.test(gate), `Final gate reads policy minimumLiveTests=${policy?.productionCertification?.minimumLiveTests}.`);
add('GATE-AUDIT', /audit\?\.status==='PASS'/.test(gate), 'Release gate requires audit-forensics PASS.');
const gateRuntime=await (async()=>{try{const {spawnSync}=await import('node:child_process'); const r=spawnSync(process.execPath,[path.join(root,'qa','release-gate.mjs')],{cwd:root,encoding:'utf8'}); return {ok:r.status===2 && !String(r.stderr||'').includes('ReferenceError') && String(r.stdout||'').includes('releaseGate'),status:r.status,stderr:String(r.stderr||'').slice(-1000)};}catch(e){return {ok:false,status:null,stderr:String(e?.message||e)}}})(); add('GATE-RUNTIME-EXECUTION',gateRuntime.ok,`release-gate executable sanity status=${gateRuntime.status}; ${gateRuntime.stderr}`);
const pre=read('qa/Preflight-ProductionCertification.mjs');
add('PREFLIGHT-FRESHNESS', /Fresh certification evidence boundary/.test(pre) && /production-assurance-latest\.json/.test(pre), 'Preflight checks stale certification outputs.');
// Whole-source sanity: required files non-empty and no NULs.
const qaResultsDir=path.join(root,'qa','results');
const selfRun = process.env.MYAI_CFO_SOURCE_SANITY_SELF_RUN === '1' || process.env.MYAI_CFO_PRECHECK === '1';
const ignoreSelfGenerated = selfRun ? new Set(['source-workflow-sanity-latest.json','certification-harness-preflight.json','financial-spine-safety.json']) : new Set();
const packagedQaResults=fs.existsSync(qaResultsDir)?fs.readdirSync(qaResultsDir,{withFileTypes:true}).filter(x=>x.isFile()).map(x=>x.name).filter(name=>!ignoreSelfGenerated.has(name)):[];
add('PACKAGE-NO-GENERATED-RESULTS', packagedQaResults.length===0, packagedQaResults.length?`Generated QA result files are present in release package: ${packagedQaResults.join(', ')}`:'Release package contains no generated QA result files.');
const runtimeState = fs.existsSync(path.join(root,'app','data','state.json')) || fs.existsSync(path.join(root,'app','.myai-cfo','audit','acceptance.jsonl'));
const allowRuntimeState = process.env.MYAI_CFO_ALLOW_RUNTIME_STATE === '1';
add('PACKAGE-CLEAN-STATE', !runtimeState || allowRuntimeState,
  !runtimeState
    ? 'Release package contains no pre-existing application state or acceptance audit history.'
    : allowRuntimeState
      ? 'Runtime application state is present because certification is running against the live user workspace; package cleanliness is enforced separately at release-package assembly.'
      : 'Release package contains runtime state; run this check against a pristine extracted release package.');
const required=['app/backend/server.mjs','qa/run-production-assurance.mjs','qa/tests/live-certification.mjs','qa/tests/synthetic-cfo-scenario.mjs','qa/tests/provision-synthetic-evidence.mjs','qa/tests/synthetic-fixture-extraction.mjs','qa/Run-ProductionCertification-Core.ps1','qa/release-gate.mjs'];
for(const rel of required){const buf=fs.readFileSync(path.join(root,rel));add(`FILE-${rel}`,buf.length>0&&!buf.includes(0),`${rel}: ${buf.length} bytes; no NUL byte.`);}
add('EARLY-SYNTHETIC-EVIDENCE', /CERT-004A[\s\S]*CERT-0040[\s\S]*CERT-004B[\s\S]*CERT-004C/.test(core) && /provision-synthetic-evidence\.mjs/.test(core), 'Certification starts its backend context, provisions synthetic evidence, verifies the end-to-end CFO surfaces, then proceeds to CERT-005.');
add('EARLY-SYNTHETIC-RESULT', /synthetic-evidence-latest\.json/.test(core) && /MYAI_CFO_VISIBLE_API_BASE/.test(core), 'Mandatory synthetic evidence stage writes and verifies its own evidence result.');
const synth=read('qa/tests/provision-synthetic-evidence.mjs');
add('SYNTHETIC-API-RESOLUTION', /const apiFor=/.test(synth) && /targets=/.test(synth), 'Synthetic provisioning resolves both isolated and visible API bases without undefined helper references.');
add('SYNTHETIC-NATIVE-EXIT-SAFE', !/process\.exit\(/.test(synth) && /process\.exitCode/.test(synth), 'Synthetic provisioning uses natural Node exit after I/O rather than immediate process.exit.');
add('NO-CERT-HARDCODED-PORT', !/(qa[\\/].*\.(?:mjs|ps1)).*127\.0\.0\.1:47821/s.test(core), 'Certification core does not hard-code the parent application port.');
add('CERT-CONTEXT-PROPAGATION', /\$script:certApiBase/.test(core) && /\$script:certApiPort/.test(core) && /--visibleApiBase.*\$VisibleApiBase/.test(core) && /--jobId.*\$JobId/.test(core), 'Certification context is explicitly propagated into dependent stages with script-scoped API variables.');
add('GLOBAL-CLEANUP', /finally\s*\{[\s\S]*?Collect-CertArtifacts[\s\S]*?Stop-CertBackend[\s\S]*?Remove-Item -Recurse -Force \$certTempRoot/.test(core) && /MYAI_CFO_CERT_TEARDOWN/.test(core), 'Certification cleanup is global and backend teardown closes late persistence writes before sandbox deletion.');
add('TERMINAL-STATE-GUARD', /QA_CERTIFICATION_FAILED/.test(server) && /QA_CERTIFICATION_COMPLETED/.test(server) && /watchdog/.test(server), 'Certification parent emits terminal state for failure/success and has a bounded watchdog.');
add('SYNTHETIC-URL-EARLY', /upsertKnowledgeUrl\(target\.api\)/.test(synth) && /upsertKnowledgePdf\(target\.api\)/.test(synth), 'Knowledge PDF and URL are provisioned in the same early synthetic evidence stage.');
add('SYNTHETIC-URL-CERT', /cert\.myai-cfo\.local\/synthetic\/knowledge-controls/.test(read('app/backend/server.mjs')), 'Certification URL uses a deterministic QA-only synthetic source, avoiding public-internet dependency while preserving the real URL ingestion API path.');
add('SYNTHETIC-DOCUMENT-TYPE-BINDING', /documentType:stmt\.statementType/.test(synth) && !/documentType:stmt\.documentType/.test(synth), 'Synthetic statement manifest uses the actual statementType field required by the document upload API.');
add('SYNTHETIC-SEED-MODE', /--seedOnly/.test(synth) && /--visibleOnly/.test(synth), 'Early visible synthetic seed mode is present.');
add('SYNTHETIC-UPLOAD-TIMEOUT', /timeoutMs:600000/.test(synth), 'Synthetic financial/Knowledge uploads allow enough time for the synchronous extraction path and reconcile committed requests after a client timeout.');
const browserSpecs=['qa/browser/critical-buttons.spec.mjs','qa/browser/all-buttons.spec.mjs','qa/browser/holistic-platform.spec.mjs','qa/tests/browser/critical-buttons.spec.mjs'].filter(rel=>fs.existsSync(path.join(root,rel))); add('NO-HARDCODED-BROWSER-PORT', browserSpecs.every(rel=>!/127\.0\.0\.1:47820/.test(read(rel))) && /new URLSearchParams\(window\.location\.search\)/.test(read('app/frontend/src/main.jsx')), 'Browser certification uses explicit environment URL and the UI accepts a runtime API base.');
add('ACTIVE-COMPANY-CERTIFICATION', /spec\.key==='healthy'/.test(synth) && /\/companies\/active/.test(synth), 'Visible certification selects the Healthy company before downstream verification so company-scoped surfaces have an active context.')
add('HEAVY-EXTRACTOR-OPT-IN', /MYAI_CFO_ENABLE_HEAVY_EXTRACTORS/.test(read('scripts/extraction/document_ensemble.py')) && /MYAI_CFO_ENABLE_HEAVY_EXTRACTORS/.test(read('scripts/pdf/extract_pdf_assets.py')), 'Optional heavy document-intelligence engines are opt-in; deterministic extraction is the default evidence spine.')
add('VISIBLE-UI-EVIDENCE-SPEC', fs.existsSync(path.join(root,'qa/browser/visible-cfo-evidence.spec.mjs')) && /visible company and document evidence/.test(read('qa/browser/visible-cfo-evidence.spec.mjs')) && /visible Dashboard and Intelligence/.test(read('qa/browser/visible-cfo-evidence.spec.mjs')) && /visible Knowledge Hub/.test(read('qa/browser/visible-cfo-evidence.spec.mjs')), 'Certification contains explicit rendered visible-application checks for the company/evidence workflow.')
add('EXTRACTION-FISCAL-YEAR-BINDING', /FISCAL_YEAR_RE/.test(read('scripts/extraction/document_ensemble.py')) && /row_fiscal_year/.test(read('scripts/extraction/document_ensemble.py')), 'Comparative financial statements retain row-level fiscal years instead of collapsing periods.');

const output={schemaVersion:'1.0',suite:'SOURCE_WORKFLOW_SANITY',version,generatedAt:new Date().toISOString(),status:failures.length?'FAIL':'PASS',checks,failures};
const out=path.join(root,'qa','results','source-workflow-sanity-latest.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));process.exit(failures.length?2:0);
