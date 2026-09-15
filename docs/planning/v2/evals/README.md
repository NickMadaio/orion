# docs/planning/v2/evals — the evaluation harness

Nick's ask, in his words:

> "do actual tests. i have something this friday, if you were orion, what would
> YOU do, then give it to orion and see what he does. compare the two, fix
> orion's faults"

This directory is that, made permanent. It is not a test suite in the usual
sense: it does not assert that a function returns 4. It asserts that the whole
assistant — clock, tools, self-knowledge, tone — behaves the way a competent
human operator with the same authority would have behaved on a real request.

## The discipline, which is the whole point

**The reference operator plan is written BEFORE Orion is run, and is never
revised afterwards.** A plan written after seeing the answer scores the answer
against itself, and every model looks excellent under that. Each fixture's `.md`
carries a `frozen:` line with the timestamp at which the plan was sealed and the
timestamp of the first live run against it. If the first is not earlier than the
second, the comparison is worthless and `orion-eval` says so
(`assert_reference_plan_predates_run`).

## A fixture is a JSON/Markdown pair

`fixtures/<id>.json` is what the runner executes. `fixtures/<id>.md` is the
reference operator plan a human reads. Both are required; the runner refuses a
fixture missing either half.

### The JSON half

| field | meaning |
|---|---|
| `id` | must equal the filename stem |
| `title` | one line, for the report |
| `prompt` | the EXACT text sent to Orion. Never templated at run time — a prompt that varies is not a fixture |
| `sessionKeyPrefix` | `orion-eval-<fixture>`; the runner appends a timestamp. **Never `orion-app-v2`**, which is Nick's live desktop conversation |
| `timeoutSeconds` | passed to `openclaw agent --timeout` |
| `clock` | the frozen assumptions: `assumedDate`, `assumedWeekday`, `homeTimezone`, and `whyItMatters`. The runner ASSERTS the machine's real date matches `assumedDate` and refuses to run otherwise — a fixture whose clock assumption has expired scores nothing |
| `context` | facts about the world the fixture depends on, each with the file that proves it |
| `authority` | `permissionProfile`, `strictnessMode`, and `verifyWith` — a command whose output must contain them. Asserted live before the run |
| `sideEffects.allowed` | what this fixture permits. For every fixture here: reads only |
| `sideEffects.forbidden` | named effects that must not happen |
| `sideEffects.verification` | how absence is PROVEN, not assumed. Each entry is a `fingerprint` command run before and after; a change fails `assert_no_side_effects` |
| `referencePlan` | the machine-checkable skeleton of the `.md`: `mustResolve`, `mustQuery`, `mustSay`, `mustNotSay` |
| `rubric` | dimensions, each with `points` and a list of named `checks` |
| `hardAssertions` | named conditions that invalidate a run outright regardless of score |

### Checks: every "passes" has a name

A rubric check is one of these predicates. The runner records the check's
`name`, its verdict, and the evidence it matched on, so a score is always
traceable to a sentence in the transcript or a row in the trace.

| kind | evidence source | meaning |
|---|---|---|
| `answer_matches` | final answer text | one of `patterns` (regex, case-insensitive) is present |
| `answer_not_matches` | final answer text | NONE of `patterns` is present |
| `tool_called` | session transcript tool arguments | a tool call whose rendered command matches |
| `tool_not_called` | session transcript tool arguments | no tool call matches |
| `tool_count_at_most` | audit trace | at most `n` tool actions started |
| `elapsed_under` | agent result `durationMs` | wall-clock ceiling in seconds |
| `no_silence_gap_over` | audit trace timestamps | the largest gap between consecutive trace events, in seconds |
| `ledger_unchanged` | `sideEffects.verification` fingerprints | nothing this fixture forbids actually happened |
| `manual` | a human | scored by the person running it, who MUST write `justification` into the run record. An unscored `manual` check counts as ZERO, never as a pass |

### Why the trace comes from two places, and what each can prove

`openclaw audit --session agent:main:<key> --json` is the authoritative run
record: ordered `agent_run` and `tool_action` events with timestamps, statuses
and run ids. It is **metadata-only by design** — `toolName` is `exec`, and the
command that `exec` ran is not in it. So audit can prove *how many* tool calls
happened, *when*, and whether any failed. It cannot prove *which day Orion asked
the calendar about*.

That evidence lives in the session transcript OpenClaw writes at
`~/.openclaw/agents/main/sessions/<sessionId>.jsonl`, whose `toolCall` entries
carry the actual arguments. The runner captures both and says which check read
which. A `tool_called` check backed only by audit would be a check that cannot
fail, and this harness does not ship one.

## Run records

`runs/<id>-<utc timestamp>.json` holds: the fixture id and a sha256 of the
fixture at run time, the session key, the run id and session id, elapsed time,
every tool call in order with arguments and timings, the final answer verbatim,
the raw agent `meta`, the side-effect fingerprints before and after, and every
check with its verdict and evidence.

**A run record is replayable.** `orion-eval replay` re-scores every stored run
with the CURRENT rubric and no model call at all. That is the part that runs in
CI: it catches a rubric edit that would have changed a historical verdict, and
it costs nothing. The live run stays manual, because it costs money and touches
Nick's real Mac.

## Hard assertions

These are not rubric points. A run that fails one is `INVALID` and its score is
not comparable to anything.

- `assert_status_ok` — the agent turn reported success.
- `assert_replay_not_invalid` — **`meta.replayInvalid: true` is never a clean
  pass.** OpenClaw sets it when a turn's terminal event went missing and the
  turn had tool activity or potential side effects, alongside
  `livenessState: "abandoned"` or `"blocked"`. A run in that state has an
  unknown relationship to what actually executed. On 2026-09-02 a run was
  scored 52/100 while carrying it; that number described a run nobody could
  reconstruct.
- `assert_no_side_effects` — every fingerprint in `sideEffects.verification` is
  byte-identical before and after.
- `assert_clock_assumption_holds` — the machine's date equals `clock.assumedDate`.
- `assert_authority_as_declared` — the live profile and mode are what the
  fixture says they are.
- `assert_isolated_session` — the session key is not `orion-app-v2`, not the
  main session, and did not already exist.
- `assert_reference_plan_predates_run` — see the top of this file.

## Running it

```bash
scripts/orion-eval list                                  # fixtures and their runs
scripts/orion-eval check                                 # fixtures well-formed? (offline)
scripts/orion-eval run friday-something                  # ONE live run, costs money
scripts/orion-eval run friday-something --repeat 3       # reliability, not one lucky pass
scripts/orion-eval replay                                # re-score every stored run, offline
scripts/orion-eval report --since 2026-09-05             # the scored table
```

`check` and `replay` make no model call and touch nothing live; they are what
`scripts/orion_v2_ci_check.sh` runs. `run` is manual and always will be.
