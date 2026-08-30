import { test, expect } from '@playwright/test';
const base=process.env.MYAI_CFO_UI_URL||process.env.MYAI_FRONTEND_URL||process.env.MYAI_CFO_UI_BASE; if(!base) throw new Error('A certification browser URL environment variable is required; refusing to use a hard-coded browser port.');
const safeLabels=['Refresh','New chat','Load model','Reload','Reprocess','Validate','Benchmark','Search','Diagnosis','Auto-resolve','Run selected workflow'];
test('critical rendered actions execute without page/runtime errors',async({page})=>{
  const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(String(e))); const consoleErrors=[]; page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())}); await page.goto(base,{waitUntil:'networkidle'});
  const buttons=page.locator('button'); const count=await buttons.count(); expect(count).toBeGreaterThan(0); for(let i=0;i<count;i++){const b=buttons.nth(i); const text=((await b.innerText().catch(()=>''))||'').trim(); const aria=(await b.getAttribute('aria-label'))||''; const label=`${text} ${aria}`.trim(); if(!safeLabels.some(x=>label.toLowerCase().includes(x.toLowerCase()))) continue; await expect(b).toBeVisible(); if(await b.isEnabled()) {await b.click(); await page.waitForTimeout(250);} }
  expect(pageErrors,'page errors').toEqual([]); expect(consoleErrors.filter(x=>!/favicon/i.test(x)),'console errors').toEqual([]);
});
