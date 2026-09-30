/*
 The two things a blocked run has to produce, and the one list Nick can always
 fall back on.

 1. A DISCORD ALERT Nick can act on from a phone, at 01:00, with no access to
    the machine. Under 1500 bytes because that is what the alert route accepts,
    and short because the question it must answer is "do I need to get up?"

 2. An ASTRA BRIEF: the minimum high-quality context for a senior review. The
    mission is explicit that Astra must not reread huge histories — it gets the
    contract, the review results, the test results, the focused diff, and the
    unresolved question. Nothing else.

 3. A COMMAND REFERENCE: every command for one project, with its id already in
    place, and a sentence each on what it does and when to reach for it. It
    lives here, beside the alert, so the alert and the reference cannot drift
    into printing two different spellings of the same command.

 The first two are generated from durable state, never from a model's
 narration. A brief that asks a model to summarise what happened is a brief that
 can be wrong about what happened.
*/
import { basename, dirname, resolve } from 'node:path';
import { readJournal, auditJournal } from './journal.mjs';
import { diffSince, runLog } from './workspace.mjs';
import { projectRoot } from './projects.mjs';

const short = commit => (typeof commit === 'string' ? commit.slice(0, 10) : 'none');

/*
 WHICH PROJECT A PRINTED COMMAND IS FOR

 Runs are per project: `.../project-agent/projects/<id>`. Both CLIs answer a
 command without `--project` by looking at the original singleton root instead,
 which for a project run means "No project-agent run exists." — so a printed
 command that leaves the flag out is a command that fails at exactly the moment
 Nick needs it to work.

 The id is read back off the run root rather than threaded through as a second
 parameter, because the root is the one thing every caller already holds. The
 check goes through `projectRoot` so there is one definition of a valid id: a
 path that merely ends in `projects/<something>` is not a project unless
 rebuilding the root from that id gives the same path back. The legacy
 singleton root has no id, and its commands correctly carry no flag.
*/
export function projectIDFromRoot(root) {
  if (typeof root !== 'string' || !root.trim()) return null;
  const path = resolve(root);
  const home = dirname(dirname(path));
  if (basename(dirname(path)) !== 'projects' || basename(home) !== 'project-agent') return null;
  try { return projectRoot(basename(path), home) === path ? basename(path) : null; }
  catch { return null; }
}

// Repository-relative on purpose: it is the spelling every other ORION document
// uses, and the reference below opens with the one `cd` that makes it work.
// Exported so `orion-agent` prints its own hints with this same spelling.
export const cli = (script, projectID) => `scripts/${script}${projectID ? ` --project ${projectID}` : ''}`;

// How to start or continue. A project goes through `orion-projects launch`,
// which detaches, takes the one-project-at-a-time lock and reconciles an
// interrupted worker before continuing; only the legacy run is started by hand.
export const startCommand = projectID => (projectID ? `scripts/orion-projects launch ${projectID} --until-stopped` : 'scripts/orion-agent run --until-stopped');

/*
 Cut a string to a UTF-8 byte budget on a character boundary. Slicing the
 Buffer instead can split a multi-byte character and put U+FFFD in front of
 Nick; slicing by JavaScript length can overshoot the byte cap it is meant to
 honour.
*/
function clip(text, maxBytes, marker = '…') {
  const value = String(text ?? '');
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const budget = maxBytes - Buffer.byteLength(marker, 'utf8');
  let kept = '';
  let used = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, 'utf8');
    if (used + size > budget) break;
    kept += char;
    used += size;
  }
  return kept + marker;
}

const ALERT_MAX_BYTES = 1400;

function attemptHistory(journal, taskId) {
  const relevant = journal.filter(entry => entry.taskId === taskId);
  const writes = relevant.filter(entry => entry.kind === 'worker_write').length;
  const refusals = relevant.filter(entry => entry.kind === 'worker_write_refused');
  const checks = relevant.filter(entry => entry.kind === 'checks_run');
  const lastChecks = checks.at(-1)?.results ?? [];
  return {
    turns: relevant.filter(entry => entry.kind === 'worker_turn').length,
    writes,
    refusals: refusals.map(entry => `${entry.path}: ${entry.reason}`).slice(0, 5),
    failingChecks: lastChecks.filter(result => !result.ok).map(result => result.name),
    passingChecks: lastChecks.filter(result => result.ok).map(result => result.name),
    repairs: relevant.filter(entry => entry.kind === 'reviewer_repair').length,
  };
}

