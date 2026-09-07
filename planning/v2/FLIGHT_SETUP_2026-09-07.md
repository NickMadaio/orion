# The flight setup — measured, not assumed

Nick is flying for seven hours and wants Orion to keep working with no network.

## The model, and a correction

I recommended `qwen3.6:27b` earlier on wall-clock over a tiny prompt. That was
the wrong metric. For a long unattended run the number is **tokens per second**,
and Ollama's own server log reports it:

| model | tokens/sec on this M5 Pro | quantization |
|---|---:|---|
| **gpt-oss:20b** | **~30** | MXFP4 |
| qwen3.6:27b | 5.2 | Q4_K_M |
| qwen3:30b | ~5 (plus 15k thinking tokens) | Q4_K_M |

**Nearly six times.** MXFP4 is natively accelerated on Apple silicon and Q4_K_M
is not — a hardware fact, not a statement about which model is smarter. Over
seven hours it is the difference between roughly twenty tasks and roughly a
hundred, and it means gpt-oss can afford to think and still be faster than the
27b not thinking.

The earlier "501 seconds per generation" was also wrong, and wrongly attributed:
two jobs were hitting Ollama at once. **Ollama serialises requests to a model**,
so a benchmark running beside the coder makes both crawl. The flight loop has to
be the only consumer of the GPU.

## What was proven, end to end, offline

`qwen3.6:27b` was given a real task against a real file and its work was read
rather than trusted:

```
attempt 1/2 — asking qwen3.6:27b…
wrote 7020 chars after 392s; running: npm test
PASSED and checkpointed after 1 attempt(s)
```

Nine insertions, zero deletions, placed exactly where the task said, using the
function's existing local variables, with a comment in the file's own style, and
the other 329 tests still green. That is competent work, unassisted, with no
cloud.

## How it is bounded

- a **git worktree** on branch `orion-selfdev` — the tree Nick left is untouched;
- **whole files, never diffs** — a 27B produces diffs with wrong line numbers and
  overlapping hunks, each one a silent no-op or a mangled file. A complete file
  has one failure mode instead of five;
- the **installed** plugin's forbidden-surface table, via
  `scripts/lib/orion-selfdev-policy.mjs`. The model cannot edit the approval
  verifier, the policy evaluator, the audit ledger or `orion/security/**`, and
  cannot widen that list without a human deploying first — checking a proposed
  edit against the policy it would introduce is how a change would authorise
  itself;
- a **check that must pass** before anything is committed, and a check that
  cannot RUN is never reported to the model as a check that failed;
- it **never pushes and never installs**. Landing the work is a decision made on
  the ground.

## Two bugs that only running it could find

**A fresh worktree has no `node_modules`**, so every check exited 127 and the
model was handed "command not found" as if it were a compiler error and asked to
fix code that was fine. Dependencies are symlinked now — not `npm ci`, which
needs a network there will not be.

**The four compile-time personality proofs had no stated timeout.** Each boots
the real TypeScript compiler: 1–3s warm, 8–16s cold, against Vitest's 5s default.
They passed on this machine and failed in the worktree — four failures, not one
wrong assertion. A test whose verdict depends on the page cache proves nothing.

## Running it

```
orion-code add "<task>" --file <path> --check "npm test"
orion-code flight --hours 7
orion-code status
```

The report is rewritten after **every** task, not at the end, so a sleep or a
flat battery still leaves an account of what happened. It records what passed,
what did not, how long each took, and whether the network was there at the time.
