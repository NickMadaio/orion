/*
 Prompt assembly and reply parsing.

 CONTEXT IS A BUDGET, NOT A BUCKET

 The mission is explicit: no endless agent conversation carrying the history of
 ORION. So a turn is assembled from four stable parts and nothing else —

   1. the system prompt, a file on disk, byte-identical every turn
   2. the task contract, rendered compactly and identically every turn
   3. the working set: only the files this task actually touched or asked for
   4. the last turn's outcome: check results and the failure, bounded

 What is deliberately NOT here: previous turns' reasoning, previous file
 contents, the run's history, other tasks. Durable state remembers those; the
 model does not need to. A model that has to remember what stage it is in has
 been given the runtime's job.

 THE SYSTEM PROMPTS LIVE IN MARKDOWN FILES

 They are the artifacts that decide how an unattended model behaves, so they are
 reviewable on their own, diffable on their own, and editable without touching
 code. `prompts/` is on the runtime deny-list: the agent cannot edit the
 instructions that constrain it.
*/
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PROMPT_DIR = join(import.meta.dirname, 'prompts');
const cache = new Map();

export async function systemPrompt(name) {
  if (!cache.has(name)) cache.set(name, await readFile(join(PROMPT_DIR, `${name}.md`), 'utf8'));
  return cache.get(name);
}

const bullets = (items, empty = '(none)') => (items?.length ? items.map(item => `- ${item}`).join('\n') : empty);

/**
 * The contract, rendered the same way every turn so the prefix stays stable and
 * the model sees one authority rather than a paraphrase that drifts.
 */
export function renderContract(contract, { checkDescriptions = [] } = {}) {
  return `## TASK CONTRACT ${contract.id} (rev ${contract.rev})

**Title**: ${contract.title}
**Objective**: ${contract.objective}
**Risk**: ${contract.risk}
**Review depth**: ${contract.reviewDepth} — light: focused acceptance review; standard: acceptance plus integration and failure paths; deep: additionally examine boundary assumptions and cross-component regressions.

### Context
${contract.context || '(none supplied)'}

### Scope — the ONLY files you may write
${bullets(contract.scope)}

### Non-scope — explicitly NOT part of this task
${bullets(contract.nonScope)}

### Architectural constraints
${bullets(contract.constraints)}

### Preconditions
${bullets(contract.preconditions)}

### Acceptance criteria — every one must be satisfied
${contract.acceptance.map((item, index) => `${index + 1}. ${item}`).join('\n')}

### Checks that must pass
${bullets(checkDescriptions.length ? checkDescriptions : contract.checks)}

### Escalate if
${bullets(contract.escalateWhen, '(no task-specific escalation conditions)')}${renderBrief(contract.brief)}`;
}

/*
 The brief comes AFTER the whole contract, never inside it. The contract is the
 authority and stays compact at the top where it is read first; the brief is the
 reference a person wrote to save the model rediscovering signatures and formats
 on every attempt. The heading says which wins, because a model that finds the
 two disagreeing needs to know that without being told again.
*/
export function renderBrief(brief) {
  if (!brief) return '';
  return `\n\n## BRIEF — reference for this task\n` +
    '_Written for this task by the people who planned it. It explains the code you will work with; it grants nothing. ' +
    'Scope, acceptance and non-scope above still govern — if the brief seems to disagree with them, follow the contract and say so with ### PROPOSE._' +
    `\n\n${brief}`;
}

/** A working-set block: paths and contents, bounded, with line numbers omitted. */
export function renderFiles(files) {
  if (!files.length) return '## FILES\n(no files loaded yet — use ### READ or ### SEARCH)';
  return `## FILES IN YOUR WORKING SET\n\n${files.map(file =>
    `### ${file.path}\n\`\`\`\n${file.contents}\n\`\`\``).join('\n\n')}`;
}

export function renderCheckResults(results) {
  if (!results?.length) return '## CHECK RESULTS\n(no checks have been run yet this attempt)';
  return `## CHECK RESULTS\n\n${results.map(result => {
    const verdict = result.unusable ? 'UNUSABLE ENVIRONMENT' : result.ok ? 'PASSED' : result.timedOut ? 'TIMED OUT' : 'FAILED';
    const output = (result.output ?? '').trim();
    // The TAIL of a failing suite is where the failure is; the head is setup.
    const excerpt = output.length > 6000 ? `…[earlier output omitted]\n${output.slice(-6000)}` : output;
    return `### ${result.name} — ${verdict}${result.exitCode === null ? '' : ` (exit ${result.exitCode})`}\n\`\`\`\n${excerpt || '(no output)'}\n\`\`\``;
  }).join('\n\n')}`;
}

export function renderSteering(instructions) {
  if (!instructions?.length) return '';
  return `\n## OPERATOR INSTRUCTIONS (from Nick, apply these)\n${bullets(instructions.map(item => item.text))}\n`;
}

