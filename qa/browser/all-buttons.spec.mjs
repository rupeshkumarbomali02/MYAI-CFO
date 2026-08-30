import { test, expect } from '@playwright/test';
const BASE=process.env.MYAI_CFO_UI_BASE||process.env.MYAI_FRONTEND_URL; if(!BASE) throw new Error('MYAI_CFO_UI_BASE or MYAI_FRONTEND_URL is required; refusing to use a hard-coded browser port.');
const routes=['/'];
const destructive=/delete|archive|restore|cancel|remove|permanent|reset/i;
test('rendered button coverage inventory and safe actions',async({page})=>{
  const failures=[]; page.on('pageerror',e=>failures.push(`pageerror:${e}`)); page.on('console',m=>{if(m.type()==='error')failures.push(`console:${m.text()}`)});
  for(const route of routes){
    await page.goto(BASE+route,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(300);
    const buttons=await page.getByRole('button').evaluateAll(btns=>btns.map((b,i)=>({i,label:(b.innerText||b.getAttribute('aria-label')||b.title||'').trim(),disabled:b.disabled})));
    for(const b of buttons){ if(!b.label||b.disabled||destructive.test(b.label)) continue; const loc=page.getByRole('button',{name:b.label}).first(); if(await loc.count()){try{await loc.click({timeout:2500});}catch(e){failures.push(`click:${b.label}:${e.message}`)}} }
  }
  expect(failures).toEqual([]);
});
