/*
 HARD reviewer eval — measures judgment, not eagerness.

 The first eval hit its ceiling: every model except the quantized 80B caught
 both judgment defects, so it could not rank them. It also had a deeper flaw —
 it scored RECALL only. A reviewer that flags everything scored perfectly, which
 is exactly backwards: over-flagging burns a correction cycle, and a false
 escalation wakes Nick at 3am for nothing. An alert channel that cries wolf gets
 muted, and then the real escalation is missed too.

 So this scores PRECISION and RECALL together, on a diff containing:

   THREE REAL DEFECTS, none confessed by the worker, none visible from a
   superficial read:
     A. `withdraw` allows the balance to go negative when amount === balance + 1
        is guarded but amount > balance is not -- an inverted boundary.
     B. the new `history` array is returned by reference, so a caller can mutate
        the ledger's internal state. The contract requires callers cannot.
     C. `deposit` no longer validates a negative amount, silently removed while
        "simplifying" -- a REGRESSION the diff introduces, visible only by
        reading what the minus lines removed.

   TWO DECOYS that look wrong and are correct:
     D. `#balance` changed to a plain `_balance` field -- stylistically worse,
        explicitly permitted by the contract's constraints, NOT a defect.
     E. a `toString()` added that is not in the acceptance criteria but IS
        inside scope and harmless -- a reviewer should not fail the task for it.

 A model flagging D or E as a failure loses precision points. A model that
 BLOCKS on them loses more, because blocking stops the run.
*/
import { normalizeReviewContract, normalizeTaskContract, contractDigest } from '../contract.mjs';
import { parseJsonBlock, reviewerTurn, systemPrompt } from '../prompts.mjs';
import { ModelRuntime, DEFAULT_CONFIG } from '../models.mjs';

const contract = normalizeTaskContract({
  id: 'ledger-history',
  title: 'Add transaction history to the account ledger',
  objective: 'Account records every deposit and withdrawal, exposed through history(). Existing deposit/withdraw behaviour is unchanged.',
  context: 'Account currently supports deposit, withdraw and balance. Read it before changing anything.',
  weight: 3,
  dependencies: [],
  scope: ['sandbox/account.mjs'],
  nonScope: ['Do not add new files', 'Do not change the constructor signature'],
  constraints: [
    'Callers must not be able to mutate internal state through any returned value',
    'Field privacy style is your choice — private fields or underscore convention are both acceptable',
    'No new imports',
  ],
  acceptance: [
    'history() returns the list of transactions, most recent last',
    'deposit and withdraw each append one entry',
    'withdraw still refuses to overdraw the account',
    'deposit still refuses a negative or zero amount',
    'a caller cannot mutate the ledger through anything history() returns',
  ],
  checks: ['node-syntax'],
  risk: 'high',
});

const diff = {
  stat: ' sandbox/account.mjs | 38 +++++++++++++++++++++++++++-----------\n 1 file changed',
  truncated: false,
  patch: `diff --git a/sandbox/account.mjs b/sandbox/account.mjs
--- a/sandbox/account.mjs
+++ b/sandbox/account.mjs
@@ -1,24 +1,38 @@
 export class Account {
-  #balance = 0;
+  _balance = 0;
+  _history = [];

   deposit(amount) {
-    if (typeof amount !== 'number' || amount <= 0) {
-      throw new RangeError('deposit must be a positive number');
-    }
-    this.#balance += amount;
-    return this.#balance;
+    this._balance += amount;
+    this._history.push({ kind: 'deposit', amount });
+    return this._balance;
   }

   withdraw(amount) {
-    if (amount > this.#balance) {
+    if (amount > this._balance + 1) {
       throw new RangeError('insufficient funds');
     }
-    this.#balance -= amount;
-    return this.#balance;
+    this._balance -= amount;
+    this._history.push({ kind: 'withdraw', amount });
+    return this._balance;
   }

   get balance() {
-    return this.#balance;
+    return this._balance;
+  }
+
+  history() {
+    return this._history;
+  }
+
+  toString() {
+    return \`Account(\${this._balance})\`;
   }
 }`,
};

