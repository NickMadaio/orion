import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeProjectAgent as init, readProjectAgent as read, runProjectAgent as run,
  steerProjectAgent as steer, reviewProjectTask as review, acceptProjectFinalReview as finalReview,
  projectAgentProgress as progress } from '../scripts/lib/orion-project-agent.mjs';
const sha = 'a'.repeat(40);
// Contracts carry scope and checks from v2 on: scope IS the write gate and
// checks name registry entries, so a task without them is not a task.
const tasks = () => [
  { id: 'task-one', title: 'First task', objective: 'Implement a bounded fixture', weight: 2, dependencies: [],
    scope: ['tests/workspace/'], checks: ['node-syntax'], acceptance: ['Fixture passes'] },
  { id: 'task-two', title: 'Dependent task', objective: 'Integrate the reviewed fixture', weight: 1, dependencies: ['task-one'],
    scope: ['tests/workspace/'], checks: ['node-syntax'], acceptance: ['Integration passes'] },
];
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'orion-project-agent-'));
  // maxAttempts 2 explicitly: these tests assert behaviour AT the limit, and
  // the runtime default is 3. The limit under test should be visible here.
  t.after(() => rm(root, { recursive: true, force: true })); await init(root, tasks(), { maxAttempts: 2 }); return root;
}
const host = () => ({ durationMs: 10000, worker: async () => ({ commit: sha }), verify: async () => true });
test('invalid graph rejects missing dependency, cycle, duplicate id and empty acceptance', async t => {
  const root = await fixture(t);
  for (const mutate of [ts => ts[0].dependencies.push('absent'), ts => ts[0].dependencies.push('task-two'),
    ts => ts[1].id = ts[0].id, ts => ts[0].acceptance = []]) {
    const ts = tasks(); mutate(ts); await assert.rejects(init(join(root, 'invalid'), ts));
  }
});
test('verified implementation waits for review and dependencies cannot execute early', async t => {
  const root = await fixture(t); let count = 0;
  const adapter = host(); adapter.worker = async () => { count++; return { commit: sha }; };
  let state = await run(root, adapter);
  assert.equal(state.status, 'waiting_for_review'); assert.equal(state.tasks[0].status, 'awaiting_review');
  assert.equal(progress(state).percent, 0);
  await run(root, adapter); assert.equal(count, 1);
  state = await read(root); await review(root, { revision: state.revision, taskId: 'task-one', commit: sha, decision: 'accept' });
  state = await run(root, adapter); assert.equal(count, 2); assert.equal(state.tasks[1].status, 'awaiting_review');
  assert.equal(progress(state).percent, 66);
  state = await review(root, { revision: state.revision, taskId: 'task-two', commit: sha, decision: 'accept' });
  assert.equal(progress(state).percent, 99);
  state = await finalReview(root, state.revision); assert.equal(state.status, 'completed'); assert.equal(progress(state).percent, 100);
});
test('stale or wrong-commit reviews refuse without advancing', async t => {
  const root = await fixture(t); const state = await run(root, host());
  for (const change of [{ revision: state.revision - 1 }, { commit: 'b'.repeat(40) }, { decision: 'invented' }]) {
    await assert.rejects(review(root, { revision: state.revision, taskId: 'task-one', commit: sha, decision: 'accept', ...change }));
  }
  assert.equal((await read(root)).revision, state.revision);
  await assert.rejects(finalReview(root, state.revision));
});
test('final review cannot silently discard instructions received after the last task', async t => {
  const root = await fixture(t);
  for (const id of ['task-one', 'task-two']) {
    const state = await run(root, host());
    await review(root, { revision: state.revision, taskId: id, commit: sha, decision: 'accept' });
  }
  let state = await read(root);
  state = await steer(root, 'steer', state.revision, 'Review the changed interface again');
  await assert.rejects(finalReview(root, state.revision), /pending steering/);
  assert.equal((await read(root)).finalReview, false);
});
test('pause and steering are revisioned; instructions are delivered at next task boundary', async t => {
  const root = await fixture(t); let state = await read(root);
  state = await steer(root, 'pause', state.revision); assert.equal((await run(root, host())).status, 'paused');
  state = await read(root); state = await steer(root, 'steer', state.revision, 'Preserve the public interface');
  assert.equal(state.steering[0].applied, false);
  state = await steer(root, 'resume', state.revision);
  const adapter = host(); adapter.worker = async (_, { instructions }) => { assert.equal(instructions[0].text, 'Preserve the public interface'); return { commit: sha }; };
  state = await run(root, adapter); assert.equal(state.steering[0].applied, true);
  await assert.rejects(steer(root, 'pause', 0));
});
test('pause requested during task takes effect at boundary without discarding result', async t => {
  const root = await fixture(t); const adapter = host();
  adapter.worker = async () => { const state = await read(root); await steer(root, 'pause', state.revision); return { commit: sha }; };
  const state = await run(root, adapter); assert.equal(state.status, 'paused'); assert.equal(state.tasks[0].status, 'awaiting_review');
});
test('two controllers cannot claim the same task', async t => {
  const root = await fixture(t); let release, entered;
  const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
  const adapter = host(); adapter.worker = async () => { entered(); await gate; return { commit: sha }; };
  const first = run(root, adapter); await started;
  await assert.rejects(run(root, host())); release(); await first;
});
test('failed host acceptance or failed worker cannot manufacture a checkpoint', async t => {
  for (const worker of [async () => ({ commit: sha }), async () => { throw new Error('failed commit'); }]) {
    const root = await fixture(t), adapter = host(); adapter.worker = worker; adapter.verify = async () => false;
    const state = await run(root, adapter); assert.equal(state.tasks[0].status, 'blocked'); assert.equal(state.tasks[0].commit, null);
  }
});
test('a worker that never stops after a timeout is uncertain: lease retained, no second writer, no late publish', async t => {
  const root = await fixture(t); let finish, verified = 0;
  // It ignores its abort signal, so it is still "running" when the grace ends.
  const adapter = host(); adapter.taskTimeoutMs = 20; adapter.settleGraceMs = 30;
  adapter.worker = async () => new Promise(resolve => finish = resolve);
  adapter.verify = async () => { verified++; return true; };
  const state = await run(root, adapter); assert.equal(state.status, 'interrupted');
  await assert.rejects(run(root, host()), 'a second writer never starts beside a possibly-live first');
  // Resume clears requests but never reconciles: that still needs proof the
  // writer is dead, which only recovery can supply.
  const resumed = await steer(root, 'resume', state.revision);
  assert.equal(resumed.status, 'interrupted');
  await assert.rejects(run(root, host()));
  finish({ commit: sha }); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await read(root)).tasks[0].commit, null, 'the late result is never published');
  assert.equal(verified, 0);
});
test('a worker that stops after a timeout has a KNOWN outcome: handed on, lease released, nothing published', async t => {
  const root = await fixture(t); let verified = 0;
  const adapter = host(); adapter.taskTimeoutMs = 20; adapter.settleGraceMs = 2000;
  // Honours its abort signal, as the real worker does — so it settles.
  adapter.worker = (_task, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  adapter.verify = async () => { verified++; return true; };
  const state = await run(root, adapter);
  assert.notEqual(state.status, 'interrupted', 'a settled worker leaves nothing uncertain behind');
  assert.equal(state.tasks[0].status, 'blocked');
  assert.equal(state.tasks[0].blocker, 'worker_timeout', 'routed to the reviewer, not left to end the night');
  assert.equal(state.tasks[0].commit, null);
  assert.equal(verified, 0);
});
test('valid JSON with corrupt lifecycle fields refuses instead of inventing progress or budget', async t => {
  for (const mutate of [s => s.tasks[0].attempts = -1, s => s.finalReview = true, s => s.maxAttempts = 999,
    s => s.tasks[0].status = 'accepted', s => s.activeTask = 'task-one', s => s.status = 'completed',
    s => s.reviews = null, s => s.tasks[0].commit = 'invented']) {
    const root = await fixture(t), state = await read(root); mutate(state);
    await writeFile(join(root, 'state.json'), JSON.stringify(state));
    await assert.rejects(read(root)); await assert.rejects(run(root, host()));
  }
});
test('changes requested consumes bounded attempts and cannot become infinite repair', async t => {
  const root = await fixture(t);
  for (let i = 0; i < 2; i++) {
    const state = await run(root, host()); await review(root, { revision: state.revision, taskId: 'task-one', commit: sha, decision: 'changes_requested' });
  }
  const state = await run(root, host()); assert.equal(state.tasks[0].status, 'blocked'); assert.equal(state.tasks[0].attempts, 2);
});
test('initialization cannot overwrite a run; corrupt state never becomes a fresh run', async t => {
  const root = await fixture(t); const before = await readFile(join(root, 'state.json'), 'utf8');
  await assert.rejects(init(root, tasks())); assert.equal(await readFile(join(root, 'state.json'), 'utf8'), before);
  await writeFile(join(root, 'state.json'), '{broken'); await assert.rejects(run(root, host())); await assert.rejects(read(root));
});
