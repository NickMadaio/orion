# ORION truthful 2 — agent work backlog

**Owner:** Nick · **Prepared:** 1 October 2026 (Claude) · **Purpose:** three more pure, tested modules found on the night of 30 September: consistent extra-phone-time decisions, replies that talk to Nick rather than about him, and an evening review of planned against done.

## Goal
On the night of 30 September ORION gained the ability to see and ease the phone's app lock, and its decisions varied from refusing to granting the same ask within the hour; one reply called Nick "he". Nothing yet compares the day ORION planned with what happened. Each task below is one self-contained module with its own tests. None edits an existing file or touches the live system.

## Starting point
- Independent of the first ORION truthful project; imports none of its modules.
- Wiring (orion-phone-time, orion-remote's reply fixer, orion-watch's evening message) is Claude's, after review.

## How this becomes work
```orion-plan
{"project":"ORION truthful 2","options":{"maxAttempts":3,"maxCorrectionDepth":2}}
```

## Tasks
Independent: any task can be deferred without blocking another.

### Extra phone time policy

```orion-task
{
  "id": "grant-policy",
  "title": "Extra phone time policy",
  "objective": "After this task, scripts/lib/life/grant-policy.mjs exports decideGrant, which decides how many minutes of extra phone time to give (0 to 60) from the time, the lock, his reason, his first commitment and how many grants he has had tonight, with the exact sentence ORION says.",
  "context": "READ orion-truthful.briefs/grant-policy.md; the Decisions are ordered and the say strings are exact.",
  "scope": [
    "scripts/lib/life/grant-policy.mjs",
    "tests/truthful-grant-policy.test.mjs"
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

### Talk to him, not about him

```orion-task
{
  "id": "reply-person",
  "title": "Talk to him, not about him",
  "objective": "After this task, scripts/lib/remote/reply-person.mjs exports findThirdPerson and toSecondPerson, which find and rewrite replies that refer to Nick as he/his/Nick into you/your, with verb agreement, leaving other people and quoted text alone.",
  "context": "READ orion-truthful.briefs/reply-person.md; test 1 is the real 2026-10-01 reply.",
  "scope": [
    "scripts/lib/remote/reply-person.mjs",
    "tests/truthful-reply-person.test.mjs"
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

### Planned against done

```orion-task
{
  "id": "day-review",
  "title": "Planned against done",
  "objective": "After this task, scripts/lib/life/day-review.mjs exports reviewDay, which compares ORION's planned blocks with check-ins and ticked-off to-dos and returns counts, slipped blocks, median lateness and a short evening message.",
  "context": "READ orion-truthful.briefs/day-review.md for the matching rules and the exact message shape.",
  "scope": [
    "scripts/lib/life/day-review.mjs",
    "tests/truthful-day-review.test.mjs"
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
- grant-policy into orion-phone-time; reply-person into orion-remote's reply fixer; day-review as the evening message from orion-watch.

## What Astra reviews
Each module against its brief: interface, the Decisions list in order, and every named test. User-facing wording is exact.

## Progress rules
A task is done when its scope tests pass and the reviewer accepts the diff. Deferred tasks go to Claude.
