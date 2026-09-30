# Life loop — plan → remind → observe → intervene → follow up → adapt

**Owner:** Nick · **Prepared:** 29 September 2026 (Claude) · **Purpose:** the decision logic behind ORION's mission (docs/vision/ORION_PURPOSE.md), as pure tested modules the apps can call.

## Goal
Build the parts of the life loop that are logic, not wiring: Nick's priorities, his weekly timetable, fitting study time into a day, bedtime pressure, the follow-through escalation state machine, reading excuses, adjusting tomorrow after a late night, learning timing patterns, the phone↔Mac offline sync event format, and "what should Nick do next". Claude wires them into the phone, notifications and the brain after review.

## Starting point
- Nothing under scripts/lib/life/ exists; every path this plan writes is new.
- Related existing work: scripts/lib/attention/ (attention scoring), native/OrionMobile/Sources/MobileCore/TodayPlanScheduler.swift (the Swift day planner, not edited here).

## How this becomes work
```orion-plan
{"project":"Life loop","options":{"maxAttempts":3,"maxCorrectionDepth":2}}
```

## Tasks

### Block shape and validation

```orion-task
{
  "id": "life-block",
  "title": "Block shape and validation",
  "objective": "After this task, scripts/lib/life/block.mjs exports KINDS, SOURCES, validateBlock, normalizeBlock and blockMinutes, accepting exactly the block shape in the common brief.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-block.md.",
  "scope": [
    "scripts/lib/life/block.mjs",
    "tests/life-block.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
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
  "escalateWhen": []
}
```

### Priority ranking