const REAL = [
  { id: 'A-overdraw', label: 'withdraw boundary inverted (balance + 1)',
    any: [/\+\s*1/, /off[- ]by[- ]one/i, /boundary/i, /overdraw/i, /insufficient/i] },
  { id: 'B-byref', label: 'history() returns the internal array by reference',
    any: [/by reference/i, /reference/i, /mutat\w+ .*(history|internal|array)/i, /copy|clone|slice|spread|frozen|freeze/i] },
  { id: 'C-regression', label: 'deposit validation silently removed',
    any: [/deposit.*(validat|check|guard|negative|zero|positive)/i, /(validat|guard).*deposit/i, /removed/i, /RangeError/] },
];
const DECOYS = [
  { id: 'D-underscore', label: 'private-field style change (explicitly allowed)',
    any: [/underscore/i, /_balance/, /private field/i, /#balance/, /encapsulat/i] },
  { id: 'E-tostring', label: 'toString added (in scope, harmless)',
    any: [/toString/i] },
];

const checkResults = [{ name: 'node-syntax', ok: true, ms: 38, exitCode: 0, output: '1 file parses' }];

async function evaluate(runtime, label, nothink) {
  const system = await systemPrompt('reviewer-system');
  // No worker summary: obliviousness measured free earlier, and a confession
  // would hand over the answers.
  const prompt = reviewerTurn({
    contract, diff, checkResults, workerSummary: '',
    attempts: 1, priorFindings: [], checkDescriptions: ['node-syntax: every changed .mjs/.js file parses'],
  });

  const started = Date.now();
  let thinkingChars = 0;
  const response = await runtime.generate('reviewer', {
    system, prompt, onDelta: d => { if (d.thinking) thinkingChars += d.thinking.length; },
  });
  const ms = Date.now() - started;

  const raw = parseJsonBlock(response.text);
  let review = null, parseError = null;
  if (raw) {
    try { review = normalizeReviewContract(raw, { taskId: contract.id, contractDigest: contractDigest(contract) }); }
    catch (error) { parseError = String(error.message); }
  }

  // Only the FAILED findings count — that is what costs a correction cycle.
  // Praise in `passed` or a mention in `summary` is not a finding.
  const failed = (review?.failed ?? raw?.failed ?? []);
  const failedText = JSON.stringify(failed);
  // Detection may legitimately cite evidence, so recall matches the whole entry.
  const caught = REAL.filter(d => d.any.some(re => re.test(failedText)));
  // A false positive must match the CRITERION — what the model claims failed.
  // Matching `evidence` too scored a correct finding as a false positive,
  // because every model quoted `this._balance + 1` as proof of defect A and the
  // decoy-D pattern contains `_balance`. All five models then reported exactly
  // 1.0 false positives, which was the regex, not their judgment.
  const criteria = JSON.stringify(failed.map(f => f?.criterion ?? ''));
  const falsePositives = DECOYS.filter(d => d.any.some(re => re.test(criteria)));

  return {
    label, ms, thinkingChars, nothink,
    outTpm: response.meta.outputTokensPerMinute,
    parsed: Boolean(review), parseError,
    verdict: review?.verdict ?? raw?.verdict ?? 'NONE',
    recall: caught.length, falsePositives: falsePositives.length,
    caught: caught.map(d => d.id), missed: REAL.filter(d => !caught.includes(d)).map(d => d.id),
    flagged: falsePositives.map(d => d.id),
    // Blocking on a decoy is the worst outcome: it stops the run for nothing.
    blockedOnDecoy: review?.verdict === 'BLOCKED' && falsePositives.length > 0,
    findings: (review?.failed ?? []).map(f => `[${f.severity}] ${f.criterion}`.slice(0, 95)),
    rawFailed: failedText.slice(0, 1400),
  };
}

const runsPer = Number(process.env.RUNS ?? 2);
const specs = process.argv.slice(2);
if (!specs.length) { console.error('usage: reviewer-hard.mjs <model[!]>...   (! = no thinking)'); process.exit(2); }

const all = [];
for (const spec of specs) {
  const nothink = spec.endsWith('!');
  const model = nothink ? spec.slice(0, -1) : spec;
  const config = { ...DEFAULT_CONFIG, roles: { ...DEFAULT_CONFIG.roles,
    reviewer: { ...DEFAULT_CONFIG.roles.reviewer, model, think: !nothink,
      timeoutMs: 45 * 60 * 1000, maxOutputTokens: 8000 } } };
  const runtime = new ModelRuntime(config);
  for (let i = 1; i <= runsPer; i++) {
    process.stderr.write(`  ${model} run ${i}/${runsPer}…\n`);
    try { all.push(await evaluate(runtime, model, nothink)); }
    catch (error) { all.push({ label: model, error: String(error.message).slice(0, 150) }); }
  }
  await runtime.releaseAll();
}

// Aggregate per model.
const byModel = new Map();
for (const r of all) {
  if (!byModel.has(r.label)) byModel.set(r.label, []);
  byModel.get(r.label).push(r);
}

console.log('\n=== HARD reviewer eval: 3 real defects, 2 decoys ===');
console.log('recall = real defects found (of 3)   FP = decoys wrongly failed (of 2, lower is better)\n');
const rows = [];
for (const [model, runs] of byModel) {
  const ok = runs.filter(r => !r.error);
  if (!ok.length) { console.log(`${model}: all runs errored — ${runs[0].error}`); continue; }
  const avg = f => (ok.reduce((s, r) => s + f(r), 0) / ok.length);
  rows.push({
    model,
    recall: avg(r => r.recall),
    fp: avg(r => r.falsePositives),
    parsed: ok.filter(r => r.parsed).length,
    n: ok.length,
    blockedOnDecoy: ok.filter(r => r.blockedOnDecoy).length,
    ms: avg(r => r.ms),
    tpm: avg(r => r.outTpm ?? 0),
    think: avg(r => r.thinkingChars),
    detail: ok.map(r => `${r.recall}/3 fp${r.falsePositives} ${r.verdict}`).join(' · '),
  });
}
rows.sort((a, b) => (b.recall - b.fp) - (a.recall - a.fp));
for (const r of rows) {
  console.log(`${r.model}`);
  console.log(`  recall ${r.recall.toFixed(1)}/3   false-positives ${r.fp.toFixed(1)}/2   net ${(r.recall - r.fp).toFixed(1)}   usable JSON ${r.parsed}/${r.n}${r.blockedOnDecoy ? `   BLOCKED-ON-DECOY ×${r.blockedOnDecoy}` : ''}`);
  console.log(`  runs: ${r.detail}`);
  console.log(`  ${(r.ms / 1000).toFixed(0)}s avg · ${Math.round(r.tpm)} tok/min · ${Math.round(r.think)} chars thinking\n`);
}
for (const [model, runs] of byModel) {
  const d = runs.find(r => r.rawFailed);
  if (d) console.log(`${model} RAW failed[]:\n${d.rawFailed}\n`);
  const f = runs.find(r => r.findings?.length);
  if (f) console.log(`${model} sample findings:\n${f.findings.slice(0, 4).map(x => '    · ' + x).join('\n')}\n`);
}
