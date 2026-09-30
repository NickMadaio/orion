# ORION truthful — agent work backlog

**Owner:** Nick · **Prepared:** 30 September 2026 (Claude) · **Purpose:** the pure, tested modules behind making ORION's to-do handling, tool use and replies trustworthy, plus the notification gate's decision logic.

## Goal
On 30 September Nick texted a four-item to-do list. ORION created no reminders, booked every item as a fixed block at invented times straight after class, and replied with times that did not match what he booked. This batch builds: a to-do parser that never invents times, a session-trace parser that proves which tools ran, a check that reply times match bookings, notification triage for the planned "ORION gate", and a 150-scenario catalog to test all of it. Each task is one self-contained module with its own tests. None edits an existing file or touches the live system.

## Starting point
- Existing and untouched: scripts/lib/eval/grade.mjs, scripts/lib/remote/claims.mjs, scripts/lib/remote/reply-lint.mjs, scripts/lib/life/plan-parse.mjs. This batch imports none of them.
- Nothing under scripts/lib/notify/ exists; every path written here is new.
- Wiring (orion-reschedule to-do path, orion-eval-run, orion-remote reply check, the Mac notification reader, the phone) is Claude's, after review.

## How this becomes work
```orion-plan
{"project":"ORION truthful","options":{"maxAttempts":3,"maxCorrectionDepth":2}}
```

## Tasks
Independent: any task can be deferred without blocking another.

### To-do parser

```orion-task
{
  "id": "todo-parse",
  "title": "To-do parser",
  "objective": "After this task, scripts/lib/life/todo-parse.mjs exports parseTodos, which turns a texted to-do list into tasks with minutes, optional flags and due dates, and never invents a clock time or marks a task fixed unless Nick said a time.",
  "context": "READ orion-truthful.briefs/todo-parse.md; test 1 is Nick's real 30 September message and test 6 is the failure being fixed.",
  "scope": [
    "scripts/lib/life/todo-parse.mjs",
    "tests/truthful-todo-parse.test.mjs"
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

### Session trace and tool expectations

```orion-task
{
  "id": "trace",
  "title": "Session trace and tool expectations",
  "objective": "After this task, scripts/lib/eval/trace.mjs exports parseTrace and expectTools: parseTrace turns an OpenClaw session JSONL into turns with the tool calls ORION really made and their results, and expectTools grades a turn against mustRun, mustNotRun, mustInclude, mustNotInclude, maxCalls and noErrors.",
  "context": "READ orion-truthful.briefs/trace.md; the log format in it is copied from a real 30 September session.",
  "scope": [
    "scripts/lib/eval/trace.mjs",
    "tests/truthful-trace.test.mjs"
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
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

### Reply times against bookings

```orion-task
{
  "id": "reply-times",
  "title": "Reply times against bookings",
  "objective": "After this task, scripts/lib/remote/reply-times.mjs exports checkReplyTimes and mentions, which find every clock time in a reply and flag any that does not match the start or end of the booked block it refers to.",
  "context": "READ orion-truthful.briefs/reply-times.md; test 1 is the real 4:00 PM versus 2:30 PM mismatch.",
  "scope": [
    "scripts/lib/remote/reply-times.mjs",
    "tests/truthful-reply-times.test.mjs"
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

### Notification triage and digest

```orion-task
{
  "id": "triage",
  "title": "Notification triage and digest",
  "objective": "After this task, scripts/lib/notify/triage.mjs exports triage, which decides now, digest or drop for a phone notification (VIPs, urgent words, school, money with an amount, promo, duplicates, quiet hours), and digest, which groups the held ones into one short message.",
  "context": "READ orion-truthful.briefs/triage.md; the rules are ordered and first match wins.",
  "scope": [
    "scripts/lib/notify/triage.mjs",
    "tests/truthful-triage.test.mjs"
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
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

### 150-scenario catalog and validator

```orion-task
{
  "id": "scenarios",
  "title": "150-scenario catalog and validator",
  "objective": "After this task, scripts/eval/scenarios-2026-09-30.json holds at least 150 realistic messages in Nick's texting style with expectations, and scripts/lib/eval/scenario-check.mjs exports checkCatalog, which validates ids, kinds, risky items, follow-up links, tool-expectation keys and per-area minimums.",
  "context": "READ orion-truthful.briefs/scenarios.md for the format, the area minimums and the exact error prefixes.",
  "scope": [
    "scripts/eval/scenarios-2026-09-30.json",
    "scripts/lib/eval/scenario-check.mjs",
    "tests/truthful-scenarios.test.mjs"
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
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief's Decisions and its named Tests cannot both be satisfied for some input."
  ]
}
```

## Next batch (not executable)
- todo-parse into orion-reschedule: reminders plus movable blocks, and a SAY line the reply must use.
- trace + expectTools into orion-eval-run; reply-times into orion-remote after any booking.
- triage behind a Mac reader of mirrored iPhone notifications, pushed as ORION notifications; the ORION Focus mode on the phone.
- Run the 150-scenario catalog and fix what fails.

## What Astra reviews
Each module against its brief: interface, the Decisions list in order, and every named test. Failure strings are exact.

## Progress rules
A task is done when its scope tests pass and the reviewer accepts the diff. Deferred tasks go to Claude.