/**
 * The phone message. Written so the first line alone decides whether this can
 * wait until morning.
 *
 * `root` is the run root; it is what puts `--project <id>` into the commands
 * the message prints. Without it the commands target the legacy singleton.
 * `briefPath`, when given, is carried inside the byte budget with the commands,
 * so it cannot be the line a downstream length cap cuts in half.
 */
export function discordBrief(state, { project = 'ORION', escalation, journal = [], root = null, briefPath = null, repoRoot = null }) {
  const task = state.tasks.find(item => item.id === escalation.taskId);
  const history = escalation.taskId ? attemptHistory(journal, escalation.taskId) : null;
  const accepted = state.tasks.filter(item => item.status === 'accepted').length;
  const lastCheckpoint = [...state.tasks].reverse().find(item => item.status === 'accepted')?.commit;
  const projectID = projectIDFromRoot(root);

  // Free text is capped per field so that one long reason cannot push the
  // question Nick is being asked off the end of the message. `Needs` sits
  // directly under `Why` for the same reason: those two lines are the decision.
  const body = [
    `ORION ${state.status === 'escalated' ? 'agent stopped' : 'task parked; other work continues'} — ${escalation.recommendAstra ? 'ASTRA REVIEW NEEDED' : 'needs you'}`,
    `${clip(project, 120)} · ${accepted}/${state.tasks.length} tasks accepted${state.tasks.length !== state.tasks.filter(t => t.origin === 'plan').length ? ` (${state.tasks.filter(t => t.origin !== 'plan').length} added by review)` : ''}`,
    task ? `Task: ${task.id} — ${clip(task.title, 120)}` : 'Task: (none active)',
    task ? `Stage: ${task.stage}, attempt ${task.attempts}/${state.maxAttempts}` : '',
    `Why: ${clip(escalation.reason, 300)}`,
    escalation.question ? `Needs: ${clip(escalation.question, 300)}` : '',
  ];
  if (history?.failingChecks.length) body.push(`Failing: ${clip(history.failingChecks.join(', '), 160)}`);
  if (history?.refusals.length) body.push(`Refused writes: ${clip(history.refusals[0], 160)}`);
  if (history?.repairs) body.push(`Reviewer already repaired this ${history.repairs}×`);
  if (history) body.push(`Tried: ${history.turns} turns, ${history.writes} file writes`);
  body.push(`Checkpoint: ${short(lastCheckpoint)} (work is committed and reversible)`);

  /*
   The action lines are budgeted first and never truncated: a message that ran
   out of room is still useful, a message whose command was cut in half is not.

   The revision is deliberately NOT filled in. The controller checks it exactly,
   and the supervisor marks the escalation notified — one more revision — right
   after this message is delivered, so any number printed here is already stale
   when Nick reads it. It tells him where the live one is instead.
  */
  const agent = cli('orion-agent', projectID);
  const action = [
    escalation.recommendAstra ? 'Start Astra in ChatGPT/Codex and point it at the brief in the run directory. Then:' : '',
    `Resolve with: ${repoRoot ? `cd ${JSON.stringify(repoRoot)} && ` : ''}${cli('orion-project-agent', projectID)} resolve --revision N --id ${escalation.id} --note "..."`,
    `N = the "revision" shown by: ${repoRoot ? `cd ${JSON.stringify(repoRoot)} && ` : ''}${agent} status`,
    `Every command: ${repoRoot ? `cd ${JSON.stringify(repoRoot)} && ` : ''}${agent} commands`,
    briefPath ? `Brief: ${clip(briefPath, 300)}` : '',
  ].filter(Boolean).join('\n');

  let message = body.filter(Boolean).join('\n');
  const room = ALERT_MAX_BYTES - Buffer.byteLength(`\n${action}`, 'utf8');
  if (Buffer.byteLength(message, 'utf8') > room) message = clip(message, room, '\n…[truncated]');
  return `${message}\n${action}`;
}

