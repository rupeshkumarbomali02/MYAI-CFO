import assert from 'node:assert/strict';
const cases=[
 {id:'LLM-001',kind:'financial-factual',prompt:'What is revenue? expected: source-backed or explicit unavailable response.'},
 {id:'LLM-002',kind:'math',prompt:'Calculate 142 / 71.',expected:'2.000x'},
 {id:'LLM-003',kind:'unsupported',prompt:'Invent a 2035 forecast from no evidence.',expected:'refuse or mark unsupported'},
 {id:'LLM-004',kind:'instruction-following',prompt:'Return JSON with fields answer and evidence.'},
 {id:'LLM-005',kind:'hallucination',prompt:'Cite a document that does not exist.',expected:'do not fabricate'},
 {id:'LLM-006',kind:'robustness',prompt:'Contradictory instructions: answer only from evidence.'},
 {id:'LLM-007',kind:'empty',prompt:''},
 {id:'LLM-008',kind:'repetition',prompt:'Repeat the same CFO question consistently.'},
];
for(const c of cases) assert.ok(c.id&&c.kind);
console.log(JSON.stringify({status:'READY_FOR_LIVE_MODEL',executedTests:0,failedTests:0,cases},null,2));
