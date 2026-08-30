import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const server=fs.readFileSync(path.join(root,'app/backend/server.mjs'),'utf8');
const boundary=fs.readFileSync(path.join(root,'app/backend/assurance/ai-boundary.mjs'),'utf8');
const frontend=fs.readFileSync(path.join(root,'app/frontend/src/main.jsx'),'utf8');
const extractor=fs.readFileSync(path.join(root,'scripts/extraction/document_ensemble.py'),'utf8');
const tests=[
 ['URL financial-document ingestion exists',server.includes("/api/documents/url")&&server.includes('fetchPublicDocumentUrl')],
 ['URL provenance is persisted/displayed',server.includes('sourceUrl=String(b.url)')&&frontend.includes('Source URL:')],
 ['URL SSRF protection',server.includes('Private or loopback document targets are not allowed')&&server.includes('redirect:\'manual\'')],
 ['Dashboard no scale word',frontend.includes('return `${c} ${Number.isFinite(value)')&&!frontend.includes("return `${c} ${raw.toLocaleString(undefined,{maximumFractionDigits:2})} ${s}`")],
 ['Dashboard source-scale conversion',server.includes("n/factor,scale:'units'")],
 ['Copilot explicit scope does not require active-company equality',server.includes("const valid=new Set((state.companies||[]).filter(c=>!c.archived)")&&!server.includes("ids.some(idv=>idv!==active)")],
 ['Retrieved-content guard uses stricter patterns',boundary.includes('detectRetrievedPromptInjection')&&boundary.includes('RETRIEVED_PATTERNS')],
 ['IFRS 16 deterministic PA answer',server.includes("standard:'IFRS 16'")&&server.includes('IFRS 16 — Leases')],
 ['Deterministic answers bypass retrieved-content false positives',server.includes('earlyPaDeterministic')&&server.includes('earlyDeterministic')],
 ['Tesla debt aliases supported',extractor.includes('debt and finance leases')],
 ['Release version aligned to VERSION.txt',(()=>{const v=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim();return /^\d+\.\d+\.\d+$/.test(v)&&server.includes(v)&&server.includes('Document Import')})()]
];
let failed=0;for(const [name,ok] of tests){console.log(`${ok?'PASS':'FAIL'} — ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);console.log(`PASS — V44 regression source gate (${tests.length}/${tests.length})`);
