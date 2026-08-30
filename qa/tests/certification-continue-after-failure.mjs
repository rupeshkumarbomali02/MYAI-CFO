import fs from 'fs';
import path from 'path';

const root=path.resolve(process.argv[2]||process.cwd());
const p=path.join(root,'qa','Run-ProductionCertification-Core.ps1');
const s=fs.readFileSync(p,'utf8');
const checks=[
  ['continue flag',s.includes("MYAI_CFO_CERT_CONTINUE_AFTER_STAGE_FAILURE")],
  ['non-fatal Run-Step',s.includes('continuedAfterFailure')],
  ['final hold on any fail',s.includes('mandatoryFails.Count -gt 0')],
  ['post-0040 continuation eligibility',s.includes("$StepId -eq 'CERT-0040'")]
];
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)process.exitCode=1;}
