import {test,expect} from '@playwright/test';

const BASE=process.env.MYAI_CFO_UI_BASE||process.env.MYAI_FRONTEND_URL;
if(!BASE) throw new Error('MYAI_CFO_UI_BASE/MYAI_FRONTEND_URL is required.');
const apiQuery=new URL(BASE).searchParams.get('apiBase');
if(!apiQuery) throw new Error('Visible CFO browser verification requires apiBase query parameter.');
const API=apiQuery.replace(/\/$/,'');
const EVIDENCE_DIR=process.env.MYAI_VISIBLE_EVIDENCE_DIR||'';

async function json(path){
  const r=await fetch(`${API}${path}`,{signal:AbortSignal.timeout(30000)});
  const body=await r.json();
  if(!r.ok) throw new Error(`${path} HTTP ${r.status}: ${body?.error||body?.detail||''}`);
  return body;
}
function bodyText(page){return page.locator('body').innerText();}

test('visible company and document evidence is rendered', async ({page})=>{
  await page.goto(`${BASE}/companies`,{waitUntil:'networkidle'});
  await expect(page.getByText('Company control plane')).toBeVisible();
  await expect(page.getByText('MYAI CFO Test — Healthy',{exact:true})).toBeVisible();
  if(EVIDENCE_DIR) await page.screenshot({path:`${EVIDENCE_DIR}/visible-companies.png`,fullPage:true});
  await page.goto(`${BASE}/documents`,{waitUntil:'networkidle'});
  await expect(page.getByText('Financial Documents')).toBeVisible();
  const text=await bodyText(page);
  expect(text).toContain('healthy-income-2024-2025.pdf');
  expect(text).toContain('healthy-balance-2024-2025.pdf');
  expect(text).toContain('healthy-cashflow-2024-2025.pdf');
});

test('visible Dashboard and Intelligence contain company-linked figures', async ({page})=>{
  const dashApi=await json('/dashboard');
  expect(dashApi.company?.name).toBe('MYAI CFO Test — Healthy');
  const kpis=Array.isArray(dashApi.dynamicKpis)?dashApi.dynamicKpis:[];
  expect(kpis.length).toBeGreaterThan(0);
  const concepts=new Set(kpis.map(x=>x.concept));
  expect([...concepts]).toEqual(expect.arrayContaining(['revenue','cash','current_assets','current_liabilities','debt']));

  await page.goto(`${BASE}/dashboard`,{waitUntil:'networkidle'});
  let text=await bodyText(page);
  expect(text).toContain('MYAI CFO Test — Healthy');
  expect(text).toContain('Revenue');
  expect(text).toContain('Cash');
  if(EVIDENCE_DIR) await page.screenshot({path:`${EVIDENCE_DIR}/visible-dashboard.png`,fullPage:true});

  const intel=await json('/cfo-intelligence');
  expect(intel.company?.name).toBe('MYAI CFO Test — Healthy');
  const ratios=Array.isArray(intel.ratios)?intel.ratios:[];
  expect(ratios.filter(x=>x?.value!=null).length).toBeGreaterThanOrEqual(5);
  await page.goto(`${BASE}/intelligence`,{waitUntil:'networkidle'});
  text=await bodyText(page);
  expect(text).toContain('Executive intelligence for MYAI CFO Test — Healthy');
  expect(text).toContain('Comprehensive finance ratios & KPIs');
  if(EVIDENCE_DIR) await page.screenshot({path:`${EVIDENCE_DIR}/visible-intelligence.png`,fullPage:true});
});

test('visible Knowledge Hub contains seeded evidence', async ({page})=>{
  const k=await json('/knowledge/uploaded');
  const items=(k.documents||k.items||[]).filter(x=>!x.archived);
  expect(items.length).toBeGreaterThanOrEqual(2);
  await page.goto(`${BASE}/knowledge`,{waitUntil:'networkidle'});
  const text=await bodyText(page);
  expect(text).toContain('MYAI CFO Certification Knowledge Evidence');
  expect(text).toContain('MYAI CFO Certification Synthetic URL Evidence');
  if(EVIDENCE_DIR) await page.screenshot({path:`${EVIDENCE_DIR}/visible-knowledge.png`,fullPage:true});
});