/**
 * The full brief for Astra. Structured, bounded, and built entirely from
 * durable state plus git.
 */
export async function astraBrief(state, { root, worktree, baseRef, project = 'ORION', escalation = null, escalations = state.escalations?.filter(item => !item.resolvedAt) ?? [] }) {
  const journal = await readJournal(root, { limit: 4000 });
  const integrity = await auditJournal(root);
  const commits = worktree ? await runLog(worktree, baseRef) : [];
  const diff = worktree ? await diffSince(worktree, baseRef, { maxChars: 60_000 }) : { stat: '', patch: '', truncated: false };
  const blocked = state.tasks.filter(task => task.status === 'blocked');
  const proposals = journal.filter(entry => entry.kind === 'contract_change_proposed');

  const section = (title, body) => `## ${title}\n\n${body}\n`;
  const taskLine = task => `- **${task.id}** (${task.status}, ${task.origin}, weight ${task.weight}, ${task.attempts} attempt(s)` +
    `${task.corrections ? `, ${task.corrections} correction cycle(s)` : ''}): ${task.title}` +
    `${task.blocker ? `\n  - blocker: \`${task.blocker}\`` : ''}` +
    `${task.commit ? `\n  - checkpoint: \`${short(task.commit)}\`` : ''}`;

  return [
    `# Astra review brief — ${project}`,
    '',
    `Run \`${state.runId}\`, revision ${state.revision}, status **${state.status}**.`,
    `Generated from durable controller state and git; no model narration is quoted as fact.`,
    '',
    (escalations.length ? escalations : escalation ? [escalation] : []).map(escalation => section('Why this stopped / needs attention',
      `Escalation: ${escalation.id} · Task: ${escalation.taskId ?? 'whole run'}\n\n` +
      `**${escalation.kind}** — ${escalation.reason}\n\n` +
      `${escalation.question ? `**The question for you**: ${escalation.question}\n\n` : ''}` +
      `Astra specifically recommended: **${escalation.recommendAstra ? 'yes' : 'no'}**.`)).join('\n'),

    section('Tasks', state.tasks.map(taskLine).join('\n')),

    section('Review decisions', state.reviews.length
      ? state.reviews.map(review => `- **${review.taskId ?? 'the whole run (final review)'}** → \`${review.decision}\` by ${review.reviewer} at ${review.at}` +
        `${review.correctionIds?.length ? ` (+${review.correctionIds.length} correction task(s): ${review.correctionIds.join(', ')})` : ''}` +
        `\n  - ${review.summary || '(no summary)'}` +
        `${review.failed?.length ? `\n  - findings: ${review.failed.map(item => `[${item.severity}] ${item.criterion}`).join('; ')}` : ''}`).join('\n')
      : '(no reviews recorded)'),

    section('Reviewer-authored code changes',
      state.repairs.length
        ? `The review model crossed from reviewing into implementing ${state.repairs.length} time(s). ` +
          'Treat these as work that was NOT independently reviewed:\n\n' +
          state.repairs.map(repair => `- **${repair.taskId}** by \`${repair.model}\` at ${repair.at}` +
            `${repair.commit ? ` (\`${short(repair.commit)}\`)` : ''}\n  - files: ${repair.files.join(', ')}\n  - ${repair.summary}`).join('\n')
        : 'None. Every line of code in this run was written by the worker and reviewed in a separate reviewer call (the configured model may be the same).'),

    blocked.length ? section('Blocked tasks', blocked.map(task =>
      `- **${task.id}**: ${task.blocker}\n  - objective: ${task.objective}\n  - acceptance: ${task.acceptance.join(' · ')}`).join('\n')) : '',

    proposals.length ? section('Contract changes the worker proposed (none were applied)',
      proposals.slice(-10).map(entry => `- ${entry.taskId}: ${String(entry.proposal).slice(0, 400)}`).join('\n')) : '',

    state.steering.filter(item => !item.applied).length ? section('Unapplied operator instructions',
      state.steering.filter(item => !item.applied).map(item => `- ${item.text}`).join('\n')) : '',

    section('Commits on this run', commits.length
      ? commits.map(entry => `- \`${short(entry.commit)}\` ${entry.subject}`).join('\n')
      : '(no commits)'),

    section('Combined diff', `\`\`\`\n${diff.stat}\n\`\`\`\n\n<details><summary>patch</summary>\n\n\`\`\`diff\n${diff.patch}\n\`\`\`\n\n</details>` +
      (diff.truncated ? '\n\n**Truncated.** The full patch is in the run branch.' : '')),

    section('Audit integrity', `${integrity.entries} journal entries, seq ${integrity.firstSeq}–${integrity.lastSeq}. ` +
      `${integrity.gaps.length ? `**${integrity.gaps.length} gap(s)**: ${integrity.gaps.map(gap => `${gap.after}→${gap.next}`).join(', ')} — each gap is one audit line lost to a crash between publishing state and appending the journal; state itself is authoritative.` : 'No gaps.'}` +
      `${integrity.corrupt.length ? ` ${integrity.corrupt.length} corrupt line(s).` : ''}`),

    section('What is wanted from you',
      '- Judge the architecture and anything marked blocked or escalated above.\n' +
      '- A tiny, obvious, high-confidence fix you may make directly.\n' +
      '- Anything larger should become new task contracts for the local loop rather than your own implementation time.'),
  ].filter(Boolean).join('\n');
}