```orion-task
{
  "id": "life-priority",
  "title": "Priority ranking",
  "objective": "After this task, scripts/lib/life/priority.mjs exports priorityOf and comparePriority implementing Nick's priority order, with fixed blocks always outranking movable ones.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-priority.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/priority.mjs",
    "tests/life-priority.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-block"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Weekly recurring schedule expansion

```orion-task
{
  "id": "life-weekly",
  "title": "Weekly recurring schedule expansion",
  "objective": "After this task, scripts/lib/life/weekly.mjs expands a weekly template (like Nick's class timetable) into dated blocks for any date, honouring an active date range and skipped dates.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-weekly.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/weekly.mjs",
    "tests/life-weekly.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-block"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Daily non-negotiables

```orion-task
{
  "id": "life-template-daily",
  "title": "Daily non-negotiables",
  "objective": "After this task, scripts/lib/life/daily-needs.mjs reports which daily needs (sleep window, 60 min side project, gym on gym days, meals, rest) a day's blocks satisfy and which are missing.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-template-daily.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/daily-needs.mjs",
    "tests/life-daily-needs.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-block"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Free gaps in a day

```orion-task
{
  "id": "life-gaps",
  "title": "Free gaps in a day",
  "objective": "After this task, scripts/lib/life/gaps.mjs finds the free intervals between blocks inside a waking window, with an optional buffer around fixed blocks.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-gaps.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/gaps.mjs",
    "tests/life-gaps.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-block"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Parse a study request

```orion-task
{
  "id": "life-study-parse",
  "title": "Parse a study request",
  "objective": "After this task, scripts/lib/life/study-request.mjs turns sentences like 'schedule 2 hours of study for macro before friday' into a structured request.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-study-parse.md.",
  "scope": [
    "scripts/lib/life/study-request.mjs",
    "tests/life-study-request.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
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
  "escalateWhen": []
}
```

### Fit study time into a day

```orion-task
{
  "id": "life-fit-study",
  "title": "Fit study time into a day",
  "objective": "After this task, scripts/lib/life/fit-study.mjs places study sessions into a day by using free gaps first and then moving lower-priority movable blocks, never touching classes, sleep or fixed blocks, and reports every move.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-fit-study.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/fit-study.mjs",
    "tests/life-fit-study.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-priority",
    "life-gaps"
  ],
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Infer sleep state

```orion-task
{
  "id": "life-sleep-state",
  "title": "Infer sleep state",
  "objective": "After this task, scripts/lib/life/sleep-state.mjs classifies Nick's state around bedtime from simple signals: planned bedtime and wake, last phone activity, and now.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-sleep-state.md.",
  "scope": [
    "scripts/lib/life/sleep-state.mjs",
    "tests/life-sleep-state.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
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
  "escalateWhen": []
}
```

### Bedtime nudge ladder

```orion-task
{
  "id": "life-bedtime",
  "title": "Bedtime nudge ladder",
  "objective": "After this task, scripts/lib/life/bedtime.mjs decides how hard to push Nick to sleep: nothing, gentle, firm or escalated, and when to check again.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-bedtime.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/bedtime.mjs",
    "tests/life-bedtime.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-sleep-state"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Follow-through escalation state machine

```orion-task
{
  "id": "life-escalation",
  "title": "Follow-through escalation state machine",
  "objective": "After this task, scripts/lib/life/follow-through.mjs implements the plan \u2192 remind \u2192 observe \u2192 intervene \u2192 follow up loop for one planned block as a pure state machine.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-escalation.md.",
  "scope": [
    "scripts/lib/life/follow-through.mjs",
    "tests/life-follow-through.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
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
  "escalateWhen": []
}
```

### Classify a deferral reason

```orion-task
{
  "id": "life-deferral",
  "title": "Classify a deferral reason",
  "objective": "After this task, scripts/lib/life/deferral.mjs decides whether Nick's reason for delaying is a legitimate short pause, a real plan change, or likely avoidance, with a suggested delay.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-deferral.md.",
  "scope": [
    "scripts/lib/life/deferral.mjs",
    "tests/life-deferral.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
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
  "escalateWhen": []
}
```

### Adjust tomorrow after a late night

```orion-task
{
  "id": "life-late-night",
  "title": "Adjust tomorrow after a late night",
  "objective": "After this task, scripts/lib/life/after-late-night.mjs reshapes tomorrow's blocks when Nick slept late: classes kept, a nap added, heavy work moved later, and every change reported.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-late-night.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/after-late-night.mjs",
    "tests/life-after-late-night.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-priority",
    "life-gaps"
  ],
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Learn timing patterns from history

```orion-task
{
  "id": "life-patterns",
  "title": "Learn timing patterns from history",
  "objective": "After this task, scripts/lib/life/patterns.mjs summarises how Nick's actual days differ from plans \u2014 typical start delay per kind, typical wake and sleep times, and how often each kind happens at all.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-patterns.md.",
  "scope": [
    "scripts/lib/life/patterns.mjs",
    "tests/life-patterns.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
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
  "escalateWhen": []
}
```

### Sync change-event format

```orion-task
{
  "id": "life-sync-event",
  "title": "Sync change-event format",
  "objective": "After this task, scripts/lib/life/sync-event.mjs defines and validates the structured change events the phone and Mac exchange when either works offline.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-sync-event.md.",
  "scope": [
    "scripts/lib/life/sync-event.mjs",
    "tests/life-sync-event.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
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
  "escalateWhen": []
}
```

### Merge event logs from two devices

```orion-task
{
  "id": "life-sync-merge",
  "title": "Merge event logs from two devices",
  "objective": "After this task, scripts/lib/life/sync-merge.mjs merges event logs from the phone and the Mac deterministically, so both reach the same order no matter who merges.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-sync-merge.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/sync-merge.mjs",
    "tests/life-sync-merge.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-sync-event"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Reduce events into state

```orion-task
{
  "id": "life-sync-apply",
  "title": "Reduce events into state",
  "objective": "After this task, scripts/lib/life/sync-apply.mjs folds merged events into one state object (captures, reminders, tracking, notes) that the Mac can later write into ORION's Markdown files.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-sync-apply.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/sync-apply.mjs",
    "tests/life-sync-apply.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-sync-merge"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### What should Nick do next

```orion-task
{
  "id": "life-next",
  "title": "What should Nick do next",
  "objective": "After this task, scripts/lib/life/next-action.mjs answers ORION's standing question \u2014 given the plan, the time and what has happened, what should Nick do next \u2014 with one recommendation and its reason.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-next.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/lib/life/next-action.mjs",
    "tests/life-next-action.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-priority",
    "life-sleep-state"
  ],
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### CLIs: orion-next and orion-study

```orion-task
{
  "id": "life-cli",
  "title": "CLIs: orion-next and orion-study",
  "objective": "After this task, scripts/orion-next prints the next action for a day file, and scripts/orion-study fits a study request into a day file and prints the new day, both as JSON with --json or as short text.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-cli.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "scripts/orion-next",
    "scripts/orion-study",
    "tests/life-cli.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every rule in the brief's Decisions section.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "life-next",
    "life-fit-study",
    "life-study-parse"
  ],
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Review packet for the life loop

```orion-task
{
  "id": "life-doc",
  "title": "Review packet for the life loop",
  "objective": "After this task, docs/planning/v2/LIFE_LOOP_REVIEW.md lists every file this batch added, how to verify it, what the tests prove, and what live wiring remains.",
  "context": "READ first: docs/agentic/plans/life-loop.briefs/common.md and docs/agentic/plans/life-loop.briefs/life-doc.md. Dependencies' modules are under scripts/lib/life/.",
  "scope": [
    "docs/planning/v2/LIFE_LOOP_REVIEW.md"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "The four sections exist with those exact headings.",
    "Every file under scripts/lib/life/ is listed.",
    "Needs wiring lists the six items in the brief."
  ],
  "checks": [
    "doc-report"
  ],
  "dependencies": [
    "life-cli",
    "life-sync-apply",
    "life-late-night",
    "life-bedtime",
    "life-escalation",
    "life-deferral",
    "life-patterns",
    "life-template-daily",
    "life-weekly"
  ],
  "weight": 1,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```
