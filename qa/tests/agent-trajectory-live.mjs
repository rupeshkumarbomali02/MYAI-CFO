import assert from 'node:assert/strict';
const base=process.env.MYAI_BASE_URL||''; if(!base)throw new Error('MYAI_BASE_URL is required for certification test; refusing to use a hard-coded fallback.');
async function call(path,opts={}){try{const r=await fetch(`${base}${path}`,opts); const text=await r.text(); let body={}; try{body=JSON.parse(text)}catch{} return {status:r.status,body};}catch(e){return {status:0,body:{error:String(e?.message||e),code:e?.cause?.code||e?.code||'NETWORK_ERROR'}};}}
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

const post=await call('/moni/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Give a CFO working-capital assessment using available evidence.',task:'general_cfo',workspace:'copilot'})});
if(post.status===0){console.log(JSON.stringify({status:'NOT_PROVEN',reason:'Live CFO API unavailable',error:post.body?.error||'network error'}));process.exit(2)}
assert.equal(post.status,202); const jobId=post.body.jobId; let job=null; for(let i=0;i<120;i++){const r=await call(`/moni/jobs/${encodeURIComponent(jobId)}`); if(r.status!==200){console.log(JSON.stringify({status:'FAIL',reason:'job polling failed',statusCode:r.status,body:r.body}));process.exit(1)} job=r.body; if(['completed','failed','cancelled','waiting_for_model'].includes(job.status))break; await new Promise(r=>setTimeout(r,1000));}
if(job.status==='waiting_for_model'){console.log(JSON.stringify({status:'NOT_PROVEN',reason:'operational model runtime unavailable',jobId,trajectory:job.trajectory||null}));process.exit(2)}
if(job.status!=='completed'){console.log(JSON.stringify({status:'FAIL',jobId,error:job.error,job}));process.exit(1)}
const trace=job.trajectory||job.result?.trajectory||job.result?.moni?.trajectory; assert.ok(trace,'live trajectory missing'); for(const k of ['goal','plan','decisions','toolCalls','toolArguments','toolResults','termination','finalAnswer']) assert.ok(trace[k]!==undefined,k); console.log(JSON.stringify({status:'PASS',jobId,trajectory:trace},null,2));
