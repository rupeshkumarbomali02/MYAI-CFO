import assert from 'node:assert/strict';
const cases=[
 {name:'inventory cannot exceed current assets',facts:{current_assets:100,inventory:120},invalid:true},
 {name:'negative revenue flagged',facts:{revenue:-1},invalid:true},
 {name:'valid base case',facts:{assets:500,liabilities:300,equity:200,current_assets:200,inventory:50,cash:50,revenue:100,cogs:60,capex:10},invalid:false},
];
for(const c of cases){const f=c.facts;const failures=[]; if(f.current_assets!=null&&f.inventory!=null&&f.current_assets<f.inventory)failures.push('CURRENT_ASSETS_GE_INVENTORY'); if(f.assets!=null&&f.liabilities!=null&&f.assets<f.liabilities)failures.push('ASSETS_GE_LIABILITIES'); if(f.revenue!=null&&f.revenue<0)failures.push('REVENUE_NONNEGATIVE'); if(f.cogs!=null&&f.cogs<0)failures.push('COGS_NONNEGATIVE'); if(f.capex!=null&&f.capex<0)failures.push('CAPEX_NONNEGATIVE'); assert.equal(failures.length>0,c.invalid,c.name);} console.log('financial-consistency: PASS');