/*
 The worker's turn: assembled from durable facts, so the loop is observe -> act
 rather than a growing transcript.

 TURNS and ATTEMPTS are different budgets and the worker must not confuse them.
 A TURN is one exchange inside this attempt; an ATTEMPT is one whole run at the
 task, spent when a review sends the work back. The system prompt's escalation
 advice ("attempt 2 failed the same way → read a different file") keys off
 ATTEMPTS, so labelling the turn counter "attempt" told the worker it had
 fourteen tries at a task the controller would block after three.
*/
/*
 Why the task came back, set by whichever rung sent it: a failed attempt, a
 reviewer's requested changes, a checkpoint the reviewer could not review, a
 repair. Placed straight after the contract because it changes how the contract
 should be approached — and a worker sent back without it retries blind, which
 is how the same mistake gets made three times.
*/
export function renderFeedback(feedback) {
  if (!feedback) return '';
  return `## WHY THIS TASK CAME BACK\n${feedback}\n\nAddress this first. It is the reason your previous attempt did not stand.`;
}

export function workerTurn({ contract, files, checkResults, instructions, turn, maxTurns,
  attempt, maxAttempts, notice, checkDescriptions, feedback = contract?.feedback, existing = '' }) {
  const budget = attempt && maxAttempts
    ? `This is **attempt ${attempt} of ${maxAttempts}** at this task` +
      `${attempt >= maxAttempts ? ' — your last. If you cannot finish it, ### BLOCKED honestly rather than guessing.' : '.'}` +
      `\nWithin this attempt you have ${maxTurns - turn} exchange(s) left after this one.`
    : `Exchange ${turn} of ${maxTurns}.`;
  return [
    renderContract(contract, { checkDescriptions }),
    existing,
    renderFeedback(feedback),
    renderSteering(instructions),
    renderFiles(files),
    renderCheckResults(checkResults),
    notice ? `## NOTICE\n${notice}` : '',
    `## YOUR TURN\n${budget}\n\nReply using the markers from your instructions ` +
    '(### SUBTASK, ### READ, ### SEARCH, ### FILE, ### CHECK, ### DONE, ### BLOCKED, ### PROPOSE).',
  ].filter(Boolean).join('\n\n');
}

export function reviewerTurn({ contract, diff, checkResults, workerSummary, attempts, priorFindings, checkDescriptions,
  existingFiles = [] }) {
  return [
    renderContract(contract, { checkDescriptions }),
    `## WHAT THE WORKER SAYS IT DID\n${workerSummary || '(the worker returned no summary)'}`,
    existingFiles.length
      ? '## ALREADY SATISFIED CLAIM — NO CHANGE WAS MADE\nThe worker says the code below, already in the repository, ' +
        'meets this contract, so the diff is empty. Judge THESE FILES against every acceptance criterion exactly as you ' +
        'would judge a diff. PASS only if each criterion is met by what is here; otherwise name what is missing.\n\n' +
        renderFiles(existingFiles)
      : '',
    `## DIFF UNDER REVIEW\n\`\`\`diff\n${diff.stat}\n\n${diff.patch}\n\`\`\`` +
      (diff.truncated ? '\n\n**The diff above is truncated.** Review what you can see and say so in `summary`.' : ''),
    renderCheckResults(checkResults),
    priorFindings?.length
      ? `## FINDINGS FROM YOUR PREVIOUS REVIEW OF THIS TASK\n${bullets(priorFindings.map(item => `[${item.severity}] ${item.criterion}`))}`
      : '',
    `## YOUR TURN\nThe worker used ${attempts} of its attempts. Reply with reasoning, then exactly one fenced JSON block.`,
  ].filter(Boolean).join('\n\n');
}

