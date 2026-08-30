import { fileURLToPath } from 'node:url';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
const root=path.resolve(process.argv[2]||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));const result={schemaVersion:'1.0',type:'CERTIFICATION_HARNESS_PREFLIGHT',generatedAt:new Date().toISOString(),root,checks:[],failures:[]};
const check=(id,name,ok,detail)=>{const x={id,name,status:ok?'PASS':'FAIL',ok:!!ok,detail};result.checks.push(x);if(!ok)result.failures.push(x)};const exists=r=>fs.existsSync(path.join(root,r));
for(const [id,rel] of [['FILES-000','qa/tests/source-workflow-sanity.mjs'],['FILES-001','qa/Run-ProductionCertification-Core.ps1'],['FILES-002','qa/Run-ProductionCertification.ps1'],['FILES-003','qa/release-gate.mjs'],['FILES-004','qa/tests/live-certification.mjs'],['FILES-005','qa/tests/synthetic-cfo-scenario.mjs'],['FILES-006','qa/browser/holistic-platform.spec.mjs'],['FILES-007','qa/tests/provision-synthetic-evidence.mjs'],['FILES-008','qa/tests/synthetic-fixture-extraction.mjs']])check(id,`Required certification asset: ${rel}`,exists(rel),exists(rel)?'Present.':'Missing.');

