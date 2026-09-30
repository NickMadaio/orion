# Plan standard for the local agentic loop

Status: baseline for every plan written after 2026-09-25. It does not change an
approved plan retroactively. `advance-orion-capabilities` keeps its task blocks
exactly as Astra wrote them; its briefs compensate where it falls short of this.

A plan is the only thing the local loop has to go on for hours. This document
says what a plan must contain (information) and what shape it must have
(architecture) for the loop to run it well. It is written from the first real
batch, 23–25 September 2026. "Evidence" lines cite what that batch actually did.

`scripts/orion-agent plan <file>` and `scripts/orion-projects add <file>` report
the parts a machine can check (`lint` in their output, codes in brackets below).
The rest is on the author and on Astra's review of the plan.

---

## 1. How the model uses a plan

Only three things reach a model. Anything else in the plan file is for people.

| Part | Worker | Reviewer | Repair |
|---|---|---|---|
| The task's own `orion-task` block (rendered as the TASK CONTRACT) | every exchange | every review | yes |
| Its brief: `common.md` + `<task-id>.md` | every exchange, after the contract | yes | yes |
| Files: its scope files, plus what it READs (8 at most) | yes | the diff and check output | scope files and diff |

**It never sees:**
- the plan's prose: the goal, phases, roadmap and "read AGENTS.md first";
- other tasks' contracts;
- the dependency graph;
- the run's history, beyond its own feedback line.

A sentence that matters to the work but lives only in prose is a sentence the
worker will never read.

**Who reads what:**
- The **host** reads `scope` (the write gate), `checks` (which registered
  commands run), `dependencies` (order), `preconditions` (`exists:` / `absent:`,
  enforced before the first turn), `weight` (progress) and `risk` (self-review
  triggers).
- The **reviewer** judges `acceptance` one criterion at a time. A criterion it
  finds unmet produces a finding. A `blocking` finding sends the task back,
  and a `minor` one becomes a correction task.

**Existing work is surveyed before every attempt.** The worker is shown which
scope files already exist, their exports and test counts, and whether the
functions the contract promises are already defined anywhere. So a plan may
include work that is partly or fully done:
- The worker builds on it.
- A write that would delete exports or tests the contract does not mention is
  refused.
- A task whose work is already there can finish as ALREADY SATISFIED, with the
  reviewer judging the existing files.

Name anything a task should deliberately remove or rename in its contract;
that is what permits it.

**Costs the plan controls:**
- Local generation runs at roughly 12 tokens a second.
- A whole-file write of 20 KB takes about 7 minutes. An `### EDIT` takes under
  one.
- Each exchange re-sends the contract, the brief and the working set.

So file size, brief size and criterion clarity are time, directly.

---

## 2. Architecture requirements: the shape of the task graph

**A1. Independent branches, not one chain.** [linear-chain]
Declare a dependency only where the code needs the other task's output. When
the loop gives up on a task it defers it for Astra and carries on with what does
not depend on it. In a chain nothing does, so one hard task ends the night.
*Evidence:* five tasks, each depending on the last; one block stopped all of
them.

**A2. Each task owns its files.** [shared-file]
Prefer a new module per task, and share through imports. At most two tasks
should write the same file.
- Test files especially: one test file per task, named after it
  (`tests/<area>-<task>.test.mjs`).
- A file several tasks append to grows with each one. Every later write costs
  more, and every later task inherits the earlier ones' bulk into its context.

*Evidence:* four tasks wrote the same module and the same test file. They grew
from 0 to 20 KB and 35 KB.

**A3. At least one check that is about this task.** [no-own-check]
Name `scope-tests` and put the task's test file in `scope`. The loop then runs
exactly that file, with no registry edit. Broad suites (`automation-tests`,
`agentic-tests`) are for regressions: add them as well, not instead.
*Evidence:* every task ran the same three checks, so none of them could say
which task was incomplete.

**A4. Checks must exist before the run.** The loader refuses unregistered names.
Adding a check means a human edit to `scripts/lib/agentic/checks.mjs`, reviewed
like code. The agent cannot add one. Prefer `scope-tests` so that no edit is
needed.

**A5. Tasks sized to finish in one sitting.**
- About 2 files written, about 300 new lines, 6–10 worker exchanges.
- No more than 8 acceptance criteria. [too-many-criteria]
- Split by seam (interface, then behaviour, then failure paths), not by file.
- The first budget is 60 minutes. The loop can extend it while the work is
  progressing, but a task that needs extending every time is two tasks.

**A6. Documentation tasks say what the reviewer checks.** [docs-task]
No registered check reads a document, so the reviewer is its only gate. Each
criterion names a section or a fact that can be found, for example "section
*Transaction states* lists each state and its on-disk file". Criteria like
"is clear" or "covers everything" cannot be checked.

**A7. Scope is the grant.** List exact files; use a directory entry
(`sandbox/`) only for genuinely new trees. Protected paths are refused at load
(`scopeFindings`). `nonScope` states what the task must not do even inside its
files, for example "do not change the record format".

**A8. Preconditions for what must already be there.** Write `exists:
path/to/file` for a file an earlier task creates, so a missing base fails before
the first turn rather than after an attempt.

---

## 3. Information requirements: what each contract must say

**I1. `objective` states the end state.** [objective-is-title]
Say what exists and is true when the task is done, not the activity. "After
this task, `reconcileDisabledAutomation` exists, never creates a job, and
reports `blocked_unknown_create` when no job id was recorded", not "Add a
reconciliation entry point".

**I2. One verifiable statement per acceptance criterion.** [compound-criterion]
A reviewer that finds one clause of a compound criterion unmet fails all of it,
and the worker cannot tell which clause.
*Evidence:* the second task was blocked twice on criterion 5, one sentence
holding six test scenarios.

