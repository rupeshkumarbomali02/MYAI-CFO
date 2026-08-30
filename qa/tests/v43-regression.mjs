import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const server = fs.readFileSync(path.join(root, 'app/backend/server.mjs'), 'utf8');
const extractor = fs.readFileSync(path.join(root, 'scripts/extraction/document_ensemble.py'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'app/frontend/src/main.jsx'), 'utf8');

const checks = [
  ['deterministic financial spine cannot be downgraded by AI no-facts', server.includes('DOCUMENT_AI_REVIEW_DETERMINISTIC_SPINE_PRESERVED') && server.includes('postDocFacts')],
  ['filtered Copilot context includes requested fact fiscal years', server.includes('structuredFacts)?d.structuredFacts') && server.includes('factInRequestedYear')],
  ['Dashboard preserves source-scale presentation', server.includes('presentationFactValue') && server.includes('displayValue')],
  ['Tesla year-end filename period guard', extractor.includes('filename_document_year') && extractor.includes('month==12 and day==31') && frontend.includes('inferFiscalYearFromFilename')],
  ['IFRS 18 authoritative PA guard', server.includes('directKnowledgeStandardAnswer') && server.includes('IFRS 18 — Presentation and Disclosure in Financial Statements')],
  ['OmniRoute remains optional/local-first', server.includes('Company evidence is never sent to an online provider unless Online Route is explicitly enabled')],
  ['release version aligned', (()=>{const v=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim(); return /^\d+\.\d+\.\d+$/.test(v) && server.includes(v)})()],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
if (failed.length) process.exit(1);
console.log(`PASS — V44 compatibility regression source gate (${checks.length}/${checks.length})`);
