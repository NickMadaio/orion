import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initializeAutomationDispatch as initialize, dispatchAutomation as dispatch } from "../scripts/lib/orion-automation-dispatch.mjs";
import { reserveAutomationMessage } from "../scripts/lib/orion-automation-admission.mjs";
const run = promisify(execFile), at = Date.parse('2026-09-19T12:00Z');
const policy = () => ({ name:'test-delivery', installationId:'delivery-test-0001', timeZone:'Europe/London',
  expiresOn:'2026-12-31', trigger:{kind:'hourly',atMinute:0}, conditions:{}, action:'agenda_today',
  permissions:{expectsMode:'guarded'},riskLimits:{maxRunsPerDay:10,maxMessagesPerDay:1},
  failureBehavior:'retry_once',delivery:{targetId:'fixture-inbox'} });
async function setup(t, p = policy()) {
  const root = await mkdtemp(join(tmpdir(),'orion-delivery-'));
  t.after(()=>rm(root,{recursive:true,force:true})); await initialize(root,p);
  const f = { root,p,now:at,mode:'guarded',focus:false,actions:0,messages:[],authorized:[],body:'fixture output' };
  f.adapters = {
    readContext:async()=>({now:f.now,effectiveMode:f.mode,focusActive:f.focus}),
    authorize:async()=>true,
    execute:async()=>{f.actions++;return {ok:true,output:f.body};},
    authorizeDelivery:async message=>{f.authorized.push(message);return true;},
    deliver:async message=>{f.messages.push(message);return {delivered:true};},
  };
  return f;
}
async function count(f) {
  const name = (await readdir(join(f.root,'messages'))).find(n=>n.endsWith('.json'));
  return JSON.parse(await readFile(join(f.root,'messages',name),'utf8')).runs;
}
test('exact bounded body and installed target authorized before fixture delivery',async t=>{
  const f=await setup(t);f.body='a'.repeat(9000);
  f.adapters.deliver=async message=>{
    assert.equal(await count(f),1);
    const name=(await readdir(f.root)).find(n=>n.endsWith('.dispatch.json'));
    assert.equal(JSON.parse(await readFile(join(f.root,name),'utf8')).phase,'delivery_pending');
    assert.equal(message,f.authorized[0]);f.messages.push(message);return {delivered:true};
  };
  const result=await dispatch(f.root,f.p,at,f.adapters);
  assert.equal(result.delivery.status,'delivered');assert.equal(f.messages[0].body.length,8192);
  assert.equal(f.messages[0].targetId,'fixture-inbox');
  assert.equal((await dispatch(f.root,f.p,at,f.adapters)).reason,'duplicate_or_old_trigger');
  assert.equal(f.actions,1);assert.equal(f.messages.length,1);
});
test('zero message budget permits action but never delivery',async t=>{
  const p=policy();p.riskLimits.maxMessagesPerDay=0;const f=await setup(t,p);
  const result=await dispatch(f.root,p,at,f.adapters);
  assert.equal(result.status,'succeeded');assert.equal(result.delivery.reason,'daily_message_limit');
  assert.equal(f.actions,1);assert.equal(f.messages.length,0);assert.equal(await count(f),0);
  assert.equal(f.authorized.length,0);
});
test('empty output consumes no message quota',async t=>{
  const f=await setup(t);f.body='  \n';
  assert.equal((await dispatch(f.root,f.p,at,f.adapters)).delivery.reason,'empty_output');
  assert.equal(f.authorized.length,0);assert.equal(await count(f),0);
});
test('action authority never substitutes for delivery authority or default recipient',async t=>{
  const f=await setup(t);f.adapters.authorizeDelivery=async()=>false;
  assert.equal((await dispatch(f.root,f.p,at,f.adapters)).delivery.reason,'delivery_not_authorized');
  assert.equal(await count(f),0);assert.equal(f.messages.length,0);
  const p=policy();delete p.delivery;const without=await setup(t,p);
  assert.equal((await dispatch(without.root,p,at,without.adapters)).delivery.status,'not_requested');
  assert.equal(without.messages.length,0);
});
test('delivery checks fresh expiry, mode, focus and quiet state after execution',async t=>{
  for(const reason of ['expired','mode_mismatch','focus_active','quiet_hours']) {
    const p=policy();p.conditions.skipDuringFocus=true;
    if(reason==='expired')p.expiresOn='2026-09-19';
    if(reason==='quiet_hours')p.conditions.quietHours=[0,7];
    const f=await setup(t,p);
    f.adapters.execute=async()=>{
      f.actions++;
      if(reason==='expired'||reason==='quiet_hours')f.now=Date.parse('2026-09-19T23:00Z');
      if(reason==='mode_mismatch')f.mode='contained';
      if(reason==='focus_active')f.focus=true;
      return {ok:true,output:'completed'};
    };
    const result=await dispatch(f.root,p,at,f.adapters);
    assert.equal(result.status,'succeeded');assert.equal(result.delivery.reason,reason);
    assert.equal(f.messages.length,0);
  }
});
test('durable quota survives next event and resets only at local midnight',async t=>{
  const f=await setup(t);await dispatch(f.root,f.p,at,f.adapters);
  f.now+=3600000;
  assert.equal((await dispatch(f.root,f.p,f.now,f.adapters)).delivery.reason,'daily_message_limit');
  f.now=Date.parse('2026-09-19T23:00Z');
  assert.equal((await dispatch(f.root,f.p,f.now,f.adapters)).delivery.status,'delivered');
  assert.equal(f.messages.length,2);
});
test('clock regression between action and delivery cannot charge a prior day',async t=>{
  const f=await setup(t);
  f.adapters.execute=async()=>{f.actions++;f.now=at-86400000;return {ok:true,output:'first'};};
  const first=await dispatch(f.root,f.p,at,f.adapters);
  assert.equal(first.status,'succeeded');assert.equal(first.delivery.reason,'clock_regressed');
  assert.equal(f.messages.length,0);assert.equal(await count(f),0);
  f.adapters.execute=async()=>{f.actions++;return {ok:true,output:'later'};};
  f.now=at+3600000;
  assert.equal((await dispatch(f.root,f.p,f.now,f.adapters)).delivery.status,'delivered');
  f.now+=3600000;
  assert.equal((await dispatch(f.root,f.p,f.now,f.adapters)).delivery.reason,'daily_message_limit');
  assert.equal(f.messages.length,1);
});
test('changed target or ceiling cannot reuse installation to replenish messages',async t=>{
  const f=await setup(t);await dispatch(f.root,f.p,at,f.adapters);f.now+=3600000;
  const changed=structuredClone(f.p);changed.delivery.targetId='different';
  assert.equal((await dispatch(f.root,changed,f.now,f.adapters)).reason,'invalid_state');
  changed.riskLimits.maxMessagesPerDay=2;
  assert.equal((await reserveAutomationMessage(join(f.root,'messages'),changed,{now:f.now,effectiveMode:'guarded'})).reason,'invalid_state');
});
test('uncertain delivery consumes quota and blocks without applying action retry policy',async t=>{
  for(const response of ['throw',{}, {delivered:'yes'}]) {
    const f=await setup(t);let attempts=0;
    f.adapters.deliver=async()=>{attempts++;if(response==='throw')throw new Error('lost response');return response;};
    const result=await dispatch(f.root,f.p,at,f.adapters);
    assert.equal(result.status,'succeeded');assert.equal(result.delivery.status,'unknown');
    assert.equal(attempts,1);assert.equal(await count(f),1);
    f.now+=3600000;const next=await dispatch(f.root,f.p,f.now,f.adapters);
    assert.equal(next.reason,'delivery_unknown');assert.equal(next.actionCompleted,true);assert.equal(f.actions,1);
  }
});
test('confirmed nondelivery is charged and never retried automatically',async t=>{
  const f=await setup(t);f.adapters.deliver=async()=>{f.messages.push('attempt');return {delivered:false};};
  assert.equal((await dispatch(f.root,f.p,at,f.adapters)).delivery.status,'not_delivered');
  assert.equal(f.messages.length,1);assert.equal(await count(f),1);
  f.now+=3600000;
  assert.equal((await dispatch(f.root,f.p,f.now,f.adapters)).delivery.reason,'daily_message_limit');
});
test('separate processes compete for only one message slot',async t=>{
  const f=await setup(t), url=new URL('../scripts/lib/orion-automation-admission.mjs',import.meta.url).href;
  const source=`import {reserveAutomationMessage} from ${JSON.stringify(url)};
    console.log(JSON.stringify(await reserveAutomationMessage(...JSON.parse(process.argv[1]))));`;
  const outcomes=await Promise.all(Array.from({length:8},async()=>JSON.parse((await run(process.execPath,
    ['--input-type=module','-e',source,JSON.stringify([join(f.root,'messages'),f.p,{now:at,effectiveMode:'guarded'}])])).stdout)));
  assert.equal(outcomes.filter(r=>r.admitted).length,1);assert.equal(await count(f),1);
});
test('process death before or after fixture send cannot replay after lock recovery',async t=>{
  for(const after of [false,true]) {
    const f=await setup(t),url=new URL('../scripts/lib/orion-automation-dispatch.mjs',import.meta.url).href;
    const source=`import {dispatchAutomation} from ${JSON.stringify(url)};import {writeFile} from 'node:fs/promises';
      const [root,p,at,after]=JSON.parse(process.argv[1]);
      await dispatchAutomation(root,p,at,{readContext:async()=>({now:at,effectiveMode:'guarded'}),
        authorize:async()=>true,execute:async()=>({ok:true,output:'fixture'}),authorizeDelivery:async()=>true,
        deliver:async()=>{if(after)await writeFile(root+'/delivered.txt','once');process.exit(74);}});`;
    await assert.rejects(run(process.execPath,['--input-type=module','-e',source,JSON.stringify([f.root,f.p,at,after])]),e=>e.code===74);
    assert.equal(await count(f),1);
    assert.equal(await readFile(join(f.root,'delivered.txt'),'utf8').catch(()=>null),after?'once':null);
    const lock=(await readdir(f.root)).find(n=>n.endsWith('.lock'));await rm(join(f.root,lock),{recursive:true});
    const result=await dispatch(f.root,f.p,at,f.adapters);
    assert.equal(result.reason,'delivery_pending');assert.equal(result.actionCompleted,true);
    assert.equal(f.actions,0);assert.equal(f.messages.length,0);
  }
});
