import { test, expect } from '@playwright/test';

const routes = [
  '/',
  '/dashboard',
  '/intelligence',
  '/companies',
  '/documents',
  '/copilot',
  '/pa',
  '/knowledge',
  '/arena',
  '/models',
  '/world-time',
  '/market',
  '/audit',
  '/diagnostics',
  '/settings'
];

const safeActions = [
  /Refresh/i,
  /New chat/i,
  /Run complete diagnosis/i,
  /Auto-resolve safe defects/i,
  /Search sources/i,
  /Add URL/i,
  /Load model/i,
  /Reload/i,
  /Reprocess/i,
  /Review outcome/i,
  /Validate/i,
  /Open source/i,
  /Benchmark/i
];

function labelOf(locator){
  return locator.evaluate(el => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim());
}

test.describe('MYAI CFO critical browser behavior', () => {
  test('safe critical actions are actually clicked and do not produce UI/runtime errors', async ({ page }) => {
    const base = process.env.MYAI_FRONTEND_URL || process.env.MYAI_CFO_UI_BASE; if(!base) throw new Error('MYAI_FRONTEND_URL or MYAI_CFO_UI_BASE is required; refusing to use a hard-coded browser port.');
    const consoleErrors=[]; const pageErrors=[];
    page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
    page.on('pageerror',e=>pageErrors.push(String(e?.message||e)));
    for(const route of routes){
      await page.goto(base+route,{waitUntil:'domcontentloaded'});
      const buttons=page.locator('button');
      const n=await buttons.count();
      for(let i=0;i<n;i++){
        const b=buttons.nth(i); if(!(await b.isVisible()).catch(()=>false)) continue;
        const label=await labelOf(b); if(!label) continue;
        const matches=safeActions.some(r=>r.test(label)); if(!matches) continue;
        if(!(await b.isEnabled()).catch(()=>false)) continue;
        await b.click({timeout:5000});
        await page.waitForTimeout(200);
        const bodyText=(await page.locator('body').innerText()).slice(0,120000);
        expect(bodyText).not.toMatch(/Unhandled|TypeError|ReferenceError|Cannot read properties|API_REQUEST_FAILED/i);
      }
    }
    expect(pageErrors,`page errors: ${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors,`console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });
});
