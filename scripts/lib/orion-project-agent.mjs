// Durable controller foundation. Worker/reviewer adapters are host-owned. No
// model, shell, git, deployment or external-review transport is enabled here.
import { mkdir, open, readFile, rename, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const idPattern = /^[a-z0-9][a-z0-9-]{1,63}$/;
const clone = value => structuredClone(value);
const stamp = () => new Date().toISOString();
function validateTasks(tasks) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 1000) throw new Error('invalid tasks');
  const ids = new Set();
  for (const task of tasks) {
    if (!idPattern.test(task.id) || ids.has(task.id) || typeof task.title !== 'string' || !task.title.trim() ||
        typeof task.objective !== 'string' || !task.objective.trim() ||
        !Number.isInteger(task.weight) || task.weight < 1 || task.weight > 100 ||
        !Array.isArray(task.dependencies) || !Array.isArray(task.acceptance) || !task.acceptance.length ||
        !task.acceptance.every(item => typeof item === 'string' && item.trim())) throw new Error('invalid task contract');
    ids.add(task.id);
  }
  const visited = new Set(), visiting = new Set();
  const byID = new Map(tasks.map(task => [task.id, task]));
  function visit(id) {
    if (!ids.has(id) || visiting.has(id)) throw new Error('missing dependency or cycle');
    if (visited.has(id)) return;
    visiting.add(id); for (const dependency of byID.get(id).dependencies) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
}
function event(state, kind, message) {
  state.events.push({ at: stamp(), kind, message: message.slice(0, 500) });
  // Snapshot is bounded; durable task/review evidence is retained separately in state.
  state.events = state.events.slice(-200);
}
async function publish(root, state, initial = false) {
  const target = join(root, 'state.json'), temporary = join(root, `${randomUUID()}.tmp`);
  const handle = await open(initial ? target : temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(state) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  if (!initial) await rename(temporary, target);
  const dir = await open(root, 'r'); try { await dir.sync(); } finally { await dir.close(); }
}
export async function readProjectAgent(root) {
  const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.tasks) ||
      !Array.isArray(state.events) || !Array.isArray(state.steering) || !Array.isArray(state.reviews) ||
      typeof state.runId !== 'string' || !state.runId || typeof state.finalReview !== 'boolean' ||
      typeof state.pauseRequested !== 'boolean' || !Number.isInteger(state.maxAttempts) || state.maxAttempts < 1 || state.maxAttempts > 3 ||
      !['ready', 'running', 'paused', 'waiting_for_review', 'interrupted', 'budget_exhausted', 'completed'].includes(state.status)) throw new Error('invalid controller state');
  validateTasks(state.tasks);
  for (const task of state.tasks) {
    if (!['queued', 'running', 'awaiting_review', 'accepted', 'blocked'].includes(task.status) ||
        !['queued', 'inspect', 'implement', 'test', 'review', 'accepted'].includes(task.stage) ||
        !Number.isInteger(task.attempts) || task.attempts < 0 || task.attempts > state.maxAttempts ||
        (task.status !== 'queued' && task.attempts < 1) ||
        (['awaiting_review', 'accepted'].includes(task.status) ? !sha(task.commit) : task.commit !== null) ||
        (task.status === 'accepted' && task.stage !== 'accepted') ||
        (task.status === 'awaiting_review' && task.stage !== 'review') ||
        (task.blocker !== null && typeof task.blocker !== 'string')) throw new Error('invalid task lifecycle');
  }
  const running = state.tasks.filter(task => task.status === 'running');
  if (running.length > 1 || (running.length === 1 ? state.activeTask !== running[0].id || state.status !== 'running' : state.activeTask !== null) ||
      (state.status === 'running' && running.length !== 1) ||
      (state.finalReview ? state.status !== 'completed' || !state.tasks.every(task => task.status === 'accepted') : state.status === 'completed')) throw new Error('inconsistent controller lifecycle');
  for (const item of state.steering) if (typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.applied !== 'boolean') throw new Error('invalid steering state');
  for (const item of state.events) if (typeof item.kind !== 'string' || typeof item.message !== 'string' || !Number.isFinite(Date.parse(item.at))) throw new Error('invalid event');
  for (const item of state.reviews) if (!state.tasks.some(task => task.id === item.taskId) || !sha(item.commit) ||
      !['accept', 'changes_requested'].includes(item.decision) || !Number.isSafeInteger(item.revision) || item.revision < 0 || item.revision >= state.revision) throw new Error('invalid review');
  return state;
}
async function transaction(root, expected, update) {
  const lock = join(root, 'state.lock'); await mkdir(lock, { mode: 0o700 });
  try {
    const state = await readProjectAgent(root);
    if (expected !== undefined && state.revision !== expected) throw new Error('state revision changed; refresh first');
    await update(state); state.revision++; await publish(root, state); return state;
  } finally { await rmdir(lock); }
}
export async function initializeProjectAgent(root, tasks, { maxAttempts = 2 } = {}) {
  validateTasks(tasks);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new Error('invalid attempts');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const state = { version: 1, revision: 0, runId: randomUUID(), status: 'ready', activeTask: null,
    pauseRequested: false, maxAttempts, finalReview: false, steering: [], reviews: [], events: [],
    tasks: tasks.map(task => ({ ...clone(task), status: 'queued', stage: 'queued', attempts: 0, commit: null, blocker: null })) };
  event(state, 'initialized', 'Approved task graph loaded; execution adapters are not enabled by initialization.');
  await publish(root, state, true); return state;
}
export async function steerProjectAgent(root, command, revision, text) {
  if (!Number.isSafeInteger(revision)) throw new Error('revision required');
  return transaction(root, revision, state => {
    if (state.status === 'completed') throw new Error('run completed');
    if (command === 'pause') {
      state.pauseRequested = true;
      if (!state.activeTask) state.status = 'paused';
      event(state, 'pause', state.activeTask ? 'Pause requested; waiting for task boundary.' : 'Paused.');
    } else if (command === 'resume') {
      if (state.activeTask || state.status === 'interrupted') throw new Error('reconcile interrupted work before resuming');
      state.pauseRequested = false;
      state.status = state.tasks.some(t => t.status === 'awaiting_review') ? 'waiting_for_review' : 'ready';
      event(state, 'resume', 'Resume requested; review gates remain enforced.');
    } else if (command === 'steer') {
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('invalid steering');
      state.steering.push({ id: randomUUID(), text, applied: false });
      event(state, 'steering_received', 'Instruction queued for the next task boundary.');
    } else throw new Error('unknown control');
  });
}
// Only the trusted senior-review adapter may call this; no worker receives it.
export async function reviewProjectTask(root, { revision, taskId, commit, decision }) {
  return transaction(root, revision, state => {
    if (!Number.isSafeInteger(revision)) throw new Error('review revision required');
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || task.status !== 'awaiting_review' || task.commit !== commit || !commit ||
        !['accept', 'changes_requested'].includes(decision)) throw new Error('stale or invalid review');
    task.status = decision === 'accept' ? 'accepted' : task.attempts < state.maxAttempts ? 'queued' : 'blocked';
    task.stage = decision === 'accept' ? 'accepted' : 'queued';
    if (decision !== 'accept') task.commit = null;
    task.blocker = task.status === 'blocked' ? 'repair_budget_exhausted' : null;
    state.reviews.push({ taskId, commit, decision, revision, at: stamp() });
    state.status = state.pauseRequested ? 'paused' : 'ready';
    event(state, 'review', `${taskId}: ${decision}`);
  });
}
export async function acceptProjectFinalReview(root, revision) {
  return transaction(root, revision, state => {
    if (!Number.isSafeInteger(revision) || state.activeTask || !state.tasks.every(t => t.status === 'accepted')) throw new Error('final review not ready');
    if (state.steering.some(item => !item.applied)) throw new Error('pending steering requires review before completion');
    state.finalReview = true; state.status = 'completed'; event(state, 'final_review', 'Combined implementation accepted by senior review.');
  });
}
export function projectAgentProgress(state) {
  const total = state.tasks.reduce((sum, task) => sum + task.weight, 0);
  const accepted = state.tasks.filter(task => task.status === 'accepted').reduce((sum, task) => sum + task.weight, 0);
  return { acceptedTasks: state.tasks.filter(task => task.status === 'accepted').length,
    totalTasks: state.tasks.length, percent: state.finalReview ? 100 : Math.min(99, Math.floor(100 * accepted / total)) };
}
export async function runProjectAgent(root, { worker, verify, durationMs, taskTimeoutMs = 60000 } = {}) {
  if (typeof worker !== 'function' || typeof verify !== 'function' || !Number.isSafeInteger(durationMs) || durationMs < 1 ||
      durationMs > 12 * 3600000 || !Number.isSafeInteger(taskTimeoutMs) || taskTimeoutMs < 1) throw new Error('bounded host adapters required');
  const lease = join(root, 'worker.lock'); await mkdir(lease, { mode: 0o700 });
  let uncertain = false;
  const started = performance.now();
  try {
    while (performance.now() - started < durationMs) {
      let task, instructions;
      const claimed = await transaction(root, undefined, state => {
        if (state.activeTask) { state.status = 'interrupted'; throw new Error('unfinished operation needs reconciliation'); }
        if (state.status === 'completed' || state.status === 'interrupted') return;
        if (state.pauseRequested) { state.status = 'paused'; return; }
        if (state.tasks.some(t => t.status === 'awaiting_review') || state.tasks.every(t => t.status === 'accepted')) {
          state.status = 'waiting_for_review'; return;
        }
        const accepted = new Set(state.tasks.filter(t => t.status === 'accepted').map(t => t.id));
        task = state.tasks.find(t => t.status === 'queued' && t.attempts < state.maxAttempts && t.dependencies.every(id => accepted.has(id)));
        if (!task) { state.status = 'waiting_for_review'; return; }
        instructions = state.steering.filter(item => !item.applied).map(item => ({ ...item }));
        for (const item of state.steering) item.applied = true;
        task.status = 'running'; task.stage = 'inspect'; task.attempts++;
        state.status = 'running'; state.activeTask = task.id; event(state, 'task_started', task.title);
        task = clone(task);
      });
      if (!task) return claimed;
      const controller = new AbortController(); let timer;
      const timeout = Math.max(1, Math.min(taskTimeoutMs, durationMs - (performance.now() - started)));
      let result;
      try {
        result = await Promise.race([
          (async () => {
            const candidate = await worker(clone(task), { signal: controller.signal, instructions: clone(instructions) });
            if (controller.signal.aborted) throw new Error('cancelled worker');
            if (!candidate || !/^[a-f0-9]{40}$/.test(candidate.commit) || await verify(clone(task), clone(candidate), controller.signal) !== true) throw new Error('acceptance not verified');
            return candidate;
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => { uncertain = true; controller.abort(); reject(new Error('timeout')); }, timeout); }),
        ]);
      } catch {
        await transaction(root, undefined, state => {
          const current = state.tasks.find(t => t.id === task.id);
          current.status = 'blocked'; current.blocker = uncertain ? 'worker_outcome_unknown' : 'worker_or_validation_failed';
          state.activeTask = null; state.status = uncertain ? 'interrupted' : state.pauseRequested ? 'paused' : 'waiting_for_review';
          event(state, 'blocked', `${task.id}: ${current.blocker}`);
        });
        return await readProjectAgent(root);
      } finally { clearTimeout(timer); }
      await transaction(root, undefined, state => {
        const current = state.tasks.find(t => t.id === task.id);
        current.commit = result.commit; current.status = 'awaiting_review'; current.stage = 'review';
        state.activeTask = null; state.status = state.pauseRequested ? 'paused' : 'waiting_for_review';
        event(state, 'review_requested', `${task.id}: verified checkpoint awaits independent review.`);
      });
      // Initial policy is one task per senior review. A future connected reviewer
      // can accept and wake the controller; the worker cannot self-approve.
      return await readProjectAgent(root);
    }
    return await transaction(root, undefined, state => { state.status = 'budget_exhausted'; });
  } finally {
    // Unknown worker lifetime retains the lease. Never start a second writer
    // merely because a timeout was observed. Reconciliation is a later host gate.
    if (!uncertain) await rmdir(lease);
  }
}
