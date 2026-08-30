import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim();
const currentJob=String(process.env.MYAI_CFO_CERT_JOB_ID||'').trim();
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const policy=read(path.join(root,'qa/certification-policy.json'));
const lockfiles=[path.join(root,'app/backend/package-lock.json'),path.join(root,'app/frontend/package-lock.json')];
const paths={
 assurance:path.join(root,'qa/results/production-assurance-latest.json'),
 live:path.join(root,'qa/results/live-certification-latest.json'),
 browser:path.join(root,'qa/results/playwright-results.json'),
 synthetic:path.join(root,'qa/results/synthetic-cfo-latest.json'),
 preflight:path.join(root,'qa/results/certification-harness-preflight.json'),
 audit:path.join(root,'qa/results/audit-forensics-latest.json'),
 syntheticEvidence:path.join(root,'qa/results/synthetic-evidence-latest.json'),
 e2e:path.join(root,'qa/results/synthetic-cfo-e2e-latest.json')
};
const assurance=read(paths.assurance),live=read(paths.live),browser=read(paths.browser),synthetic=read(paths.synthetic),preflight=read(paths.preflight),audit=read(paths.audit),syntheticEvidence=read(paths.syntheticEvidence),e2e=read(paths.e2e);
const tests=Array.isArray(assurance?.tests)?assurance.tests:[];
const allPass=xs=>Array.isArray(xs)&&xs.length>0&&xs.every(x=>x?.ok===true&&x?.status==='PASS');
const categories={runtime:tests.filter(t=>t.category==='runtime'),security:tests.filter(t=>t.category==='AI_SECURITY'),rag:tests.filter(t=>t.category==='RAG'),agent:tests.filter(t=>t.category==='AGENT'),recovery:tests.filter(t=>t.category==='RECOVERY'),golden:tests.filter(t=>t.category==='GOLDEN')};
const sameJob=(x)=>!!x && !!currentJob && String(x?.jobId||'')===currentJob;
const uniqueIds=new Set(tests.map(t=>String(t?.id||''))).size===tests.length;
const requiredCategories=['runtime','AI_SECURITY','GOLDEN','RAG','AGENT','RECOVERY'];
const minAssurance=Number(policy?.productionCertification?.minimumAssuranceTests||42);
const minLive=Number(policy?.productionCertification?.minimumLiveTests||11);
const assurancePass=assurance?.build===version && sameJob(assurance) && String(assurance?.reportType||'')==='MYAI_CFO_PRODUCTION_ASSURANCE' && Number(assurance?.summary?.failed||0)===0 && tests.length>=minAssurance && uniqueIds && requiredCategories.every(c=>tests.some(t=>t.category===c)) && tests.every(t=>t.ok===true&&t.status==='PASS');
const visibleSynthetic=Array.isArray(syntheticEvidence?.targets)?syntheticEvidence.targets.find(t=>t?.label==='VISIBLE_APPLICATION'):null;
const checks={
 version:/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)&&policy?.releaseVersion===version,
 noLegacyPatchMetadata:!fs.existsSync(path.join(root,'RELEASE_PATCH.txt'))&&!fs.existsSync(path.join(root,'HOTFIX_VERSION.txt')),
 lockfiles:lockfiles.every(p=>{try{const d=JSON.parse(fs.readFileSync(p,'utf8'));return fs.statSync(p).size>0&&Number(d.lockfileVersion)>=2&&d.packages&&d.packages[''];}catch{return false}}),
 preflight:preflight?.status==='PASS'&&Number(preflight?.summary?.failed||0)===0,
 assurance:assurancePass&&sameJob(assurance),
 syntheticEvidence:syntheticEvidence?.jobId===currentJob&&syntheticEvidence?.status==='PASS'&&Number(syntheticEvidence?.companyCount||0)>=3&&Number(syntheticEvidence?.totalFinancialStatements||0)>=9&&syntheticEvidence?.knowledgePdf===true&&syntheticEvidence?.knowledgeUrl===true&&!!visibleSynthetic&&Number(visibleSynthetic?.verification?.companies?.length||0)>=3&&Number(visibleSynthetic?.verification?.activeDocumentCount||0)>=9&&visibleSynthetic?.verification?.hasKnowledgePdf===true&&visibleSynthetic?.verification?.hasKnowledgeUrl===true,
 e2e:e2e?.jobId===currentJob&&e2e?.status==='PASS'&&Number(e2e?.summary?.fail||1)===0,
 synthetic:synthetic?.jobId===currentJob&&synthetic?.status==='PASS'&&Array.isArray(synthetic?.scenarios)&&synthetic.scenarios.length>=3&&synthetic.scenarios.every(x=>x?.status==='PASS'),
 security:allPass(categories.security),
 golden:allPass(categories.golden),
 rag:allPass(categories.rag),
 agent:allPass(categories.agent),
 recovery:allPass(categories.recovery),
 live:live?.certificationStatus==='CERTIFIED'&&Array.isArray(live?.tests)&&live.tests.length>=minLive&&live.tests.every(t=>t?.ok===true)&&sameJob(live)&&['FIXTURE-000','SURFACE-002','ADV-006','MODEL-001','LIVE-001','MODEL-002','AGENT-003','RAG-004','RECOVERY-006','OMNI-007','AUDIT-005'].every(id=>live.tests.some(t=>t.id===id&&t.ok===true)),
 browser:!!browser&&browser.jobId===currentJob&&Number(browser?.stats?.expected||0)>0&&Number(browser?.stats?.unexpected||0)===0&&Number(browser?.stats?.failures||0)===0&&Number(browser?.stats?.flaky||0)===0,
 audit:audit?.status==='PASS'&&Number(audit?.hashChainBreaks||0)===0&&Number(audit?.malformedEvents||0)===0&&Number(audit?.certificationFailureWithoutReason||0)===0,
 productionBuild:fs.existsSync(path.join(root,'app/frontend/dist/index.html')),
 noNotRun:tests.every(t=>!['NOT_RUN','NOT_PROVEN','UNVERIFIED','HOLD'].includes(String(t?.status||'').toUpperCase()))
};
const requiredModelProof=live?.tests?.some(t=>t.id==='MODEL-002'&&t.ok===true);
const requiredRagProof=live?.tests?.some(t=>t.id==='RAG-004'&&t.ok===true);
const requiredAgentProof=live?.tests?.some(t=>t.id==='AGENT-003'&&t.ok===true);
const requiredRecoveryProof=live?.tests?.some(t=>t.id==='RECOVERY-006'&&t.ok===true);
const requiredBrowser=checks.browser;
const evidence={...checks,twoModelLifecycle:!!requiredModelProof,fullRag:!!requiredRagProof,agentTrajectory:!!requiredAgentProof,recovery:!!requiredRecoveryProof,productionBrowserE2E:!!requiredBrowser};
const GO=Object.values(evidence).every(Boolean);
console.log(JSON.stringify({releaseGate:GO?'GO':'HOLD',version,jobId:currentJob,evidence,counts:{assuranceTests:tests.length},required:{minimumAssuranceTests:minAssurance,minimumLiveTests:minLive}},null,2));
process.exitCode=GO?0:2;