**I3. Test scenarios are named, one each.** [bundled-scenarios]
Either one criterion per scenario, or one criterion ("Tests cover the scenarios
in the brief's Tests section") with the brief listing each by its exact test
title.

**I4. Every promised interface is specified.** [interface-unspecified]
For each export the acceptance promises, give the brief its exact signature,
input shape, return shape, error behaviour and, for state, the on-disk record.
*Evidence:* before briefs existed, the worker spent attempts guessing record
formats and ledger paths.

**I5. `context` is specific to the task.** [context-copied]
Name the 2–4 files to READ first and why. Shared background belongs in
`common.md`.
*Evidence:* one context paragraph was pasted into all five tasks, naming five
files per task. The working set holds eight.

**I6. Failure injection is described, not implied.** When a criterion needs a
crash, a timeout or a partial write, the brief says how to produce it: which
fake, which seam, and how the process is made to die mid-operation.
*Evidence:* the third task's test "exited at a seam" after the operation had
completed, so it proved nothing and failed.

**I7. `escalateWhen` lists the real decisions a human must make.** Generic
lines ("scope is insufficient") are already handled by the loop. List the
domain ones, such as "the installed scheduler's read-back format differs from
the fixture".

**I8. No instructions the worker cannot follow.** It cannot run arbitrary
commands, read outside the worktree, or see other tasks. "Read HANDOFF.md",
"run the full suite" and "check with Nick" do nothing.

---

## 4. Briefs

Beside the plan: `<plan>.briefs/common.md` and `<plan>.briefs/<task-id>.md`.
They are loaded by the host, capped at 18,000 characters per task (common plus
own), and part of the contract's digest. [no-briefs, no-common-brief, no-brief]
Every claim in a brief is checked against the code before the run. A wrong
brief costs more than no brief.

**`common.md`**, 3–6 KB:
1. **Goal**, 3–5 lines: what the batch is for. The plan's goal prose never
   reaches the model, so this is its only copy.
2. **Files**: the full paths every task touches or reads, and what each is for.
3. **Shared formats**: records, ledgers, errors, naming.
4. **Tests**: how tests are written here (temp roots, fakes, fixture helpers)
   and the file per task.
5. **Working in this loop**:
   - `### EDIT` for existing files, `### FILE` only for new ones;
   - checks run after every write;
   - READ at most 3–4 files per exchange;
   - keep code and tests compact;
   - no triple backticks inside file contents.

**`<task-id>.md`**, 4–10 KB, in this order:
1. **Where you start**: what exists at HEAD when this task begins, and what
   earlier tasks produced.
2. **Interface**: exact signatures, inputs, returns and errors (I4).
3. **Decisions**: the behaviour for each case, as a decision list or table.
   This is where compound acceptance is unpacked.
4. **Tests**: each scenario by test title, with how it is set up and what it
   asserts (I3, I6).
5. **Exchange plan**: a suggested order, for example "EDIT the module; EDIT
   the tests; DONE".
6. **Traps**: what a previous attempt, or a plausible guess, gets wrong.
7. **For the reviewer**: the facts to judge the diff against, and what not to
   flag.

---

## 5. Plan file layout

```
# <Title> — agent work backlog
**Owner** · **Prepared** · **Purpose**

## Goal                      (for people; its short form goes in common.md)
## Starting point            (what exists, verified; what does not)
## How this becomes work     (one orion-plan block)
## Phase A — <seam>          (prose for people, then its orion-task blocks)
## Next batch (not executable)
## What Astra reviews
## Progress rules
```

A task block, with the fields this standard adds:

    ```orion-task
    {
      "id": "area-seam",
      "title": "Short imperative title",
      "objective": "After this task, <what exists and is true>.",
      "context": "READ first: <file> (why), <file> (why).",
      "scope": ["scripts/lib/area-seam.mjs", "tests/area-seam.test.mjs"],
      "nonScope": ["Do not change <shared format>."],
      "constraints": ["<architectural rule this task must keep>"],
      "preconditions": ["exists: scripts/lib/area-base.mjs"],
      "acceptance": [
        "Exports seam(options) with the signature in the brief.",
        "<one behaviour, verifiable from the diff or a named test>",
        "Tests cover every scenario listed in the brief's Tests section, by title."
      ],
      "checks": ["node-syntax", "scope-tests", "<regression suite>"],
      "dependencies": ["area-base"],
      "weight": 2,
      "risk": "medium",
      "reviewDepth": "standard",
      "escalateWhen": ["<a domain decision only a human can make>"]
    }
    ```

---

## 6. Before a plan is run

1. `scripts/orion-agent plan <file>` exits 0, with no `scopeFindings` and no
   lint `error`s. Every `warn` is either fixed or has a stated reason.
2. Each task's `checks` pass on the base commit where they should, and the new
   test files do not exist yet where they should not.
   `git archive HEAD` is what the worktree forks from, not the dirty tree.
3. Every brief claim has been checked against the code (signatures, paths,
   record fields).
4. Walk the graph: which tasks still run if each one is deferred?
5. Import it (`scripts/orion-projects add`), whose output repeats the lint, and
   start it.

## 7. What the machine checks, and what it does not

| Checked by | What |
|---|---|
| Loader (refuses) | JSON, ids, cycles, unknown checks, protected scope, brief size, orphan brief files |
| Lint (advises) | A1 linear-chain, A2 shared-file, A3 no-own-check, A6 docs-task, I1 objective-is-title, A5 too-many-criteria, I2 compound-criterion, I3 bundled-scenarios, I4 interface-unspecified, I5 context-copied, briefs present, scope-tests without a test file (error) |
| Author and Astra | Right-sized tasks, true briefs, meaningful criteria, failure injection described, real escalation conditions |
