import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function loadCorePolicy(root){
  const file=path.join(root,'app','backend','policy','core-policy.json');
  const raw=fs.readFileSync(file,'utf8');
  const policy=JSON.parse(raw);
  policy.hash=crypto.createHash('sha256').update(raw,'utf8').digest('hex');
  return policy;
}

const EXPECTED_POLICY_HASH = 'a9149fb03553420728f533c51a437892d9313c7b1f4d64642696e71d589bb117';

export function verifyPolicyIntegrity(policy){
  return policy.hash === EXPECTED_POLICY_HASH;
}

export function makePolicyEngine(policy){
  const rules=[
    {category:'child_safety', re:/\b(child sexual|sexual(?:ly)? exploit(?:ation|ing)|groom(?:ing|ed)|minor sexual|underage sexual|csam)\b/i},
    {category:'self_harm_suicide', re:/\b(suicid(?:e|al)|kill myself|end my life|want to die|wanna die|self[- ]?harm|hurt myself|ways? to die|how to die)\b/i},
    {category:'weapons_cbrn', re:/\b(build|make|design|synthesize|acquire)\b.{0,80}\b(bomb|explosive|chemical weapon|biological weapon|nerve agent|radiological weapon|nuclear weapon)\b/i},
    {category:'malicious_code_cyber', re:/\b(ransomware|keylogger|credential stealer|steal passwords|phishing kit|malware|spyware|botnet|ddos|exploit)\b/i},
    {category:'fraud_scams_deception', re:/\b(phishing|fake invoice|fake bank|counterfeit document|forge (?:a )?(?:signature|document)|scam script|impersonate .*?for fraud|fake review)\b/i},
    {category:'violence_harassment_hate', re:/\b(kill all|exterminate|genocide|threaten .*?violence|targeted harassment|dehumaniz(?:e|ing))\b/i},
    {category:'adult_sexual_content', re:/\b(porn|pornography|sexual roleplay|explicit sexual|nude pics?|naked pics?|blowjob|handjob|sexually explicit)\b/i},
    {category:'election_integrity', re:/\b(voter suppression|suppress turnout|fake voting date|fake voting eligibility|fabricated claim .*?public figure|inauthentic campaign)\b/i},
    {category:'privacy_violation', re:/\b(doxx|doxxing|home address .*?private person|track .*?without consent|stalk .*?without consent|expose .*?private information)\b/i},
    {category:'abusive_vulgarity', re:/(?:^|[\s])(?:fuck|fucking|motherfucker|cunt|dickhead|bitch)(?:[\s!,.?]|$)/i}
  ];
  return function check(text='',stage='input'){
    const value=String(text??'').trim();
    for(const rule of rules){
      if(rule.re.test(value)){
        const supportive=rule.category==='self_harm_suicide';
        return {allowed:false,decision:supportive?'block_or_support':'block',category:rule.category,stage,policyVersion:policy.version,policyHash:policy.hash,
          message:supportive
            ? 'I can help with finance, accounting, research and workflow support, but I cannot provide self-harm or suicide-related instructions. If this concerns an immediate safety risk, contact a trusted person or local emergency/crisis support.'
            : 'I can help with finance, accounting, research and workflow support, but this request is outside MYAI CFO safety boundaries.'};
      }
    }
    return {allowed:true,decision:'allow',category:null,stage,policyVersion:policy.version,policyHash:policy.hash,message:null};
  };
}
