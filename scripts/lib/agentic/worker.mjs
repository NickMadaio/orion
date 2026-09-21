/*
 The worker adapter: the ~27B model's agentic loop for one task.

 It is a LOOP, not a conversation. Each turn is assembled from durable facts —
 the contract, the working set, the last check results — and the model's reply
 is parsed into actions the runtime performs. Nothing carries over except what
 the runtime chose to carry, which is what keeps a ten-hour run from becoming a
 ten-hour prompt.

 WHAT THE WORKER CANNOT DO, BY CONSTRUCTION

   * write outside the task's approved scope        boundary.mjs refuses first
   * run a command                                   only registered checks run,
                                                     by name, with fixed argv
   * decide its work passed                          `### DONE` is rejected unless
                                                     the checks actually ran and
                                                     passed in this session
   * accept its own work                             no review function exists here
   * loop forever                                    turn budget + repetition
                                                     detection + wall clock

 The last one matters more than it looks. The common unattended failure is not a
 model doing something dramatic; it is a model doing the same harmless thing
 four hundred times while the night goes by.
*/
import { createHash } from 'node:crypto';
import { runChecks, describeChecks, CHECK_REGISTRY } from './checks.mjs';
import { parseWorkerReply, systemPrompt, workerTurn } from './prompts.mjs';
import { changedFiles, commitCheckpoint, currentHead, readScoped, searchRepo, snapshotBaseline, writeScoped } from './workspace.mjs';

const MAX_TURNS = 14;
const MAX_WORKING_SET = 8;
const MAX_FILE_CHARS = 90_000;

export class WorkerBlocked extends Error {
  constructor(reason, detail) {
    super(reason);
    this.name = 'WorkerBlocked';
    this.detail = detail;
  }
}

const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 16);

/** Files already in scope that exist — the worker starts by seeing its own task. */
async function initialWorkingSet(worktree, contract) {
  const files = [];
  for (const entry of contract.scope) {
    if (entry.endsWith('/') || files.length >= MAX_WORKING_SET) continue;
    try { files.push({ path: entry, contents: await readScoped(worktree, entry, { maxBytes: MAX_FILE_CHARS }) }); }
    catch { /* a scope entry naming a file to CREATE does not exist yet; that is normal */ }
  }
  return files;
}

/**
 * Build the worker adapter the controller calls. `emit` receives structured
 * progress for the journal and the UI; it is never given raw reasoning traces.
 */
