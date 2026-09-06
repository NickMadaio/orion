# Evaluation report — "I have something this Friday"

Nick's ask, verbatim: *"do actual tests. i have something this friday, if you were
orion, what would YOU do, then give it to orion and see what he does. compare the
two, fix orion's faults."*

## The headline

| | runs | mean | answers |
|---|---|---|---|
| **Before** (2026-09-05) | 4 | **55.4 / 100** | Sep 5, Sep 12, Sep 5, "Sep 5 — that's today" |
| **After** (2026-09-06) | 5 | **83.7 / 100** | Sep 11 × 5 |

The eval ran on Saturday 2026-09-05. "This Friday" was **Friday 2026-09-11**.

**All four baseline answers were wrong, in three different ways, from identical
state.** Two of them asserted that a Saturday was a Friday — Sep 5 and Sep 12 are
both Saturdays. This is worse than the 2026-09-02 review reported, because that
review saw one run and this saw four: the fault is not a slip, it is that Orion
had no grounded clock and was doing weekday arithmetic from memory.

An independent grader (ChatGPT, 2026-09-02, different session, different rubric)
scored the same fixture **52/100**. This harness now scores that era **55.4**.
Two graders arriving at the same number by different routes is the best evidence
available that the rubric measures something real.

## What the trace showed, which the score did not

Recovered from the session transcripts:

| run | what Orion actually ran |
|---|---|
| baseline 0,1,3 | `orion-agenda upcoming` |
| baseline 2 | `orion-agenda friday` → **exec failed**, then `orion-agenda upcoming` |
| all five after | `orion-agenda day Friday` |

Baseline run 2 is the whole diagnosis in one line. Orion reached for
`orion-agenda friday` — a subcommand that did not exist — because the tool he
had could only answer "today" or "everything ahead". He was not being careless;
he was asking for the capability that was missing, and falling back to the
generic query when it was refused.

## The three repairs

**1. `orion-agenda day <date|weekday|today|tomorrow>`.** A real query for one
named day. A bare weekday means its next occurrence counting today as day zero,
which is what "this Friday" means to a person and the only reading that never
resolves into the past.

**2. Every subcommand prints the date first.**

```
$ scripts/orion-agenda day friday
today is Sunday, September 6, 2026
asked about Friday, September 11, 2026 — 5 days from today
nothing on the calendar that day
```

Suppressed under `--json`, because that output is parsed by other programs and a
fingerprint carrying today's date is a fingerprint that changes at midnight.

**3. A `## Dates` rule in Orion's operating instructions**: never work out a
date, a weekday or a day count in your head; read it from tool output. A date the
model read out of a tool is a fact. A date it inferred is a guess that looks
exactly like a fact, which is why four wrong answers all sounded confident.

Orion adopted `day` on the very next run and has used it in all five since.

## Four defects in the harness itself, found while using it

A test that lies costs more than no test. All four of these were making the eval
report the wrong thing:

1. **The side-effect assertion accused Orion of mutating the calendar.** It
   compared raw stdout of `orion-agenda upcoming --json`; the bridge serialises a
   Swift dictionary, whose key order is undefined, so two reads of an unchanged
   calendar differ as strings. Three read-only runs were marked INVALID with "an
   eval run mutated Nick's real state". Fixed by normalising JSON key order
   before comparison — order only, never content.

2. **`replayInvalid` was read as "this run cannot be trusted".** It is not.
   OpenClaw's own type declares it as *"tracks whether an embedded run can be
   replayed after compaction or retry"*, carried with `hadPotentialSideEffects`,
   and its blocked-reasons are `tool_activity | potential_side_effect |
   active_item`. **Every run that calls a tool sets it, on the ordinary success
   path.** Read as a validity flag it made all nine runs permanently INVALID.
   The 2026-09-02 review made the same misreading and the fixture inherited it.
   It now fails a run only when the turn's own liveness says it did not finish.

3. **The tool-call parser matched nothing.** It looked for `tool_use` blocks with
   `input`; OpenClaw writes `toolCall` with `arguments`. So every run recorded an
   empty tool list while `openclaw audit` plainly showed `tool.action.started:exec`
   — the tool-selection dimension was scoring real behaviour against no evidence.

4. **The rubric passed the exact failure it was written for.** `does_not_misdate_friday`
   only caught September 6–10, so "Friday (Sep 5)" and "September 12th" both
   passed it. The corrected pattern was then verified against all nine stored
   answers before being written: it must catch all four baselines and clear all
   five post-fix runs, and it does. The tool check also rewarded the generic
   `upcoming` while looking for `orion-agenda date`, a subcommand that never
   existed.

Replay re-derives tool calls and fingerprint verdicts from the stored transcripts
rather than trusting the frozen fields, so a harness repair re-scores history
instead of freezing a bad derivation.

## Still broken

**Orion never checks reminders.** `checked_reminders_too` fails in all nine runs.
Asked "I have something this Friday" he looks at the calendar and stops — but
"something" is at least as likely to be a reminder or a task. `orion-agenda tasks`
exists and he does not reach for it. This is the next repair, and it is a routing
problem, not a capability gap.

## Running it again

```
scripts/orion-eval replay                      # offline, re-scores every stored run
scripts/orion-eval run friday-something --repeat 3   # live, costs money
scripts/orion-eval report
```
