const base=process.env.MYAI_BASE_URL||''; if(!base)throw new Error('MYAI_BASE_URL is required for certification test; refusing to use a hard-coded fallback.');
async function call(path,opts={}){try{const r=await fetch(`${base}${path}`,opts);const text=await r.text();let body={};try{body=JSON.parse(text)}catch{}return {status:r.status,body};}catch(e){return {status:0,body:{error:String(e?.message||e),code:e?.cause?.code||e?.code||'NETWORK_ERROR'}};}}
async function ensureDisclaimerAccepted(){
  const d=await call('/disclaimer');
  if(d.status===200 && d.body?.accepted!==true){
    const a=await call('/disclaimer/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:d.body.version,hash:d.body.hash})});
    return a.status===200;
  }
  return d.status===200;
}
const disclaimerReady=await ensureDisclaimerAccepted();
if(!disclaimerReady){console.log(JSON.stringify({status:'NOT_PROVEN',reason:'Disclaimer could not be accepted in isolated test workspace'}));process.exit(2)}

const headers={'Content-Type':'application/json'};
const seeded=await call('/qa/rag/seed',{method:'POST',headers,body:JSON.stringify({items:[{id:'REC-RAG-1',content:'Recovery fixture: cash conversion cycle and working capital evidence.'}]})});
if(seeded.status===0){console.log(JSON.stringify({status:'NOT_PROVEN',reason:'Live CFO API unavailable',error:seeded.body?.error||'network error'}));process.exit(2)}
if(seeded.status!==200){console.log(JSON.stringify({status:'NOT_PROVEN',reason:'QA mode endpoint unavailable'}));process.exit(2)}
let r=await call('/qa/faults',{method:'POST',headers,body:JSON.stringify({retrievalFailure:true})}); if(r.status!==200){console.log(JSON.stringify({status:'FAIL',reason:'fault injection failed',r}));process.exit(1)}
const failed=await call('/qa/rag/retrieve?q=working%20capital'); if(failed.status!==503){console.log(JSON.stringify({status:'FAIL',reason:'real retrieval boundary did not fail as injected',failed}));process.exit(1)}
const repair=await call('/diagnostics/auto-repair',{method:'POST',headers,body:'{}'}); if(repair.status!==200){console.log(JSON.stringify({status:'FAIL',reason:'auto-repair endpoint failed',repair}));process.exit(1)}
const retest=await call('/qa/rag/retrieve?q=working%20capital'); if(retest.status!==200||!(retest.body.results||[]).length){console.log(JSON.stringify({status:'FAIL',reason:'independent post-recovery retrieval retest failed',retest}));process.exit(1)}
console.log(JSON.stringify({status:'PASS',failure:'retrieval-failure',failureObserved:failed.status===503,repair:repair.body.actions,independentRetest:{status:retest.status,resultCount:retest.body.results.length}}));
