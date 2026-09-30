import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerProject, readProject, listProjects, projectRoot } from '../scripts/lib/agentic/projects.mjs';
import { initializeProjectAgent, readProjectAgent } from '../scripts/lib/orion-project-agent.mjs';
import { acquireLease } from '../scripts/lib/agentic/lease.mjs';
const exec = promisify(execFile);
const task = { id:'project-task',title:'Project task',objective:'Do one thing',weight:1,scope:['tests/workspace/example.mjs'],checks:['node-syntax'],acceptance:['It works'] };
async function fixture(t) {
  const home=await realpath(await mkdtemp(join(tmpdir(),'orion-project-library-')));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const base=join(home,'.openclaw/orion-controlled/project-agent');
  const file=join(home,'plan.json');await writeFile(file,JSON.stringify({project:'Example',tasks:[task]}));
  return {home,base,file};
}
test('registration snapshots the plan and never creates or enables a run; duplicate id preserves it',async t=>{
  const {home,base,file}=await fixture(t);
  const a=await registerProject(file,{id:'project-one',home:base});
  await writeFile(file,'changed');
  assert.equal(JSON.parse(await readFile(a.planPath,'utf8')).project,'Example');
  await assert.rejects(readFile(join(a.root,'state.json')), {code:'ENOENT'});
  await assert.rejects(registerProject(a.planPath,{id:'project-one',home:base}),{code:'EEXIST'});
  assert.deepEqual((await listProjects(base)).projects.map(p=>p.id),['project-one']);
});
test('actual operator CLI stops only the explicitly selected project',async t=>{
  const {home,base,file}=await fixture(t);
  const a=await registerProject(file,{id:'project-one',home:base});
  const b=await registerProject(file,{id:'project-two',home:base});
  const sa=await initializeProjectAgent(a.root,[task]);
  await initializeProjectAgent(b.root,[task]);
  await exec(process.execPath,['scripts/orion-project-agent','stop','--revision',String(sa.revision),'--project',a.id],{env:{...process.env,HOME:home}});
  assert.equal((await readProjectAgent(a.root)).stopRequested,true);
  assert.equal((await readProjectAgent(b.root)).stopRequested,false);
  await assert.rejects(exec(process.execPath,['scripts/orion-project-agent','resume','--revision',String(sa.revision),'--project',a.id],{env:{...process.env,HOME:home}}));
});
test('unknown/traversing project ids and symlink project directories refuse',async t=>{
  const {base,file}=await fixture(t);
  assert.throws(()=>projectRoot('../outside',base));
  await assert.rejects(readProject('missing-project',base));
  const a=await registerProject(file,{id:'project-one',home:base});
  await symlink(a.root,join(base,'projects','project-alias'));
  await assert.rejects(readProject('project-alias',base),/symlink/);
  assert.equal((await listProjects(base)).errors.length,1);
});
test('launch refuses a live writer without enabling execution or initializing state',async t=>{
  const {home,base,file}=await fixture(t);
  const a=await registerProject(file,{id:'project-one',home:base});
  await acquireLease(join(base,'active-project.lock'));
  const error=await exec(process.execPath,['scripts/orion-projects','launch',a.id,'1','--enable'],{env:{...process.env,HOME:home}}).catch(e=>e);
  assert.equal(error.code,1);assert.match(error.stderr,/running|uncertain/);
  await assert.rejects(readFile(join(home,'.openclaw/orion-controlled/agentic-config.json')),{code:'ENOENT'});
  await assert.rejects(readFile(join(a.root,'state.json')),{code:'ENOENT'});
});

test('continuation reconciles an interrupted dead worker before clearing stop without requeueing unknown work',async t=>{
  const {prepareProjectContinuation}=await import('../scripts/lib/agentic/projects.mjs');
  const {mutateProjectAgent}=await import('../scripts/lib/orion-project-agent.mjs');
  const {ownerRecord}=await import('../scripts/lib/agentic/lease.mjs');
  const {base,file}=await fixture(t);
  const p=await registerProject(file,{id:'project-one',home:base});
  const state=await initializeProjectAgent(p.root,[task]);
  const worktree=join(p.root,'worktree');await mkdir(worktree);
  await exec('/usr/bin/git',['init','-q',worktree]);
  await exec('/usr/bin/git',['-C',worktree,'-c','user.name=T','-c','user.email=t@t','commit','--allow-empty','-qm','base']);
  await writeFile(join(p.root,'run.json'),JSON.stringify({runId:state.runId,worktree}));
  await mutateProjectAgent(p.root,state.revision,s=>{
    s.status='interrupted';s.stopRequested=true;s.exterminateRequested=true;
    s.tasks[0].status='blocked';s.tasks[0].attempts=1;s.tasks[0].blocker='worker_outcome_unknown';
  });
  await mkdir(join(p.root,'worker.lock'));
  await writeFile(join(p.root,'worker.lock','owner.json'),JSON.stringify({...ownerRecord(),pid:2147483647}));
  const result=await prepareProjectContinuation(p,{launchRevision:1});
  assert.equal(result.shouldStart,true);assert.notEqual(result.state.status,'interrupted');assert.equal(result.state.stopRequested,false);
  assert.equal(result.state.tasks[0].status,'blocked');assert.equal(result.state.tasks[0].blocker,'worker_outcome_unknown');
});

test('a halt that arrives after launch wins over continuation preparation',async t=>{
  const {prepareProjectContinuation}=await import('../scripts/lib/agentic/projects.mjs');
  const {home,base,file}=await fixture(t);
  const p=await registerProject(file,{id:'project-one',home:base});
  const before=await initializeProjectAgent(p.root,[task]);
  await exec(process.execPath,['scripts/orion-project-agent','--project',p.id,'stop'],{env:{...process.env,HOME:home}});
  const result=await prepareProjectContinuation(p,{launchRevision:before.revision});
  assert.equal(result.shouldStart,false);
  assert.equal(result.state.stopRequested,true);
});

test('two concurrent starts cannot both reclaim the same dead fleet owner',async t=>{
  const {ownerRecord,releaseLease}=await import('../scripts/lib/agentic/lease.mjs');
  const {base}=await fixture(t);await mkdir(base,{recursive:true});
  const lock=join(base,'active-project.lock');await mkdir(lock);
  await writeFile(join(lock,'owner.json'),JSON.stringify({...ownerRecord(),pid:2147483647}));
  const results=await Promise.allSettled([acquireLease(lock),acquireLease(lock)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  await releaseLease(lock);
});