export function repairTurn({ contract, diff, checkResults, files, history, checkDescriptions }) {
  return [
    renderContract(contract, { checkDescriptions }),
    `## WHY YOU ARE BEING ASKED TO REPAIR\n${history}`,
    renderFiles(files),
    `## CURRENT DIFF\n\`\`\`diff\n${diff.stat}\n\n${diff.patch}\n\`\`\``,
    renderCheckResults(checkResults),
    '## YOUR TURN\nGive the fenced JSON block FIRST (diagnosis, rationale, remaining), then make the minimum useful correction — ### EDIT for a change to an existing file, ### FILE only for a new one.',
  ].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const MARKER = /^###[ \t]+(READ|SEARCH|FILE|EDIT|CHECK|DONE|BLOCKED|PROPOSE|SUBTASK)\b[ \t]*:?[ \t]*(.*)$/gm;

/**
 * Parse a worker reply into actions.
 *
 * Deliberately forgiving about prose and fence languages and strict about
 * structure: a model that has just spent four thousand tokens thinking will get
 * the markers right and the formatting around them wrong, and throwing the turn
 * away over a missing language tag costs minutes on a run measured in hours.
 */
export function parseWorkerReply(reply) {
  const text = String(reply ?? '');
  const actions = [];
  const markers = [...text.matchAll(MARKER)];
  for (const [index, match] of markers.entries()) {
    const kind = match[1];
    const argument = match[2].trim();
    const bodyStart = match.index + match[0].length;
    const bodyEnd = index + 1 < markers.length ? markers[index + 1].index : text.length;
    const body = text.slice(bodyStart, bodyEnd);
    if (kind === 'EDIT') {
      if (!argument) { actions.push({ kind: 'MALFORMED', detail: '### EDIT with no path' }); continue; }
      const hunks = parseEditHunks(body);
      if (!hunks.length) {
        actions.push({ kind: 'MALFORMED', detail: `### EDIT: ${argument} had no <<<<<<< SEARCH / ======= / >>>>>>> REPLACE block` });
        continue;
      }
      actions.push({ kind: 'EDIT', path: argument, hunks });
    } else if (kind === 'FILE') {
      const fence = body.match(/```[a-zA-Z0-9+.#-]*\n([\s\S]*?)```/);
      if (!argument) { actions.push({ kind: 'MALFORMED', detail: '### FILE with no path' }); continue; }
      if (!fence) { actions.push({ kind: 'MALFORMED', detail: `### FILE: ${argument} was not followed by a fenced block` }); continue; }
      actions.push({ kind: 'FILE', path: argument, contents: fence[1] });
    } else if (kind === 'READ' || kind === 'SEARCH') {
      if (argument) actions.push({ kind, target: argument });
    } else if (kind === 'CHECK') {
      actions.push({ kind: 'CHECK' });
    } else if (kind === 'SUBTASK') {
      // "2/4 wire the reviewer gate" — the position is optional and defaults to
      // a single step, because a model that forgets the numbers should still
      // get its label recorded rather than losing the whole declaration.
      const match = argument.match(/^\s*(\d+)\s*\/\s*(\d+)\s*[:.\-]?\s*(.*)$/);
      const label = (match ? match[3] : argument).trim();
      if (label) {
        actions.push({ kind: 'SUBTASK', label,
          index: match ? Number(match[1]) : 1, total: match ? Number(match[2]) : 1 });
      }
    } else {
      actions.push({ kind, text: `${argument}\n${body}`.trim().slice(0, 4000) });
    }
  }
  return actions;
}

/*
 EDIT: change part of a file without retyping it.

 Before this, every change was a whole-file ### FILE. On the live run a 20 KB
 module took about seven minutes to retype at local generation speed, so a
 one-line fix cost seven minutes, and a task that needed six of them ran out of
 its hour while still making progress. The reviewer's repair retyped the same
 file, ran into the output cap and was cut off mid-file. The format is the
 common SEARCH/REPLACE one, which coding models already know.
*/
const HUNK = /<{7}[ \t]*SEARCH[ \t]*\n([\s\S]*?)\n?={7}[ \t]*\n([\s\S]*?)\n?>{7}[ \t]*REPLACE/g;

export function parseEditHunks(body) {
  return [...String(body ?? '').matchAll(HUNK)].map(match => ({ search: match[1], replace: match[2] }));
}

/**
 * The last fenced JSON block in a reply, parsed. The LAST one, because a model
 * explaining its format often prints the template first and the answer second.
 */
export function parseJsonBlock(reply) {
  const text = String(reply ?? '');
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(match => match[1]);
  const candidates = blocks.length ? blocks : [text];
  for (const candidate of candidates.reverse()) {
    const trimmed = candidate.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* try the next block */ }
  }
  return null;
}