/*
 THE COMMAND REFERENCE

 What `orion-agent [--project <id>] commands` prints, and the same list
 OPERATING.md carries with `<id>` in place of a real one. It is data first and
 text second so a test can hold every entry to the rule this whole file serves:
 a command ORION tells Nick to type must be one that works when he types it.

 Nothing here reads run state. The reference has to work before a project has
 ever been launched, and on the night the state file is the thing that broke.
*/

/*
 Where the phone controls reach. Kept as one constant, and mirrored in
 OPERATING.md, because it is a statement about another program
 (`scripts/orion-remote`) and must change whenever that program's targeting
 rule does. Discord runs an INSTALLED copy of that program, so a repository
 change reaches the phone only after `scripts/orion-remote-install` is re-run;
 the last sentence is how Nick recognises the stale-copy case from the reply.
*/
export const DISCORD_REACH = 'With the project id, as shown, they act on this project. Without it they act on the project running now, ' +
  'or the only one with a run; if several could be meant, Orion lists them and changes nothing. ' +
  'If Discord rejects these, or says no run exists while this one is running, its installed copy is out of date: re-run scripts/orion-remote-install at the Mac.';

const DEFAULT_REPO = resolve(import.meta.dirname, '../../..');

/** Every command for one project (or the legacy run), grouped, each with what it does and when to use it. */
export function projectCommands(projectID = null) {
  const agent = cli('orion-agent', projectID);
  const control = cli('orion-project-agent', projectID);
  const named = projectID ? ` ${projectID}` : '';
  const start = projectID
    ? { command: startCommand(projectID), verb: 'launch',
      what: 'Starts the project, or continues it after a pause, a stop, an exterminate or a crash, until you stop it. ' +
        'It runs in the background, so closing this terminal or the app does not stop it. The Start / Continue button in Projects does the same. ' +
        'Use --until 2026-09-24T08:00:00+01:00 instead of --until-stopped for an exact wall-clock stop. ' +
        'Add --enable at the end only if it refuses because execution is disabled. ' +
        'While it runs it keeps the Mac from idle-sleeping. Options: --keep-display-on keeps the screen on too; ' +
        '--nudge-minutes 5 tells macOS someone is there every 5 minutes, like moving the mouse; --no-keep-awake turns keep-awake off. ' +
        'Each launch uses exactly the options it is given. ORION cannot stop the Mac sleeping when the lid closes; preflight warns about it.' }
    : { command: startCommand(null), verb: 'run',
      what: 'Supervises the original single run in this terminal until stopped. It needs a run first: scripts/orion-agent init PLAN.json' };
  return [
    { title: 'SEE WHAT IT IS DOING', entries: [
      { command: `${agent} status`,
        what: 'Where the run is: its status, the task in hand, open escalations with their ids, and the heartbeat. ' +
          '"live": false while the status says running means the supervisor crashed. It also shows the "revision" number that steer and resolve need.' },
      { command: `${agent} brief`,
        what: 'Writes a fresh Astra review brief for this run and prints where it saved it. Use it when an alert says ASTRA REVIEW NEEDED.' },
      { command: `${agent} commands`, what: 'Prints this list again.' },
    ] },
    { title: 'START OR CONTINUE', entries: [
      { command: start.command, what: start.what },
      ...(projectID ? [{ command: 'scripts/orion-projects preflight',
        what: 'Checks, changing nothing, whether this Mac will stay up for a run: power, lid and sleep settings. Run it before leaving one overnight.' }] : []),
    ] },
    { title: 'STOP IT', note: 'No revision needed: a halt must never fail because the run moved on.', entries: [
      { command: `${control} pause`,
        what: 'Holds at the next task boundary and keeps its place. Use it when you want it to wait, not end.' },
      { command: `${control} stop`,
        what: 'The normal way to stop. The step in flight finishes, the run ends at the next safe boundary, and it stays fully resumable.' },
      { command: `${control} exterminate`,
        what: 'Abandons the model call in flight right now. Use it only when stop is too slow. Accepted work is never lost; ' +
          'the half-done step is thrown away when the run next starts.' },
      { command: `${control} resume`,
        what: `Clears a pause, stop or exterminate. It does not restart a run whose process has already exited; for that, use ${start.verb} above.` },
    ] },
    { title: 'STEER AND DECIDE', note: 'N is the "revision" from status, taken just before. If it says the revision changed, check status again.', entries: [
      { command: `${control} steer --revision N --text "..."`,
        what: 'Gives it an instruction in plain words. Applied at the next task boundary, never mid-task.' },
      { command: `${control} resolve --revision N --id ESCALATION_ID --note "..."`,
        what: 'Answers an escalation. ESCALATION_ID is in status and in the Discord alert. The note is why it is now safe to continue ' +
          'and is kept as the audit record. A parked task gets one more attempt, not a fresh budget.' },
    ] },
    { title: 'FROM DISCORD (a DM to Orion)',
      note: `Discord can never start a run. ${projectID ? DISCORD_REACH : 'Without a project id these act on whatever run is going now.'}`, entries: [
      { command: `agent status${named}`, what: 'A short progress summary, and whether a supervisor is actually alive.' },
      { command: `agent pause${named}`, what: 'The same as pause above.' },
      { command: `agent stop${named}`, what: 'The same as stop above.' },
      { command: `agent exterminate${named}`, what: 'The same as exterminate above. Two words on purpose: a bare "stop" is only conversation.' },
      { command: `agent resume${named}`, what: 'The same as resume above. It has to come from you, not from Orion.' },
    ] },
  ];
}

function wrap(text, indent, width = 80) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && indent.length + line.length + 1 + word.length > width) { lines.push(indent + line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines.join('\n');
}

/** The printable cheat sheet. `name` is the project's display name, when known. */
export function commandReference({ projectID = null, name = null, repo = DEFAULT_REPO } = {}) {
  const heading = projectID
    ? `ORION commands for ${name ? `"${name}" (${projectID})` : `project ${projectID}`}`
    : 'ORION commands for the original single run (no --project)';
  const intro = [heading, `Type these from the ORION folder. First:  cd ${/\s/.test(repo) ? `"${repo}"` : repo}`];
  if (!projectID) intro.push('For a saved project, list them with scripts/orion-projects list, then run scripts/orion-agent --project ID commands');
  const groups = projectCommands(projectID).map(group => [
    group.title,
    group.note ? wrap(group.note, '  ') : '',
    ...group.entries.map(entry => `  ${entry.command}\n${wrap(entry.what, '      ')}`),
  ].filter(Boolean).join('\n'));
  return [intro.join('\n'), ...groups].join('\n\n');
}
