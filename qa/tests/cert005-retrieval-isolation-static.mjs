import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname,'..');
const server=fs.readFileSync(path.join(root,'app','backend','server.mjs'),'utf8');
const routeStart=server.indexOf("if(u.pathname==='/api/moni/route'&&req.method==='POST')");
const routeEnd=server.indexOf("if(u.pathname.startsWith('/api/moni/jobs/')&&req.method==='GET')",routeStart);
assert(routeStart>=0 && routeEnd>routeStart,'Moni route block not found');
const route=server.slice(routeStart,routeEnd);
const directGuard=route.indexOf('const directAiGuard=aiInputGuard({message,retrievedKnowledge:[]});');
const retrievalCall=route.indexOf('knowledgeRetrievalContext(activeKnowledge,message)');
const retrievalCatch=route.indexOf("code:injected?'RETRIEVAL_FAILURE_INJECTED':'RETRIEVAL_FAILURE'");
assert(directGuard>=0,'Direct AI guard missing from Moni route');
assert(retrievalCall>directGuard,'Retrieval must occur after direct AI guard');
assert(retrievalCatch>retrievalCall,'Structured retrieval failure handling missing');
assert(route.includes('retryable:true'),'Retrieval failure must be classified as retryable');
console.log('cert005-retrieval-isolation-static: PASS');
