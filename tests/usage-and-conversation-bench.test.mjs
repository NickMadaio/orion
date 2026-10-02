import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUsage } from '../scripts/lib/usage/report.mjs';
import { grade, shuffled } from '../scripts/lib/conversation-bench/core.mjs';
const entry = (timestamp, provider='anthropic', model='claude-haiku-4-5-20251001',cost=0) => ({timestamp,message:{provider,model,usage:{input:100,output:20,cacheRead:1000,cacheWrite:40,cost:{total:cost}}}});
test('usage deduplicates archived copies; keeps token and billing coverage distinct',()=>{
 const e=entry('2026-10-01T23:30:00Z');
 const r=summarizeUsage([{entry:e,session:'eval'},{entry:e},{entry:entry('2026-10-02T08:00:00Z','ollama','llama3.2:3b')}],{now:Date.parse('2026-10-02T12:00:00Z'),days:1});
 assert.equal(r.totals.calls,2);assert.equal(r.duplicates,1);assert.equal(r.totals.unpricedCloudCalls,1);assert.equal(r.totals.totalTokens,2320);assert.equal(r.byLane.evaluation.calls,1);assert.ok(Math.abs(r.totals.currentRateEquivalent-.00035)<1e-10);
});
test('civil day windows honor London DST, reject future/bad times, retain actual costs',()=>{
 const r=summarizeUsage(['2026-10-24T23:30:00Z','2026-10-25T23:30:00Z','2026-10-26T00:00:00Z','broken'].map(t=>({entry:entry(t,'anthropic','unknown',.25)})),{now:Date.parse('2026-10-25T23:45:00Z'),days:1});
 assert.equal(r.totals.calls,2);assert.equal(r.totals.recordedCost,.5);assert.equal(r.skipped,2);assert.equal(r.totals.unknownRateCalls,2);
});
test('benchmark catches bad routes, facts, format and invalid JSON; human review stays explicit',()=>{
 assert.equal(grade({route:'answer',contains:['21.25']},'{"route":"answer","answer":"£21.25"}').pass,true);
 assert.equal(grade({route:'escalate'},'{"route":"answer","answer":"Done"}').pass,false);
 assert.equal(grade({route:'answer',exact:'abc'},'{"route":"answer","answer":"ABC"}').pass,false);
 assert.equal(grade({route:'answer'},'not json').pass,false);
 assert.equal(grade({route:'answer'},'null').pass,false);
 assert.equal(grade({route:'answer',humanRubric:'natural'},'{"route":"answer","answer":"Hi"}').humanReview,true);
 assert.deepEqual(shuffled([1,2,3,4],42),shuffled([1,2,3,4],42));
});