const scanTreeSafety=()=>{
  const maxDepth=32, maxPathLength=240, forbiddenNames=new Set(['.certification-temp','.npm-cache','.myai-cfo-certification-temp']), generatedVendorRoots=[path.join(root,'app','tools','node-win')];
  const stack=[[root,0]]; let deepest=0, deepestPath=root, overDepth=null, overLen=null, forbidden=[];
  while(stack.length){
    const [dir,depth]=stack.pop();
    if(depth>deepest){deepest=depth;deepestPath=dir;}
    if(depth>maxDepth){overDepth=dir;break;}
    let entries=[]; try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(e){continue;}
    for(const ent of entries){
      const full=path.join(dir,ent.name);
      const rel=path.relative(root,full);
      const inGeneratedVendor=generatedVendorRoots.some(v=>full===v || full.startsWith(v+path.sep));
      if(!inGeneratedVendor && full.length>maxPathLength && !overLen) overLen=full;
      if(ent.isDirectory()){
        if(forbiddenNames.has(ent.name.toLowerCase())) forbidden.push(rel);
        if(generatedVendorRoots.includes(full)) continue;
        stack.push([full,depth+1]);
      }
    }
  }
  const ok=!overDepth && !overLen && forbidden.length===0;
  const detail=JSON.stringify({maxDepth,observedDepth:deepest,deepestPath:path.relative(root,deepestPath),maxPathLength,overDepthPath:overDepth?path.relative(root,overDepth):null,overPathLength:overLen?path.relative(root,overLen):null,forbiddenCertificationDirs:forbidden.slice(0,20)})
  check('PATH-001','Certification package tree safety',ok,detail);
};
scanTreeSafety();
const staleCertificationOutputs=[
  'qa/results/production-certification-latest.json',
  'qa/results/production-assurance-latest.json',
  'qa/results/live-certification-latest.json',
  'qa/results/synthetic-cfo-latest.json','qa/results/synthetic-evidence-latest.json',
  'qa/results/playwright-results.json',
  'qa/results/audit-forensics-latest.json'
].filter(rel=>fs.existsSync(path.join(root,rel)));
check('CLEAN-001','Fresh certification evidence boundary',staleCertificationOutputs.length===0,
  staleCertificationOutputs.length===0?'No stale latest certification outputs are present.':`Stale certification outputs present: ${staleCertificationOutputs.join(', ')}`);
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim();
check('VERSION-001','Release version',/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version),`VERSION=${version}`);
for(const rel of ['app/backend/package.json','app/frontend/package.json']){try{const d=JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));check('VERSION-'+rel.replaceAll('/','-'),'Package version consistency',d.version===version,`${rel}=${d.version}`)}catch(e){check('VERSION-'+rel,'Package JSON parse',false,e.message)}}
const node=process.execPath;
check('ENV-001','Node runtime',Number(process.versions.node.split('.')[0])>=20,process.version);
const sanity=spawnSync(node,[path.join(root,'qa','tests','source-workflow-sanity.mjs')],{cwd:root,encoding:'utf8',env:{...process.env,MYAI_CFO_ALLOW_RUNTIME_STATE:'1',MYAI_CFO_SOURCE_SANITY_SELF_RUN:'1'}});check('SOURCE-001','Source/workflow sanity regression',sanity.status===0,`status=${sanity.status}; stdout=${String(sanity.stdout||'').slice(-1500)}; stderr=${String(sanity.stderr||'').slice(-1500)}`);
const fixtureResultsDir=fs.mkdtempSync(path.join(os.tmpdir(),'myai-cfo-fixture-test-'));
const fixture=spawnSync(node,[path.join(root,'qa','tests','synthetic-fixture-extraction.mjs')],{cwd:root,encoding:'utf8',env:{...process.env,MYAI_CFO_TEST_RESULTS_DIR:fixtureResultsDir}});
try{fs.rmSync(fixtureResultsDir,{recursive:true,force:true})}catch{}check('FIXTURE-001','Synthetic financial fixture extraction regression',fixture.status===0,`status=${fixture.status}; stdout=${String(fixture.stdout||'').slice(-2500)}; stderr=${String(fixture.stderr||'').slice(-1500)}`);
let np;
if(process.platform==='win32'){
  // npm.cmd is a Windows command shim. spawnSync('npm.cmd', ...) can return status=null
  // on some Node/Windows combinations unless it is launched through cmd.exe.
  np=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm.cmd --version'],{cwd:root,encoding:'utf8',windowsHide:true});
}else{
  np=spawnSync('npm',['--version'],{cwd:root,encoding:'utf8'});
}
const npmDetail=np?.error?`spawnError=${np.error.code||np.error.message}; status=${np.status}; stdout=${String(np.stdout||'').trim()}; stderr=${String(np.stderr||'').trim()}`:`status=${np?.status}; stdout=${String(np?.stdout||'').trim()}; stderr=${String(np?.stderr||'').trim()}`;
check('ENV-002','npm runtime',np?.status===0, npmDetail);
if(process.platform==='win32'){const psFiles=[];for(const rel of ['qa','scripts/setup']){for(const f of fs.readdirSync(path.join(root,rel),{withFileTypes:true})){if(f.isFile()&&f.name.toLowerCase().endsWith('.ps1'))psFiles.push(path.join(rel,f.name));}}psFiles.push('qa/Run-ProductionCertification-Core.ps1','qa/Run-ProductionCertification.ps1');const unique=[...new Set(psFiles)];let i=1;for(const rel of unique){const esc=path.join(root,rel).replaceAll("'","''");const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop';[ScriptBlock]::Create((Get-Content -Raw -LiteralPath '${esc}'))|Out-Null;'PARSE_OK'`],{cwd:root,encoding:'utf8'});check(`PS-${String(i++).padStart(2,'0')}`,`PowerShell parse: ${rel}`,r.status===0&&String(r.stdout).includes('PARSE_OK'),`status=${r.status}; stdout=${String(r.stdout||'').trim()}; stderr=${String(r.stderr||'').trim()}`)}}else{check('PS-001','PowerShell parse deferred',true,'PowerShell is not installed in this QA container; target Windows run required.');}
const tempRoot=process.env.MYAI_CFO_CERT_TEMP_ROOT||path.resolve(process.env.MYAI_CFO_CERT_TEMP_ROOT || path.join(os.tmpdir(),'MYAI-CFO-Certification'));fs.mkdirSync(tempRoot,{recursive:true});const sand=fs.mkdtempSync(path.join(tempRoot,'myai-cfo-cert-preflight-'));try{const a=path.join(sand,'a.txt'),b=path.join(sand,'b.txt');fs.writeFileSync(a,'preflight','utf8');fs.copyFileSync(a,b);check('SANDBOX-001','Sandbox create/copy/read/delete',fs.readFileSync(b,'utf8')==='preflight','Temporary file cycle completed.');fs.rmSync(b,{force:true})}finally{fs.rmSync(sand,{recursive:true,force:true})}
const gate=fs.readFileSync(path.join(root,'qa/release-gate.mjs'),'utf8');for(const token of ['live-certification-latest.json','playwright-results.json','package-lock.json','production-assurance-latest.json','synthetic-cfo-latest.json','audit-forensics-latest.json'])check('GATE-'+token,'Release gate references '+token,gate.includes(token),gate.includes(token)?'Referenced.':'Not referenced.');
result.status=result.failures.length?'HOLD':'PASS';result.summary={checks:result.checks.length,passed:result.checks.filter(x=>x.ok).length,failed:result.failures.length};fs.mkdirSync(path.join(root,'qa','results'),{recursive:true});fs.writeFileSync(path.join(root,'qa','results','certification-harness-preflight.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.failures.length?2:0;
