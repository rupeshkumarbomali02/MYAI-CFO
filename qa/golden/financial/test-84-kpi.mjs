import fs from 'node:fs';
import vm from 'node:vm';

const server=fs.readFileSync(new URL('../../../app/backend/server.mjs', import.meta.url),'utf8');
const start=server.indexOf('function buildRatioLibrary(');
if(start<0) throw new Error('buildRatioLibrary not found');
let depth=0, started=false, end=-1;
for(let i=start;i<server.length;i++){
  const ch=server[i];
  if(ch==='{'){depth++;started=true;}
  else if(ch==='}'&&started){depth--; if(depth===0){end=i+1;break;}}
}
if(end<0) throw new Error('buildRatioLibrary end not found');
const source=server.slice(start,end)+'\nresult=buildRatioLibrary;';
const ctx={result:null,normalizeFinancialNumber:(v)=>{if(v==null||v==='')return null; const n=Number(v);return Number.isFinite(n)?n:null;},clamp:(v,a,b)=>Math.min(b,Math.max(a,v))};
vm.createContext(ctx); vm.runInContext(source,ctx);
const buildRatioLibrary=ctx.result;

const concepts=['revenue','cogs','gross_profit','operating_income','net_income','ebitda','cash','current_assets','current_liabilities','assets','liabilities','debt','receivables','payables','inventory','capex','operating_cash_flow','depreciation_amortization','interest_expense',
  'share_price','eps','book_value_per_share','market_cap','enterprise_value','preferred_dividends','weighted_avg_shares','dividends_paid','annual_dividend_per_share','tax_rate','nopat','invested_capital','ebit','capital_employed','net_fixed_assets','average_total_assets','average_inventory','average_receivables','average_payables','net_credit_sales','total_debt_service','net_operating_income','lease_payments','prior_revenue','beginning_value','ending_value','number_of_years','net_borrowing','change_working_capital','beginning_cash','ending_cash','number_of_months','average_working_capital','depreciation','operating_expenses','operating_costs','sga_expenses','budgeted_amount','actual_amount','total_production_cost','units_produced','mrr','sales_marketing_spend','new_customers','avg_revenue_per_customer','churn_rate','starting_arr','expansion','contraction','churn_arr','starting_revenue','lost_revenue','customers_lost','starting_customers','mrr_per_customer','revenue_growth_rate','current_quarter_revenue','prior_quarter_revenue','prior_quarter_sales_marketing_spend','net_cash_burn','net_new_arr','retained_earnings','market_value_equity','cost_of_equity','cost_of_debt','risk_free_rate','beta','market_return','tax_expense','taxes','one_off_adjustments','fixed_costs','price_per_unit','variable_cost_per_unit','actual_sales','break_even_sales','prior_ebitda','prior_operating_income','variable_costs','organic_growth'];
const special={
  revenue:1000,cogs:600,gross_profit:400,operating_income:150,net_income:100,ebitda:180,cash:200,current_assets:500,current_liabilities:250,assets:1000,liabilities:400,debt:300,receivables:100,payables:80,inventory:120,capex:50,operating_cash_flow:100,depreciation_amortization:30,interest_expense:20,
  share_price:25,eps:2.5,book_value_per_share:10,market_cap:2500,enterprise_value:3300,preferred_dividends:5,weighted_avg_shares:40,dividends_paid:20,annual_dividend_per_share:0.5,
  tax_rate:0.25,nopat:120,invested_capital:700,ebit:150,capital_employed:1040,net_fixed_assets:450,average_total_assets:950,average_inventory:100,average_receivables:90,average_payables:75,net_credit_sales:900,total_debt_service:60,net_operating_income:150,lease_payments:10,prior_revenue:900,beginning_value:600,ending_value:1000,number_of_years:2,net_borrowing:50,change_working_capital:20,beginning_cash:100,ending_cash:200,number_of_months:12,average_working_capital:200,depreciation:30,operating_expenses:250,operating_costs:600,sga_expenses:120,budgeted_amount:900,actual_amount:940,total_production_cost:600,units_produced:200,mrr:80,sales_marketing_spend:100,new_customers:20,avg_revenue_per_customer:100,churn_rate:0.05,starting_arr:1000,expansion:120,contraction:40,churn_arr:40,starting_revenue:900,lost_revenue:40,customers_lost:4,starting_customers:100,mrr_per_customer:0.8,revenue_growth_rate:0.2,current_quarter_revenue:300,prior_quarter_revenue:250,prior_quarter_sales_marketing_spend:75,net_cash_burn:50,net_new_arr:200,retained_earnings:200,market_value_equity:2500,cost_of_equity:0.1,cost_of_debt:0.05,risk_free_rate:0.04,beta:1.1,market_return:0.1,tax_expense:25,taxes:25,one_off_adjustments:10,fixed_costs:200,price_per_unit:10,variable_cost_per_unit:2,actual_sales:400,break_even_sales:200,prior_ebitda:150,prior_operating_income:120,variable_costs:300,organic_growth:0.15,
};
const facts=concepts.map((concept,i)=>({concept,normalizedValue:special[concept]??(10+i),rawValue:String(special[concept]??(10+i)),unit:concept.includes('rate')?'decimal':'INR million',currency:'INR',scale:'million',fiscalYear:'2028',id:`kpi-${concept}`,documentId:'golden',evidenceText:`${concept}  value` ,systemVerified:true,validated:true,confidence:1}));
// Canonical alias should be tax_expense; the legacy taxes value is also present to ensure compatibility does not mask the canonical fix.
const results=buildRatioLibrary(facts);
const missing=results.filter(x=>x.value==null || !Number.isFinite(Number(x.value)));
const bad=results.filter(x=>x.status!=='computed');
const ebitda=results.find(x=>x.id==='ebitda-derived');
console.log(JSON.stringify({total:results.length,computed:results.filter(x=>x.status==='computed').length,missing:missing.map(x=>x.id),nonComputed:bad.map(x=>x.id),ebitdaDerived:ebitda?.value},null,2));
if(results.length!==84 || missing.length){process.exit(2);}
