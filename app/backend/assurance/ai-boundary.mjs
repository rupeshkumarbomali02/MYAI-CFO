const HOMOGLYPHS = /[\u0430\u0435\u043e\u0438\u0440\u0441\u0445\u0456\u04cf\u13a0\u03bf\u03b1\u03b5]/g;
function normalizeSecurityText(text='') {
  let s=String(text??'').normalize('NFKC');
  s=s.replace(HOMOGLYPHS,m=>({'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','і':'i','и':'i','И':'I','і':'i','ӏ':'l','Ꭰ':'A','ο':'o','α':'a'}[m]||m));
  s=s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g,'');
  s=s.replace(/\s+/g,' ').trim();
  return s;
}
const DIRECT_PATTERNS = [

  {id:'AI-SEC-001', re:/\b(ignore|disregard|override|forget)\b.{0,80}\b(previous|prior|earlier|system|developer|instructions|rules)\b/i, category:'instruction_hierarchy'},
  {id:'AI-SEC-002', re:/\b(reveal|show|print|dump|disclose|quote)\b.{0,60}\b(system prompt|developer prompt|hidden instructions|secret instructions)\b/i, category:'system_prompt_extraction'},
  {id:'AI-SEC-003', re:/\b(act as|pretend to be|roleplay as)\b.{0,50}\b(system|developer|admin|root)\b/i, category:'role_confusion'},
  {id:'AI-SEC-004', re:/\b(base64|rot13|unicode|hex|encoded|decode)\b.{0,80}\b(ignore|override|instructions|prompt)\b/i, category:'obfuscation'},
  {id:'AI-SEC-005', re:/\b(execute|perform|initiate|approve|authori[sz]e)\b.{0,90}\b(wire|transfer|payment|bank transfer|funds)\b/i, category:'unauthorized_financial_action'},
  {id:'AI-SEC-006', re:/\b(call|invoke|use)\b.{0,80}\b(tool|function)\b.{0,80}\b(ignore|bypass|override)\b/i, category:'tool_hijack'},
  {id:'AI-SEC-007', re:/\b(do not tell|hide|conceal|suppress)\b.{0,80}\b(user|operator|reviewer|audit)\b/i, category:'audit_evasion'},
  {id:'AI-SEC-008', re:/\b(exfiltrate|leak|dump|share)\b.{0,80}\b(company|tenant|workspace|document|financial)\b/i, category:'data_exfiltration'},
  {id:'AI-SEC-009', re:/\b(change|replace|switch)\b.{0,80}\b(the )?(goal|objective|task)\b|\b(goal|objective|task)\b.{0,80}\b(change|replace|switch)\b|\b(change|replace) the objective into\b/i, category:'goal_hijacking'},
  {id:'AI-SEC-010', re:/\b(use|treat|follow)\b.{0,50}\b(document|retrieved text|knowledge)\b.{0,80}\b(instruction|command|rule)\b/i, category:'indirect_prompt_injection'},
  {id:'AI-SEC-013', re:/\b(unrestricted|no safety rules|safety rules (do not|don't) apply|ignore all safety)\b/i, category:'jailbreak'},
  {id:'AI-SEC-014', re:/\b(another tenant|another workspace|different tenant|cross[- ]tenant|other company).{0,80}\b(data|records|financial|workspace|documents)\b/i, category:'cross_tenant_request'},

];

export function detectPromptInjection(text='') {
  const value=normalizeSecurityText(text);
  for(const rule of DIRECT_PATTERNS){
    if(rule.re.test(value)) return {blocked:true,testId:rule.id,category:rule.category,reason:'Potential prompt-injection or unauthorized-instruction pattern detected.'};
  }
  return {blocked:false,testId:null,category:null,reason:null};
}

const RETRIEVED_PATTERNS = [
  {id:'AI-SEC-010', re:/\b(use|treat|follow)\b.{0,50}\b(document|retrieved text|knowledge)\b.{0,80}\b(instruction|command|rule)\b/i, category:'indirect_prompt_injection'},
  {id:'AI-SEC-014', re:/\b(ignore|override|disregard|bypass)\b.{0,80}\b(company|tenant|workspace|document|financial)\b.{0,80}\b(rule|policy|permission|boundary|scope)\b/i, category:'cross_tenant_request'},
  {id:'AI-SEC-015', re:/\b(send|upload|post|forward|exfiltrate|leak|dump)\b.{0,100}\b(to|outside|external)\b.{0,80}\b(service|server|email|endpoint|url)\b/i, category:'data_exfiltration'},
];
export function detectRetrievedPromptInjection(text='') {
  const value=normalizeSecurityText(text);
  for(const rule of RETRIEVED_PATTERNS){
    if(rule.re.test(value)) return {blocked:true,testId:rule.id,category:rule.category,reason:'Retrieved content contains instruction-like or unauthorized-action text.'};
  }
  return {blocked:false,testId:null,category:null,reason:null};
}

export function scanRetrievedContent(chunks=[]) {
  const flagged=[];
  for(const chunk of chunks||[]){
    const r=detectRetrievedPromptInjection(chunk?.text||'');
    if(r.blocked) flagged.push({...r,knowledgeId:chunk?.knowledgeId||null,chunkIndex:chunk?.chunkIndex||null,chunkHash:chunk?.chunkHash||null});
  }
  return {safe:flagged.length===0,flagged};
}

export const AI_SECURITY_TESTS = [
  ...DIRECT_PATTERNS.map(x=>({id:x.id,category:x.category})),
  {id:'AI-SEC-011',category:'cross_company_evidence_leakage'},
  {id:'AI-SEC-012',category:'unauthorized_financial_action'},
];
