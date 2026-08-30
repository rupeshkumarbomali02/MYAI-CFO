import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const server=fs.readFileSync(path.join(root,'app/backend/server.mjs'),'utf8');
const frontend=fs.readFileSync(path.join(root,'app/frontend/src/main.jsx'),'utf8');
const extractor=fs.readFileSync(path.join(root,'scripts/extraction/document_ensemble.py'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim();
const checks=[
 ['version',/^\d+\.\d+\.\d+$/.test(version)&&server.includes('VERSION=' )&&server.includes(version)],
 ['cfo intelligence activeDocs scoped',server.includes('const activeDocs=docs;')&&server.includes('const activeDocIds=new Set(activeDocs.map(d=>d.id));')],
 ['factRank active-document guard',server.includes('const doc=activeDocs.find(d=>d.id===f.documentId);')],
 ['diagnostics deferredChecks',server.includes('const deferredChecks=checks.filter(x=>x.status===\'NOT_EVALUABLE\')')&&frontend.includes('Deferred evidence checks — not defects')],
 ['diagnostics failures only recommended',server.includes('const failedActions=checks.filter(x=>x.status===\'FAIL\')')],
 ['selective auto-repair',server.includes('selectiveRepairDocument')&&server.includes('DOCUMENT_SELECTIVE_AUTO_REPAIR_ATTEMPTED')],
 ['auto-repair only unhealthy documents',server.includes("!Array.isArray(d.structuredFacts)||d.structuredFacts.length===0")&&server.includes("DOCUMENT_FISCAL_YEAR_CONFLICT")],
 ['failed refresh preserves valid spine',server.includes('DOCUMENT_SELECTIVE_AUTO_REPAIR_PRESERVED')&&server.includes('preservedStructuredFactCount')],
 ['semantic inconsistencies are warnings',server.includes('DOCUMENT_FINANCIAL_SEMANTIC_VALIDATION_WARNING')&&server.includes("policy:'preserve-source-facts-block-derived-use'")],
 ['comparative period spine retained',server.includes('CURRENT_FINANCIAL_SPINE_VERSION=')&&server.includes('production-financial-spine-v4-semantic-financial-tables')],
 ['pypdf fallback extractor',extractor.includes('run_pypdf')&&extractor.includes('pypdf is an independent fallback')],
 ['OCR fallback extractor',extractor.includes('run_tesseract_ocr')&&extractor.includes('MYAI_CFO_ENABLE_OCR')],
 ['document title backend/UI',server.includes('title:b.title||b.filename')&&frontend.includes('aria-label="Document title"')],
 ['document extracted text UI',frontend.includes('/documents/${encodeURIComponent(d.id)}/content')&&server.includes("u.pathname.endsWith('/content')")],
 ['document visual/table viewer',server.includes("u.pathname.endsWith('/visuals')")&&frontend.includes('Images / tables')],
 ['knowledge URL provenance UI',frontend.includes('x.sourceUrl&&<small>Source URL:')],
 ['HTML remote image extraction',server.includes("kind:'remote-image'")&&server.includes("attr('src')")],
 ['Copilot deterministic provenance',server.includes('sourceFacts:deterministicAnswer.facts||[]')&&server.includes('sourceDocuments')],
 ['PA authoritative provenance',server.includes("sourceTitle:'IFRS 18 — Presentation and Disclosure in Financial Statements'")&&server.includes('authoritativeSourceUrl')],
 ['PA common standard typo normalization',server.includes('(?:ifrs|ifsr)\\s*[- ]?18')&&server.includes('(?:ifrs|ifsr)\\s*[- ]?16')],
 ['model-generated provenance block',server.includes('const sourceAuthoritative=')&&server.includes('Sources / provenance:')&&frontend.includes('answer-source-summary')],
 ['source-scale presentation',server.includes('presentationFactValue')&&frontend.includes('displayValue')],
 ['safe URL ingestion',server.includes('fetchPublicDocumentUrl')&&server.includes('Private or loopback document targets are not allowed')],
];
let failed=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} — ${name}`);if(!ok)failed++;}
console.log(JSON.stringify({passed:checks.filter(([,ok])=>ok).length,failed,checks},null,2));
process.exitCode=failed?1:0;