export function createWorker({ runtime, worktree, emit = () => {}, maxTurns = MAX_TURNS, maxAttempts = 3 }) {
  return async function worker(task, { signal, instructions = [] } = {}) {
    const system = await systemPrompt('worker-system');
    const checkDescriptions = describeChecks(task.checks);
    const workingSet = await initialWorkingSet(worktree, task);
    const written = new Set();
    const baseline = await snapshotBaseline(worktree, task.scope.filter(entry => !entry.endsWith('/')));

    let checkResults = [];
    let checksFresh = false;
    let notice = null;
    let summary = '';
    const seen = new Map();

    for (let turn = 1; turn <= maxTurns; turn++) {
      if (signal?.aborted) throw new WorkerBlocked('cancelled', { turn });

      const prompt = workerTurn({
        contract: task, files: workingSet, checkResults, instructions, notice, checkDescriptions,
        turn, maxTurns,
        // The real attempt budget, from durable state — not the turn counter.
        attempt: task.attempts, maxAttempts,
      });
      notice = null;

      const response = await runtime.generate('worker', { system, prompt, signal });
      const actions = parseWorkerReply(response.text);
      emit({ kind: 'worker_turn', taskId: task.id, data: {
        turn, ms: response.ms, model: response.model,
        actions: actions.map(action => action.kind),
        doneReason: response.meta.doneReason, thinkingChars: response.meta.thinkingChars,
      } });

      if (!actions.length) {
        // Three different causes need three different fixes, and "no usable
        // reply" names none of them. Say which one this was.
        notice = response.meta.doneReason === 'length'
          ? 'Your previous reply hit the output limit before producing a marker. Put reasoning BEFORE the markers and keep it short.'
          : 'Your previous reply contained no recognised marker. Reply using ### READ, ### SEARCH, ### FILE, ### CHECK, ### DONE or ### BLOCKED.';
        emit({ kind: 'worker_unusable_reply', taskId: task.id, data: { turn, chars: response.text.length, doneReason: response.meta.doneReason } });
        continue;
      }

      // Repetition detection. A model that produces byte-identical intent three
      // turns running has stopped making progress, whatever it says.
      const fingerprint = digest(actions.map(action => `${action.kind}:${action.path ?? action.target ?? ''}:${digest(action.contents ?? '')}`).join('|'));
      seen.set(fingerprint, (seen.get(fingerprint) ?? 0) + 1);
      if (seen.get(fingerprint) >= 3) {
        throw new WorkerBlocked('worker repeated the same action three times without progress', { turn, fingerprint });
      }

      const blocked = actions.find(action => action.kind === 'BLOCKED');
      if (blocked) throw new WorkerBlocked(blocked.text.slice(0, 500) || 'worker reported it is blocked', { turn, proposals: actions.filter(a => a.kind === 'PROPOSE').map(a => a.text) });
      for (const proposal of actions.filter(action => action.kind === 'PROPOSE')) {
        // A proposal changes nothing by itself. It is recorded for review, and
        // the worker keeps working to the contract as written.
        emit({ kind: 'contract_change_proposed', taskId: task.id, data: { turn, proposal: proposal.text } });
      }

      for (const malformed of actions.filter(action => action.kind === 'MALFORMED')) {
        notice = `${notice ? `${notice}\n` : ''}${malformed.detail}. Return the COMPLETE file in one fenced block after the marker.`;
      }

      for (const action of actions.filter(action => action.kind === 'READ')) {
        if (workingSet.some(file => file.path === action.target)) continue;
        try {
          const contents = await readScoped(worktree, action.target, { maxBytes: MAX_FILE_CHARS });
          workingSet.push({ path: action.target, contents });
          if (workingSet.length > MAX_WORKING_SET) workingSet.splice(0, workingSet.length - MAX_WORKING_SET);
        } catch (error) {
          notice = `${notice ? `${notice}\n` : ''}Could not read ${action.target}: ${error.message}. Use ### SEARCH to find the real path.`;
        }
      }

      for (const action of actions.filter(action => action.kind === 'SEARCH')) {
        const matches = await searchRepo(worktree, action.target);
        notice = `${notice ? `${notice}\n` : ''}SEARCH "${action.target}":\n${matches.length ? matches.join('\n') : '(no matches)'}`;
      }

      const writes = actions.filter(action => action.kind === 'FILE');
      for (const write of writes) {
        try {
          const path = await writeScoped(worktree, task, write.path, write.contents);
          written.add(path);
          checksFresh = false;
          const existing = workingSet.find(file => file.path === path);
          if (existing) existing.contents = write.contents.slice(0, MAX_FILE_CHARS);
          else workingSet.push({ path, contents: write.contents.slice(0, MAX_FILE_CHARS) });
          emit({ kind: 'worker_write', taskId: task.id, data: { turn, path, chars: write.contents.length } });
        } catch (error) {
          // A refusal names the file AND the reason. "Denied" alone is the
          // message that produced retry loops elsewhere in this system.
          notice = `${notice ? `${notice}\n` : ''}REFUSED ${write.path}: ${error.message}`;
          emit({ kind: 'worker_write_refused', taskId: task.id, data: { turn, path: write.path, reason: error.message, layer: error.layer ?? null } });
        }
      }

      const wantsCheck = actions.some(action => action.kind === 'CHECK');
      const wantsDone = actions.some(action => action.kind === 'DONE');
      if (wantsCheck || (wantsDone && !checksFresh)) {
        if (!written.size) {
          notice = `${notice ? `${notice}\n` : ''}No file has been written yet, so there is nothing to check.`;
        } else {
          const dirty = (await changedFiles(worktree)).map(file => file.path);
          checkResults = await runChecks(task.checks, { worktree, changedFiles: dirty, baseline, signal });
          checksFresh = true;
          emit({ kind: 'checks_run', taskId: task.id, data: { turn,
            results: checkResults.map(result => ({ name: result.name, ok: result.ok, ms: result.ms, unusable: Boolean(result.unusable) })) } });
          const unusable = checkResults.find(result => result.unusable);
          if (unusable) {
            // The environment is broken, not the code. Handing 127 back as if it
            // were a compiler error asks the model to fix what it did not break.
            throw new WorkerBlocked(`the check "${unusable.name}" could not run on this machine`, { output: unusable.output.slice(0, 1000) });
          }
        }
      }

      if (wantsDone) {
        summary = actions.find(action => action.kind === 'DONE').text.slice(0, 2000);
        const failing = checkResults.filter(result => !result.ok);
        if (!written.size) throw new WorkerBlocked('worker reported done without writing anything', { turn });
        if (!checksFresh) { notice = 'Run ### CHECK before ### DONE; the checks have not run since your last edit.'; continue; }
        if (failing.length) {
          notice = `You reported done, but ${failing.map(result => result.name).join(', ')} still ${failing.length === 1 ? 'fails' : 'fail'}. Fix the failure or report ### BLOCKED honestly.`;
          continue;
        }
        const paths = [...written];
        const result = await commitCheckpoint(worktree, {
          paths,
          message: `agent(${task.id}): ${task.title}\n\n${summary.slice(0, 1500)}\n\nTask: ${task.id} (rev ${task.rev}, ${task.origin})\nChecks: ${task.checks.join(', ')}`,
        });
        if (!result.committed) {
          // The legacy coder ignored these exit codes and logged success anyway.
          throw new WorkerBlocked(`checkpoint was not created: ${result.reason}`, { paths });
        }
        emit({ kind: 'checkpoint', taskId: task.id, data: { commit: result.commit, files: result.files } });
        return { commit: result.commit, files: result.files, summary,
          checks: checkResults.map(item => ({ name: item.name, ok: item.ok, ms: item.ms, exitCode: item.exitCode })) };
      }
    }
    throw new WorkerBlocked(`worker used all ${maxTurns} turns without reaching a verified checkpoint`, { written: [...written] });
  };
}

/**
 * The controller's `verify` adapter. Its only job is to refuse a checkpoint that
 * is not real: the commit must exist, be HEAD, and leave the tree clean.
 *
 * Kept separate from the worker on purpose. The controller calls this AFTER the
 * worker returns and after the cancellation check, so a worker that finishes
 * late can never reach it.
 */
export function createVerifier({ worktree }) {
  return async function verify(task, candidate) {
    if (!candidate?.commit) return false;
    const dirty = await changedFiles(worktree);
    if (dirty.length) return false;
    if (await currentHead(worktree) !== candidate.commit) return false;
    if (!Array.isArray(candidate.checks) || !candidate.checks.length) return false;
    if (!candidate.checks.every(check => check.ok && CHECK_REGISTRY[check.name])) return false;
    // Every check the contract named must appear in the evidence: passing a
    // subset and omitting the one that fails is the cheapest way to look green.
    return task.checks.every(name => candidate.checks.some(check => check.name === name && check.ok));
  };
}
