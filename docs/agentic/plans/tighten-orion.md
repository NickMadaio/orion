# Tighten ORION — agent work backlog

**Owner:** Nick · **Prepared:** 29 September 2026 (Claude) · **Purpose:** close the detail-level gaps a 76-scenario review found, as pure tested Node modules Claude wires in after review.

## Goal
The scenario review (60 scenarios, 16 re-runs, 29 September) showed ORION mostly right and fast, with the remaining problems in the details: tool narration and mixed time formats in replies, false "can't" and false "done", plans mis-parsed from what Nick said, deadlines with no study behind them, no morning message, no rule for doomscrolling, and patterns it records but cannot describe. Each task below is one self-contained module with its own tests. None edits an existing file or touches the live system.

## Starting point
- Committed at HEAD: scripts/lib/life/ core modules (block, priority, patterns, fit-study, …). This batch imports none of them; every module is standalone.
- Nothing under scripts/lib/remote/ or scripts/lib/eval/ exists; every path written here is new.
- Wiring (orion-remote, orion-checkin, orion-watch, the phone) is Claude's, after review.

## How this becomes work
```orion-plan
{"project":"Tighten ORION","options":{"maxAttempts":3,"maxCorrectionDepth":2}}
```

## Tasks
Independent: any task can be deferred without blocking another.

### Reply linter

```orion-task
{
  "id": "reply-lint",
  "title": "Reply linter",
  "objective": "After this task, scripts/lib/remote/reply-lint.mjs exports RULES, lintReply, fixReply and clock12; lintReply flags tool narration, 24-hour and mixed time formats, spoken markdown, spoken length and repeated sentences, and fixReply rewrites the fixable ones deterministically.",
  "context": "READ tighten-orion.briefs/reply-lint.md for the six rules and the real 29 September replies each must catch; common.md only for the 12-hour clock convention.",
  "scope": [
    "scripts/lib/remote/reply-lint.mjs",
    "tests/tighten-reply-lint.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new.",
    "Do not import another task's module."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only; no network, no filesystem access in library code."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section, in the stated order.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

### Action and inability claims

```orion-task
{
  "id": "claims",
  "title": "Action and inability claims",
  "objective": "After this task, scripts/lib/remote/claims.mjs exports classifyClaim, which labels a reply done, cant or none with the matched phrase, treats data absence as none, and sets needsCheck only when a claim was made with no tool run.",
  "context": "READ tighten-orion.briefs/claims.md: its Decisions are ordered and its test replies are verbatim from the 29 September runs; data absence must win over inability.",
  "scope": [
    "scripts/lib/remote/claims.mjs",
    "tests/tighten-claims.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new.",
    "Do not import another task's module."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only; no network, no filesystem access in library code."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section, in the stated order.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

### Scenario run grader

```orion-task
{
  "id": "eval-grade",
  "title": "Scenario run grader",
  "objective": "After this task, scripts/lib/eval/grade.mjs exports gradeRow and gradeRun, and scripts/orion-eval-grade grades a run file against optional expectations, printing failures and exiting 0, 1 or 2 as the brief states.",
  "context": "READ tighten-orion.briefs/eval-grade.md for the run-row format, the failure strings (part of the interface) and the CLI exit codes; common.md for how CLI tests spawn scripts.",
  "scope": [
    "scripts/lib/eval/grade.mjs",
    "scripts/orion-eval-grade",
    "tests/tighten-eval-grade.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new.",
    "Do not import another task's module."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only; no network, no filesystem access in library code."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section, in the stated order.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

### Start lateness patterns

```orion-task
{
  "id": "lateness",
  "title": "Start lateness patterns",
  "objective": "After this task, scripts/lib/life/lateness.mjs exports lateness and delayOf, computing per-kind, per-weekday and per-band start delays, a trend, and one sentence for Nick exactly as the brief words it.",
  "context": "READ tighten-orion.briefs/lateness.md for the history record format, the midnight wrap, the bands and the exact sentence wording.",
  "scope": [
    "scripts/lib/life/lateness.mjs",
    "tests/tighten-lateness.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new.",
    "Do not import another task's module."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only; no network, no filesystem access in library code."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section, in the stated order.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

### Study ramp before deadlines

```orion-task
{
  "id": "deadline-ramp",
  "title": "Study ramp before deadlines",
  "objective": "After this task, scripts/lib/life/deadline-ramp.mjs exports NEEDS, deadlineKind and ramp, which spreads the remaining study for each deadline over the days before it, increasing toward the deadline, capped per day, never on the deadline day.",
  "context": "READ tighten-orion.briefs/deadline-ramp.md for NEEDS, the per-kind windows, the 1..n weighting with rounding to 15, and the per-day cap that spills earlier.",
  "scope": [
    "scripts/lib/life/deadline-ramp.mjs",
    "tests/tighten-deadline-ramp.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new.",
    "Do not import another task's module."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only; no network, no filesystem access in library code."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section, in the stated order.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

### Plans from what Nick says

```orion-task
{
  "id": "plan-parse",
  "title": "Plans from what Nick says",
  "objective": "After this task, scripts/lib/life/plan-parse.mjs exports parsePlans and DEFAULT_MINUTES, turning one sentence of plans into ordered items with title, kind, date, start, minutes, fixed and assumed, as the brief specifies.",
  "context": "READ tighten-orion.briefs/plan-parse.md for the clause splitting, date and bare-hour rules, kind words and titles; every test item is compared field by field.",
  "scope": [
    "scripts/lib/life/plan-parse.mjs",
    "tests/tighten-plan-parse.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new.",
    "Do not import another task's module."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only; no network, no filesystem access in library code."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section, in the stated order.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

### Morning message

```orion-task
{
  "id": "morning-brief",
  "title": "Morning message",
  "objective": "After this task, scripts/lib/life/morning-brief.mjs exports morningBrief and clock12, producing a phone message of at most 300 characters from sleep, the first fixed event, the day's shape, the nearest deadline, the side-project hour and rain, in the brief's order and wording.",
  "context": "READ tighten-orion.briefs/morning-brief.md for the six parts in order, their exact wording and the 300-character trimming order.",
  "scope": [
    "scripts/lib/life/morning-brief.mjs",
    "tests/tighten-morning-brief.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new.",
    "Do not import another task's module."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only; no network, no filesystem access in library code."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section, in the stated order.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

### Distraction rules

```orion-task
{
  "id": "distraction",
  "title": "Distraction rules",
  "objective": "After this task, scripts/lib/life/distraction.mjs exports decide, which returns none, nudge or lock with a reason and lock length for recent phone use, protecting breaks, escalating after two nudges, and never locking in free time or without permission.",
  "context": "READ tighten-orion.briefs/distraction.md for the ordered rules, the midnight bedtime case and the lock-length bounds.",
  "scope": [
    "scripts/lib/life/distraction.mjs",
    "tests/tighten-distraction.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new.",
    "Do not import another task's module."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only; no network, no filesystem access in library code."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section, in the stated order.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

## Next batch (not executable)
- Wire reply-lint's fixReply into orion-remote's reply path, and lintReply into the eval grader.
- Swap orion-remote's truth check to claims.classifyClaim.
- orion-patterns and check-in messages from lateness; morning push from morning-brief via orion-watch; deadline-ramp into fill-day; plan-parse into orion-reschedule day; distraction rules into a DeviceActivity monitor on the phone.

## What Astra reviews
Each module against its brief: interface, the Decisions list in order, and every named test. User-facing wording is exact.

## Progress rules
A task is done when its scope tests pass and the reviewer accepts the diff. Deferred tasks go to Claude.
