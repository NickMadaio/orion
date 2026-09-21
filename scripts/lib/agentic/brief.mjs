/*
 The two things a blocked run has to produce.

 1. A DISCORD ALERT Nick can act on from a phone, at 01:00, with no access to
    the machine. Under 1500 bytes because that is what the alert route accepts,
    and short because the question it must answer is "do I need to get up?"

 2. An ASTRA BRIEF: the minimum high-quality context for a senior review. The
    mission is explicit that Astra must not reread huge histories — it gets the
    contract, the review results, the test results, the focused diff, and the
    unresolved question. Nothing else.

 Both are generated from durable state, never from a model's narration. A brief
 that asks a model to summarise what happened is a brief that can be wrong about
 what happened.
*/
import { readJournal, auditJournal } from './journal.mjs';
import { diffSince, runLog } from './workspace.mjs';

const short = commit => (typeof commit === 'string' ? commit.slice(0, 10) : 'none');

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
 */
export function discordBrief(state, { project = 'ORION', escalation, journal = [] }) {
  const task = state.tasks.find(item => item.id === escalation.taskId);
  const history = escalation.taskId ? attemptHistory(journal, escalation.taskId) : null;
  const accepted = state.tasks.filter(item => item.status === 'accepted').length;
  const lastCheckpoint = [...state.tasks].reverse().find(item => item.status === 'accepted')?.commit;

  const lines = [
    `ORION agent stopped — ${escalation.recommendAstra ? 'ASTRA REVIEW NEEDED' : 'needs you'}`,
    `${project} · ${accepted}/${state.tasks.length} tasks accepted${state.tasks.length !== state.tasks.filter(t => t.origin === 'plan').length ? ` (${state.tasks.filter(t => t.origin !== 'plan').length} added by review)` : ''}`,
    task ? `Task: ${task.id} — ${task.title}` : 'Task: (none active)',
    task ? `Stage: ${task.stage}, attempt ${task.attempts}/${state.maxAttempts}` : '',
    `Why: ${escalation.reason}`,
  ];
  if (history?.failingChecks.length) lines.push(`Failing: ${history.failingChecks.join(', ')}`);
  if (history?.refusals.length) lines.push(`Refused writes: ${history.refusals[0]}`);
  if (history?.repairs) lines.push(`Reviewer already repaired this ${history.repairs}×`);
  if (history) lines.push(`Tried: ${history.turns} turns, ${history.writes} file writes`);
  lines.push(`Checkpoint: ${short(lastCheckpoint)} (work is committed and reversible)`);
  if (escalation.question) lines.push(`Needs: ${escalation.question}`);
  lines.push(escalation.recommendAstra
    ? 'Start Astra in ChatGPT/Codex and point it at the brief in the run directory.'
    : 'Resolve with: orion-project-agent resolve --revision N --note "..."');

  let message = lines.filter(Boolean).join('\n');
  if (Buffer.byteLength(message, 'utf8') > 1400) {
    message = `${Buffer.from(message, 'utf8').subarray(0, 1380).toString('utf8')}\n…[truncated]`;
  }
  return message;
}

/**
 * The full brief for Astra. Structured, bounded, and built entirely from
 * durable state plus git.
 */
export async function astraBrief(state, { root, worktree, baseRef, project = 'ORION', escalation = null }) {
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
    escalation ? section('Why this stopped',
      `**${escalation.kind}** — ${escalation.reason}\n\n` +
      `${escalation.question ? `**The question for you**: ${escalation.question}\n\n` : ''}` +
      `Astra specifically recommended: **${escalation.recommendAstra ? 'yes' : 'no'}**.`) : '',

    section('Tasks', state.tasks.map(taskLine).join('\n')),

    section('Review decisions', state.reviews.length
      ? state.reviews.map(review => `- **${review.taskId}** → \`${review.decision}\` by ${review.reviewer} at ${review.at}` +
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
        : 'None. Every line of code in this run was written by the worker and reviewed by a different model.'),

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
