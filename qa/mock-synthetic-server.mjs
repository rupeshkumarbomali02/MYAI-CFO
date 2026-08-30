
import http from 'node:http';
import {URL} from 'node:url';
const companies=[];
const docs=new Map();
const knowledge=[];
let seq=0;
function json(res,status,body){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',d=>s+=d);req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}})})}
function next(prefix){seq++;return `${prefix}-${seq}`;}
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://127.0.0.1');
    if(u.pathname==='/api/health'&&req.method==='GET') return json(res,200,{ok:true});
    if(u.pathname==='/api/companies'&&req.method==='GET') return json(res,200,{companies});
    if(u.pathname==='/api/companies'&&req.method==='POST'){
      const b=await body(req); const ex=companies.find(c=>c.name===b.name);
      if(ex) return json(res,409,{error:'exists'});
      const c={id:next('company'),...b,archived:false}; companies.push(c); docs.set(c.id,[]); return json(res,201,c);
    }
    if(u.pathname==='/api/companies/active'&&req.method==='POST') return json(res,200,{ok:true});
    if(u.pathname==='/api/documents'&&req.method==='GET'){
      const cid=u.searchParams.get('companyId'); return json(res,200,{documents:docs.get(cid)||[]});
    }
    if(u.pathname==='/api/documents/upload'&&req.method==='POST'){
      const b=await body(req); if(!b.documentType) return json(res,400,{error:'documentType is required'});
      const idd=next('doc');
      const yearFacts=['revenue','gross_profit','operating_income','ebitda','net_income','cash','assets','liabilities','current_assets','current_liabilities','debt','receivables','payables','inventory','operating_cash_flow','capex','depreciation_amortization'].map((concept,i)=>({id:next('fact'),concept,normalizedValue:100+i,rawValue:String(100+i),fiscalYear:'2024',evidenceText:`${concept} synthetic evidence`,documentId:idd,companyId:b.companyId}));
      yearFacts.push(...yearFacts.map((f)=>({...f,id:next('fact'),fiscalYear:'2025',normalizedValue:Number(f.normalizedValue)+10,rawValue:String(Number(f.rawValue)+10)})));
      const d={id:idd,filename:b.filename,documentType:b.documentType,fiscalYear:b.fiscalYear,documentFiscalYear:2025,aiStatus:'completed',status:'completed',progress:100,archived:false,structuredFacts:yearFacts,evidence:yearFacts.slice(0,6).map((f,i)=>({id:next('evidence'),documentId:idd,companyId:b.companyId,ordinal:i+1,text:f.evidenceText})),evidenceCount:6,factCount:yearFacts.length,contentPath:`mock/${idd}.txt`};
      docs.get(b.companyId).push(d); return json(res,201,{document:d,aiJobId:next('job')});
    }
    if(u.pathname.startsWith('/api/documents/jobs/')&&req.method==='GET') return json(res,200,{status:'completed'});
    if(u.pathname==='/api/knowledge/uploaded'&&req.method==='GET') return json(res,200,{documents:knowledge});
    if(u.pathname==='/api/knowledge/upload'&&req.method==='POST'){const b=await body(req);const k={id:next('k'),filename:b.filename,title:b.title,archived:false,sourcePath:`mock/${next('src')}.pdf`,contentPath:`mock/${next('txt')}.txt`};knowledge.push(k);return json(res,202,{jobId:next('kjob'),document:k});}
    if(u.pathname.startsWith('/api/knowledge/jobs/')&&req.method==='GET') return json(res,200,{status:'completed'});
    if(u.pathname==='/api/knowledge/url'&&req.method==='POST'){const b=await body(req);const ex=knowledge.find(k=>k.sourceUrl===b.url);if(ex)return json(res,409,{error:'exists'});const k={id:next('k'),sourceUrl:b.url,title:b.title,archived:false,sourcePath:`mock/${next('urlsrc')}.txt`,contentPath:`mock/${next('urltxt')}.txt`};knowledge.push(k);return json(res,201,k);}
    json(res,404,{error:'not found'});
  }catch(e){json(res,500,{error:e.message})}
});
server.listen(0,'127.0.0.1',()=>{console.log(server.address().port)});
