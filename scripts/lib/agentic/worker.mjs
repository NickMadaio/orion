import { cancellableGenerate } from './cancellation.mjs';
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
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePrecondition, scopeAllows } from './contract.mjs';
import { fitWorkingSet } from './context.mjs';
import { runChecks, describeChecks, CHECK_REGISTRY } from './checks.mjs';
import { parseWorkerReply, systemPrompt, workerTurn } from './prompts.mjs';
import { materializeEdits } from './edits.mjs';
import { decideExtension } from './extension.mjs';
import { changedFiles, commitAlreadySatisfied, commitCheckpoint, currentHead, readScoped, searchRepo, snapshotBaseline, writeScoped } from './workspace.mjs';
import { overwriteRisk, renderSurvey, surveyExistingWork } from './existing.mjs';

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

/**
 * Which of a contract's machine-checkable preconditions do NOT hold.
 *
 * Prose preconditions are not evaluated here; they reach the model as context
 * like any other field. Only the enforceable forms are verified, and only
 * against the worktree.
 */
async function unmetPreconditions(worktree, contract) {
  const present = async path => {
    try { await stat(join(worktree, path)); return true; } catch { return false; }
  };
  const unmet = [];
  for (const text of contract.preconditions ?? []) {
    const condition = parsePrecondition(text);
    if (!condition) continue;
    const exists = await present(condition.path);
    if (condition.kind === 'exists' && !exists) unmet.push(`${condition.path} does not exist`);
    if (condition.kind === 'absent' && exists) unmet.push(`${condition.path} exists and the contract requires it absent`);
  }
  return unmet;
}

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
export function createWorker({ runtime, worktree, emit = () => {}, maxTurns = MAX_TURNS, maxAttempts = 3,
  activity = null, onSubtask = null, stuckAfterTurns = 4,
  // Extensions: how much one grant may add, what the host grants when the
  // reviewer cannot answer, and the most exchanges an attempt may ever reach.
  extension = { maxGrantMs: 45 * 60_000, defaultGrantMs: 20 * 60_000, maxTurnsHard: 40 } }) {
  return async function worker(task, { signal, instructions = [], deadline = null } = {}) {
    // Preconditions are checked BEFORE the first turn, not discovered on the
    // third. An unmet one is not a coding failure and no number of retries will
    // make it true, so it blocks immediately with the reason named.
    const unmet = await unmetPreconditions(worktree, task);
    if (unmet.length) {
      emit({ kind: 'precondition_unmet', taskId: task.id, data: { unmet } });
      throw new WorkerBlocked(`the task's preconditions do not hold: ${unmet.join('; ')}`, { unmet, humanOnly: true });
    }

    const system = await systemPrompt('worker-system');
    const checkDescriptions = describeChecks(task.checks);
    const workingSet = await initialWorkingSet(worktree, task);
    // A successful reviewer repair is already a clean, durable checkpoint.
    // The worker still has to run the registered checks and the independent
    // review still has to accept it, but requiring a byte-for-byte rewrite
    // before CHECK made the repair continuation repeat until it blocked.
    const inheritedRepair = task.repairCheckpoint &&
      await currentHead(worktree) === task.repairCheckpoint.commit &&
      (await changedFiles(worktree)).length === 0
      ? task.repairCheckpoint
      : null;
    const written = new Set(inheritedRepair?.files ?? []);
    // Files kept from this task's previous attempt (supervisor carryover) are
    // this task's work: without this, CHECK answered "nothing written yet" and
    // three unanswered CHECKs tripped the repetition gate (live, 2026-09-25).
    for (const file of await changedFiles(worktree)) if (scopeAllows(task.scope, file.path)) written.add(file.path);
    const baseline = await snapshotBaseline(worktree, task.scope);
    // What is already there for this task, before it writes anything. Shown on
    // every exchange, and the basis for refusing writes that destroy it.
    const survey = await surveyExistingWork(worktree, task);
    const existingWork = survey.files.some(file => file.exists);
    emit({ kind: 'existing_work_surveyed', taskId: task.id, data: {
      files: survey.files.map(file => ({ path: file.path, exists: file.exists, lines: file.lines ?? 0,
        exports: file.exports?.length ?? 0, tests: file.tests ?? null })),
      promised: survey.promised } });
    const contractText = [task.objective, task.context, task.brief, ...(task.acceptance ?? []),
      ...(task.constraints ?? []), ...(task.nonScope ?? [])].filter(Boolean).join('\n');
    // The files this task writes stay in view; reference files make room first.
    const own = file => scopeAllows(task.scope, file.path) || written.has(file.path);
    const makeRoom = (keep = new Set()) => {
      while (workingSet.length > MAX_WORKING_SET) {
        const reference = workingSet.findIndex(file => !own(file) && !keep.has(file.path));
        const [removed] = workingSet.splice(reference === -1 ? 0 : reference, 1);
        emit({ kind: 'context_file_evicted', taskId: task.id, data: { path: removed.path, reason: 'working set full' } });
      }
    };

    let checkResults = [];
    let checksFresh = false;
    let notice = null;
    let summary = '';
    let checkpointReasons = [];
    let lastSubtask = null;
    const failures = new Map();

    /*
     The reviewer already authored and committed this candidate. Re-entering
     the worker model just to ask it to say CHECK made recovery spend minutes
     rereading the same files, and a model that never said DONE could still
     block the task. The host owns checks, so verify the exact repaired files
     immediately and send the clean checkpoint to the ordinary independent
     review gate. A failing repair still falls through to the worker with the
     real check output in context.
    */
    if (inheritedRepair) {
      checkResults = await runChecks(task.checks, {
        worktree, changedFiles: [...written], baseline, signal, scope: task.scope,
      });
      checksFresh = true;
      emit({ kind: 'checks_run', taskId: task.id, data: {
        turn: 0,
        repairedCheckpoint: true,
        results: checkResults.map(result => ({
          name: result.name, ok: result.ok, ms: result.ms, unusable: Boolean(result.unusable),
        })),
      } });
      const unusable = checkResults.find(result => result.unusable);
      if (unusable) {
        throw new WorkerBlocked(`the check "${unusable.name}" could not run on this machine`, {
          output: unusable.output.slice(0, 1000), humanOnly: true,
        });
      }
      if (checkResults.length > 0 && checkResults.every(result => result.ok)) {
        const summary = 'Fresh host checks passed for the reviewer repair checkpoint.';
        emit({ kind: 'checkpoint', taskId: task.id, data: {
          commit: inheritedRepair.commit, files: [...written], reviewerRepairReused: true,
        } });
        return {
          commit: inheritedRepair.commit,
          files: [...written],
          summary,
          checks: checkResults.map(item => ({
            name: item.name, ok: item.ok, ms: item.ms, exitCode: item.exitCode,
          })),
        };
      }
      notice = 'The reviewer repair checkpoint still fails a registered check. Diagnose and correct that failure.';
    }
    /*
     Each distinct cause earns ONE checkpoint, not one per occurrence.

     Without this, a `high` risk task schedules a self-review on every write —
     including the corrective write made during a self-review — and the task
     spends its turn budget reviewing itself instead of finishing. "Frequent"
     in the mission means triggered by meaningful signals, and the second
     identical signal is not a new one.
    */
    const fired = new Set();
    const trigger = (key, reason) => { if (!fired.has(key)) { fired.add(key); checkpointReasons.push(reason); } };
    const seen = new Map();
    /*
     THE STUCK GATE.

     Repetition detection catches a model repeating itself byte for byte. It does
     NOT catch the more common and more expensive shape: a worker that keeps
     editing, keeps running checks, keeps producing *different* output, and never
     gets anywhere — busy all night against the same wall.

     So progress is defined positively and counted. A turn makes progress if it
     wrote a file it had not written before, or moved a check from failing to
     passing. Turns that do neither accumulate, and `stuckAfterTurns` of them is
     a worker that is stuck whatever it says about itself.

     Being stuck is NOT a failure and not the end of the task. It hands the
     problem up one rung, exactly as the ladder intends: Nick is told, and the
     reviewer gets a chance to break the worker out of it.
    */
    let barren = 0;
    // Which exchanges made progress: the evidence an extension is judged on.
    const progressTurns = [];
    let currentTurn = 0;
    const progressed = () => { barren = 0; if (!progressTurns.includes(currentTurn)) progressTurns.push(currentTurn); };
    const exchanges = [];
    const attemptStarted = Date.now();
    let grantedMs = 0;
    let turnLimit = maxTurns;
    // After a refusal, the reviewer is not asked again until there is new progress.
    let refusedAfter = -1;
    /*
     A reply that spends the whole output budget thinking produces nothing, and
     the model that did it once tends to do it again: on the first real run the
     worker lost two exchanges and then its attempt that way. So the exchange
     after a starved reply runs with thinking switched off -- once. Something
     is always produced, and the next exchange thinks again.
    */
    let starved = false;
    let repeatedGreen = false;
    let nudgedToWrite = false;

    for (let turn = 1; turn <= turnLimit; turn++) {
      if (signal?.aborted) throw new WorkerBlocked('cancelled', { turn });
      currentTurn = turn;

      /*
       Will the next exchange fit? Judged from how long this attempt's recent
       exchanges actually took, not from a guess: with no exchange yet there is
       nothing to judge, and the first budget stands. Out of exchanges counts the
       same way as out of time.
      */
      const expectedMs = exchanges.length ? Math.max(...exchanges.slice(-3).map(item => item.ms)) * 1.25 : 0;
      const shortOfTime = deadline && expectedMs > 0 && deadline.remainingMs() < expectedMs;
      const lastTurn = turn === turnLimit && turnLimit < extension.maxTurnsHard;
      const newProgress = progressTurns.some(at => at > refusedAfter);
      if ((shortOfTime || lastTurn) && newProgress) {
        const decision = await decideExtension({ runtime, task, turn, exchanges, progressTurns, checkResults,
          elapsedMs: Date.now() - attemptStarted, grantedMs,
          hardRemainingMs: deadline ? deadline.hardRemainingMs() : extension.maxGrantMs,
          maxGrantMs: extension.maxGrantMs, defaultGrantMs: extension.defaultGrantMs, signal });
        const granted = decision.grantMs > 0 && deadline ? deadline.extend(decision.grantMs) : 0;
        // Exchanges follow time: one per five granted minutes, at least two.
        const moreTurns = decision.grantMs > 0
          ? Math.min(extension.maxTurnsHard - turnLimit, Math.max(2, Math.ceil(decision.grantMs / (5 * 60_000)))) : 0;
        grantedMs += granted;
        turnLimit += moreTurns;
        if (!decision.grantMs) refusedAfter = turn - 1;
        emit({ kind: decision.grantMs ? 'deadline_extended' : 'deadline_extension_refused', taskId: task.id, data: {
          turn, grantedMs: granted, moreTurns, turnLimit, by: decision.by, etaMinutes: decision.etaMinutes ?? null,
          reason: decision.reason, remainingMs: deadline?.remainingMs() ?? null } });
        if (turn > turnLimit) break;
      }
      // The mission's self-review triggers are SIGNALS the runtime observed —
      // a subtask boundary, a check that flipped, a repeated failure, a
      // higher-risk or unusually large write — not a percentage of an unknown
      // total. The turn they produce allows the worker to FIX what it finds;
      // the only thing it cannot do there is declare itself finished.
      const checkpoint = checkpointReasons.length > 0;
      const checkpointNote = checkpoint
        ? `SELF-REVIEW CHECKPOINT: ${checkpointReasons.join('; ')}. Inspect your current files ` +
          'against every acceptance criterion, non-scope and failure path. Say what you find. ' +
          'You MAY fix what you find in this same exchange — ### READ, ### SEARCH, ### FILE and ' +
          '### CHECK are all available, and correcting your own mistake here is cheaper than ' +
          'any other way of correcting it. What you may NOT do this exchange is ### DONE: a ' +
          'review that ends in you declaring your own work finished is not a review.'
        : '';
      /*
       Half the exchanges gone and nothing written. On the roadmap run
       (2026-09-26) two investigation tasks spent every exchange of three
       attempts reading and searching and never wrote their report, so each
       attempt ended with nothing for the checks or the reviewer to judge.
       Reading is legitimate; reading until the budget is gone is not.
      */
      const writeNudge = !written.size && turn > 1 && turn >= Math.ceil(turnLimit / 2)
        ? `You have used ${turn - 1} of ${turnLimit} exchanges and written nothing yet. Write your file NOW with ### FILE ` +
          '(or ### EDIT for an existing one), even if incomplete: the checks will say what is missing, and later exchanges can improve it.'
        : '';
      if (writeNudge && !nudgedToWrite) {
        nudgedToWrite = true;
        emit({ kind: 'worker_write_nudge', taskId: task.id, data: { turn, turnLimit } });
      }
      const prompt = fitWorkingSet({
        system, files: workingSet, spec: runtime.spec?.('worker'), pinned: own,
        onDrop: path => emit({ kind: 'context_file_evicted', taskId: task.id, data: { turn, path } }),
        build: () => workerTurn({
          contract: task, files: workingSet, checkResults, instructions, checkDescriptions, existing: renderSurvey(survey),
          notice: [notice, checkpointNote, writeNudge].filter(Boolean).join('\n'),
          turn, maxTurns: turnLimit,
          // The real attempt budget, from durable state — not the turn counter.
          attempt: task.attempts, maxAttempts,
        }),
      });
      checkpointReasons = [];
      notice = null;

      activity?.begin({ role: 'worker', model: runtime.spec?.('worker')?.model ?? null,
        phase: 'implement', taskId: task.id, note: `${task.title} — attempt ${task.attempts}, exchange ${turn}` });
      let response;
      try {
        response = await cancellableGenerate(runtime, 'worker', { system, prompt, signal,
          ...(starved ? { think: false } : {}), onDelta: delta => activity?.delta(delta) });
      } finally { await activity?.end(); }
      let actions = parseWorkerReply(response.text);
      exchanges.push({ turn, ms: response.ms ?? 0, actions: actions.map(action => action.kind) });
      if (checkpoint) {
        emit({ kind: 'worker_self_review', taskId: task.id, data: { turn, checkpointNote } });
        /*
         Self-CORRECTION survives the checkpoint; self-APPROVAL does not.

         The worker is required to review its own work often (mission §3), and
         fixing what it just found — writing, re-checking — is the whole value of
         doing so: that correction costs seconds, the same one found by the
         reviewer costs a cycle, and found by Astra it costs the scarcest thing
         in the project. So only `### DONE` is withheld. A review that ends in
         the worker declaring its own work finished is not a review, and the
         gate is not the worker's to hold.
        */
        const withheld = actions.filter(action => action.kind === 'DONE');
        actions = actions.filter(action => action.kind !== 'DONE');
        if (withheld.length) {
          // SAY it was withheld. A marker that silently vanishes gets re-sent
          // byte-identically, and three of those trip the repetition detector
          // and block a task over a rule the model was never told it had broken.
          notice = 'Your ### DONE was withheld: a self-review checkpoint cannot also be the moment ' +
            'you declare the task finished. Address what your review found, run ### CHECK, then ' +
            '### DONE on the next exchange.';
          emit({ kind: 'worker_checkpoint_withheld', taskId: task.id, data: { turn, kinds: ['DONE'] } });
        }
        if (!actions.length) continue;
      }
      emit({ kind: 'worker_turn', taskId: task.id, data: {
        turn, ms: response.ms, model: response.model,
        actions: actions.map(action => action.kind),
        doneReason: response.meta.doneReason, thinkingChars: response.meta.thinkingChars,
      } });

      const wasStarved = starved;
      starved = false;
      if (!actions.length) {
        // Three different causes need three different fixes, and "no usable
        // reply" names none of them. Say which one this was.
        if (response.meta.doneReason === 'length') {
          // Stay in the no-thinking recovery mode until the model emits a
          // usable marker. A no-thinking exchange can itself hit the output
          // limit (observed in the live Phase 57 run); turning thinking back on
          // after that simply repeats the expensive failure and burns the task
          // timeout without ever writing a file.
          starved = true;
        }
        if (response.meta.doneReason === 'length' && !wasStarved) {
          emit({ kind: 'worker_thinking_disabled', taskId: task.id, data: { turn, thinkingChars: response.meta.thinkingChars } });
        }
        notice = response.meta.doneReason === 'length'
          ? 'Your previous reply used the whole output budget before producing a marker, so this exchange runs WITHOUT extended thinking. ' +
            'Write a plan of at most five lines, then the markers. Write at most ONE file in this reply; the next exchange can write the other.'
          : 'Your previous reply contained no recognised marker. Reply using ### READ, ### SEARCH, ### EDIT, ### FILE, ### CHECK, ### DONE or ### BLOCKED.';
        emit({ kind: 'worker_unusable_reply', taskId: task.id, data: { turn, chars: response.text.length, doneReason: response.meta.doneReason } });
        continue;
      }

      // Repetition detection. A model that produces byte-identical intent three
      // turns running has stopped making progress, whatever it says.
      const fingerprint = digest(actions.map(action => `${action.kind}:${action.path ?? action.target ?? ''}:${digest(action.contents ?? JSON.stringify(action.hunks ?? ''))}`).join('|'));
      // Consecutive, as the comment says: re-reading a file between searches is
      // investigation, and counting it across the attempt now routes it to the
      // reviewer as "stuck".
      const streak = seen.get('last') === fingerprint ? (seen.get('streak') ?? 1) + 1 : 1;
      seen.set('last', fingerprint); seen.set('streak', streak);
      // Repeating itself over work whose checks are all green is not stuck:
      // it is finished and cannot say so. That work goes to review below.
      const greenNow = checksFresh && checkResults.length > 0 && checkResults.every(result => result.ok);
      if (streak >= 3 && greenNow) repeatedGreen = true;
      if (streak >= 3 && !greenNow) {
        // Repeating itself is being stuck: the reviewer rung, not a spent attempt.
        throw new WorkerBlocked('worker repeated the same action three times without progress',
          { turn, fingerprint, stuck: true, written: [...written] });
      }

      const blocked = actions.find(action => action.kind === 'BLOCKED');
      if (blocked) throw new WorkerBlocked(blocked.text.slice(0, 500) || 'worker reported it is blocked', { turn, humanOnly: true, proposals: actions.filter(a => a.kind === 'PROPOSE').map(a => a.text) });
      for (const proposal of actions.filter(action => action.kind === 'PROPOSE')) {
        // A proposal changes nothing by itself. It is recorded for review, and
        // the worker keeps working to the contract as written.
        emit({ kind: 'contract_change_proposed', taskId: task.id, data: { turn, proposal: proposal.text } });
      }

      // Recorded before anything else this turn, so the panel shows where the
      // work is even if the rest of the turn then fails.
      const declared = actions.find(action => action.kind === 'SUBTASK');
      if (declared && `${declared.index}/${declared.total}` !== lastSubtask) {
        if (lastSubtask !== null) trigger(`subtask:${declared.index}/${declared.total}`, 'subtask boundary');
        lastSubtask = `${declared.index}/${declared.total}`;
      }
      if (declared && onSubtask) {
        await onSubtask(task.id, { label: declared.label, index: declared.index, total: declared.total }).catch(() => {});
        emit({ kind: 'subtask_declared', taskId: task.id, data: { turn, label: declared.label, index: declared.index, total: declared.total } });
      }

      for (const malformed of actions.filter(action => action.kind === 'MALFORMED')) {
        notice = `${notice ? `${notice}\n` : ''}${malformed.detail}. See "Change part of a file" and "Write a file" in your instructions for the exact format.`;
      }

      // Only as many files as the working set can hold THIS exchange. Reading
      // ten at once used to evict the first reads to make room for the last,
      // so the model paid for files it never saw (seven, on the first real run).
      const readNow = new Set();
      const skipped = [];
      const alreadyInView = [];
      for (const action of actions.filter(action => action.kind === 'READ')) {
        // Already in view: say so. A silently ignored READ was re-sent until the
        // repetition gate blocked the task (the live run, 2026-09-24, three
        // identical READ turns on its last attempt).
        if (workingSet.some(file => file.path === action.target)) { alreadyInView.push(action.target); continue; }
        const room = workingSet.length < MAX_WORKING_SET ||
          workingSet.some(file => !own(file) && !readNow.has(file.path));
        if (!room) { skipped.push(action.target); continue; }
        try {
          const contents = await readScoped(worktree, action.target, { maxBytes: MAX_FILE_CHARS });
          workingSet.push({ path: action.target, contents });
          readNow.add(action.target);
          makeRoom(readNow);
        } catch (error) {
          notice = `${notice ? `${notice}\n` : ''}Could not read ${action.target}: ${error.message}. Use ### SEARCH to find the real path.`;
        }
      }
      if (alreadyInView.length) {
        notice = `${notice ? `${notice}\n` : ''}Already in your working set, shown in full under FILES above: ${alreadyInView.join(', ')}. ` +
          'Do not read them again. Your next step is to change a file with ### EDIT (or ### FILE for a new one).';
      }
      if (skipped.length) {
        notice = `${notice ? `${notice}\n` : ''}Not read this exchange, because the working set holds ${MAX_WORKING_SET} files ` +
          `and the files you are changing always stay in it: ${skipped.join(', ')}. Read fewer files at a time.`;
        emit({ kind: 'worker_reads_skipped', taskId: task.id, data: { turn, skipped } });
      }

      for (const action of actions.filter(action => action.kind === 'SEARCH')) {
        const matches = await searchRepo(worktree, action.target);
        notice = `${notice ? `${notice}\n` : ''}SEARCH "${action.target}":\n${matches.length ? matches.join('\n') : '(no matches)'}`;
      }

      const edited = await materializeEdits(worktree, actions, { maxBytes: MAX_FILE_CHARS });
      for (const failure of edited.failures) {
        notice = `${notice ? `${notice}\n` : ''}EDIT ${failure.path} NOT APPLIED, the file is unchanged: ${failure.reason}.`;
        emit({ kind: 'worker_edit_failed', taskId: task.id, data: { turn, path: failure.path, reason: failure.reason } });
      }
      const writes = edited.actions.filter(action => action.kind === 'FILE');
      let wroteNow = 0;
      for (const write of writes) {
        signal?.throwIfAborted();
        try {
          const relative = write.path.replace(/^\.\//, '');
          const risk = overwriteRisk(relative, baseline.get(relative), write.contents, { contractText, wholeFile: !write.fromEdit });
          if (risk) {
            const error = new Error(`not written, because ${risk}`);
            error.layer = 'existing-work';
            throw error;
          }
          const existing = workingSet.find(file => file.path === write.path);
          const changedDuringReview = checkpoint &&
            existing?.contents !== write.contents.slice(0, MAX_FILE_CHARS);
          const path = await writeScoped(worktree, task, write.path, write.contents);
          // A corrective edit made at a runtime-requested self-review is real
          // progress even when it touches a file the worker wrote earlier.
          // Treating it as churn made the live loop hand a passing task to the
          // reviewer immediately after the worker found and fixed its own
          // acceptance-criteria miss.
          if (!written.has(path) || changedDuringReview) progressed();
          written.add(path);
          if (task.risk === 'high') trigger(`risk:${path}`, `high-risk task changed ${path}`);
          wroteNow += 1;
          // An edit to a file that was already large is not the worker writing
          // more than the task implied.
          if (write.contents.length > 12000 && !write.fromEdit) trigger(`large:${path}`, `${path} is larger than this task implied`);
          checksFresh = false;
          const current = workingSet.find(file => file.path === path);
          if (current) current.contents = write.contents.slice(0, MAX_FILE_CHARS);
          else { workingSet.push({ path, contents: write.contents.slice(0, MAX_FILE_CHARS) }); makeRoom(); }
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
      // Every write is checked, asked for or not. On the live run the worker
      // changed a failing module twice without a CHECK in between, so it was
      // fixing a failure it could no longer see. The checks take seconds; a
      // model turn takes minutes.
      if (wantsCheck || wroteNow > 0 || (wantsDone && !checksFresh)) {
        if (!written.size && !existingWork) {
          notice = `${notice ? `${notice}\n` : ''}No file has been written yet, so there is nothing to check.`;
        } else {
          const dirty = (await changedFiles(worktree)).map(file => file.path);
          const previousChecks = checkResults;
          checkResults = await runChecks(task.checks, { worktree, changedFiles: dirty, baseline, signal, scope: task.scope });
          checksFresh = true;
          for (const result of checkResults) {
            const prior = previousChecks.find(item => item.name === result.name);
            if (prior && !prior.ok && result.ok) progressed();
            if (prior && prior.ok !== result.ok) {
              trigger(`flip:${result.name}:${result.ok}`,
                `${result.name} changed from ${prior.ok ? 'pass' : 'fail'} to ${result.ok ? 'pass' : 'fail'}`);
            }
            if (!result.ok) {
              const key = `${result.name}:${digest(result.output ?? '')}`;
              failures.set(key, (failures.get(key) ?? 0) + 1);
              if (failures.get(key) === 2) trigger(`repeat:${key}`, `${result.name} repeated the same failure`);
            }
          }
          emit({ kind: 'checks_run', taskId: task.id, data: { turn,
            results: checkResults.map(result => ({ name: result.name, ok: result.ok, ms: result.ms, unusable: Boolean(result.unusable) })) } });
          const unusable = checkResults.find(result => result.unusable);
          if (unusable) {
            // The environment is broken, not the code. Handing 127 back as if it
            // were a compiler error asks the model to fix what it did not break.
            throw new WorkerBlocked(`the check "${unusable.name}" could not run on this machine`, { output: unusable.output.slice(0, 1000), humanOnly: true });
          }
        }
      }

      /*
       Counted at the END of the turn, so anything that called `progressed()`
       above has already reset it.

       A turn only counts as BARREN if the worker actually tried to move the
       work — wrote a file, or ran the checks — and got nowhere. A turn spent
       reading and searching is not stuck, it is investigating, and the system
       prompt explicitly tells the worker to do exactly that when an attempt
       failed the same way twice ("stop editing, read a different file: the
       caller, the test, the type definition"). Counting those turns would kill
       a worker for following its own instructions, and would do it fastest on
       the hard tasks where the reading matters most. Pure investigation is
       still bounded — by the turn budget and by repetition detection.
      */
      const attemptedProgress = writes.length > 0 || edited.failures.length > 0 || wantsCheck || wantsDone;
      if (attemptedProgress) barren += 1;
      /*
       Green is not stuck. On the live run a finished task -- every check
       passing -- spent its exchanges in runtime-requested self-reviews that may
       not say DONE, and the stuck gate then blocked work that was already done.
       When the limit is reached with fresh, all-passing checks, the host submits
       the checkpoint; the independent review is still the gate.
      */
      const green = checksFresh && checkResults.length > 0 && checkResults.every(result => result.ok);
      const autoSubmit = (barren >= stuckAfterTurns || repeatedGreen) && green;
      if (autoSubmit) emit({ kind: 'worker_green_submitted', taskId: task.id, data: { turn, barrenTurns: barren } });
      if (barren >= stuckAfterTurns && !green) {
        const failing = checkResults.filter(result => !result.ok).map(result => result.name);
        emit({ kind: 'worker_stuck', taskId: task.id, data: { turn, barrenTurns: barren, failing } });
        throw new WorkerBlocked(
          `no progress in ${barren} exchanges${failing.length ? ` while ${failing.join(', ')} kept failing` : ''}`,
          // `stuck` is what routes this to the reviewer instead of to the
          // ordinary blocked path: the worker is not wrong, it is stuck, and
          // those want different responses.
          { turn, stuck: true, barrenTurns: barren, failing, written: [...written] });
      }

      if (wantsDone && checkpointReasons.length && !autoSubmit) { notice = "Self-review is required before committing."; continue; }
      if (wantsDone || autoSubmit) {
        summary = (actions.find(action => action.kind === 'DONE')?.text ??
          'Every registered check passed; the host submitted this checkpoint after the self-review exchanges.').slice(0, 2000);
        const failing = checkResults.filter(result => !result.ok);
        // Everything this task changed in its scope, including files kept from
        // its previous attempt (supervisor carryover) that were not rewritten.
        const owned = (await changedFiles(worktree)).map(file => file.path).filter(path => scopeAllows(task.scope, path));
        for (const path of owned) written.add(path);
        if (!written.size) {
          /*
           ALREADY SATISFIED: the work was in the repository before this task
           began. Finished without writing, on fresh all-green checks, as an
           empty checkpoint; the reviewer then judges the EXISTING files against
           every criterion (reviewer.mjs), so saying so is not a way around review.
          */
          const claimed = /^\s*ALREADY SATISFIED\b/i.test(summary);
          if (!existingWork || !claimed) {
            if (existingWork) {
              notice = 'You reported done without changing anything. If the existing code already meets every ' +
                'acceptance criterion, start ### DONE with "ALREADY SATISFIED:" and say where each is met; otherwise make the change.';
              continue;
            }
            throw new WorkerBlocked('worker reported done without writing anything', { turn });
          }
          if (!checksFresh) { notice = 'Run ### CHECK first: an already-satisfied claim needs the checks run against the existing code.'; continue; }
          if (failing.length) {
            notice = `The task is not already satisfied: ${failing.map(result => result.name).join(', ')} fails against the existing code. Make the change.`;
            continue;
          }
          const result = await commitAlreadySatisfied(worktree, {
            message: `agent(${task.id}): already satisfied — ${task.title}\n\n${summary.slice(0, 1500)}\n\nTask: ${task.id} (rev ${task.rev}, ${task.origin})`,
          });
          if (!result.committed) throw new WorkerBlocked(`checkpoint was not created: ${result.reason}`, { turn });
          emit({ kind: 'already_satisfied', taskId: task.id, data: { commit: result.commit } });
          return { commit: result.commit, files: [], summary, alreadySatisfied: true,
            checks: checkResults.map(item => ({ name: item.name, ok: item.ok, ms: item.ms, exitCode: item.exitCode })) };
        }
        if (!checksFresh) { notice = 'Run ### CHECK before ### DONE; the checks have not run since your last edit.'; continue; }
        if (failing.length) {
          notice = `You reported done, but ${failing.map(result => result.name).join(', ')} still ${failing.length === 1 ? 'fails' : 'fail'}. Fix the failure or report ### BLOCKED honestly.`;
          continue;
        }
        signal?.throwIfAborted();
        const paths = [...written];
        const dirty = await changedFiles(worktree);
        const result = inheritedRepair && dirty.length === 0
          ? { committed: true, commit: inheritedRepair.commit, files: paths, reused: true }
          : await commitCheckpoint(worktree, {
            paths,
            message: `agent(${task.id}): ${task.title}\n\n${summary.slice(0, 1500)}\n\nTask: ${task.id} (rev ${task.rev}, ${task.origin})\nChecks: ${task.checks.join(', ')}`,
          });
        if (!result.committed) {
          // The legacy coder ignored these exit codes and logged success anyway.
          throw new WorkerBlocked(`checkpoint was not created: ${result.reason}`, { paths });
        }
        emit({ kind: 'checkpoint', taskId: task.id, data: {
          commit: result.commit, files: result.files, reviewerRepairReused: result.reused === true,
        } });
        return { commit: result.commit, files: result.files, summary,
          checks: checkResults.map(item => ({ name: item.name, ok: item.ok, ms: item.ms, exitCode: item.exitCode })) };
      }
    }
    throw new WorkerBlocked(`worker used all ${turnLimit} turns without reaching a verified checkpoint`, { written: [...written] });
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
