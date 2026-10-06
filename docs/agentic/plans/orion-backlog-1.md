# ORION backlog 1 — agent work backlog

**Owner:** Nick · **Prepared:** 6 October 2026 (Claude) · **Purpose:** the Qwen-sized first slice of Nick's 6 October backlog: the P0 runaway-voice fix on the phone, focus sequences/recovery/day totals, and a chat-log audit.

## Goal
Make the phone voice conversation impossible to leave running, let ORION run any focus sequence from any point and recover an ended session, report true focus time for the day, and surface recurring failures from real chats. Claude afterwards: wires start-sequence into the Mac app (native/Orion is closed to this loop), fixes the break-shorten bug there, installs on the phone, and turns audit findings into eval cases.

## Starting point
- At HEAD (tag baseline-2026-10-06): PhoneVoice.swift re-listens forever; SessionDomain already models a session as a list of phases; orion-session has start/pause/resume/skip/shorten/finish/abandon; scripts/lib/focus/sequence.mjs, day-total.mjs and scripts/lib/audit/ do not exist.

## How this becomes work
```orion-plan
{"project": "ORION backlog 1", "options": {"maxAttempts": 3, "maxCorrectionDepth": 2}}
```

## Tasks

### Phase 1 · P0 voice: the session guard

```orion-task
{
  "id": "voice-guard",
  "title": "P0 voice \u00b7 the session guard",
  "objective": "After this task, MobileCore has VoiceSessionGuard: idle, lifetime, turn and stray-audio limits for a phone voice conversation.",
  "context": "READ orion-backlog-1.briefs/voice-guard.md and orion-backlog-1.briefs/common.md.",
  "scope": [
    "native/OrionMobile/Sources/MobileCore/VoiceSessionGuard.swift",
    "native/OrionMobile/Tests/AgentTasksTests/VoiceSessionGuardTests.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never touch native/Orion (the Mac app) or real files under ~/.openclaw in tests."
  ],
  "constraints": [
    "Never mutate arguments; return new values.",
    "No new dependencies.",
    "MobileCore imports only Foundation."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every decision in the brief, in order.",
    "Tests cover every scenario the brief names, by title."
  ],
  "checks": [
    "mobile-swift-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phase 2 · P0 voice: the phone obeys it

```orion-task
{
  "id": "voice-wire",
  "title": "P0 voice \u00b7 the phone loop obeys the guard and really stops",
  "objective": "After this task, the phone voice conversation ends on idle, after 15 minutes, after 30 turns, on background noise and when the app leaves the screen, and a stopped session can never send.",
  "context": "READ orion-backlog-1.briefs/voice-wire.md and orion-backlog-1.briefs/common.md.",
  "scope": [
    "native/OrionMobile/App/PhoneVoice.swift",
    "native/OrionMobile/App/ConversationView.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never touch native/Orion (the Mac app) or real files under ~/.openclaw in tests."
  ],
  "constraints": [
    "Never mutate arguments; return new values.",
    "No new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every decision in the brief, in order.",
    "Tests cover every scenario the brief names, by title."
  ],
  "checks": [
    "phone-build",
    "mobile-swift-tests"
  ],
  "dependencies": [
    "voice-guard"
  ],
  "weight": 3,
  "risk": "medium",
  "reviewDepth": "deep",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phase 3 · Focus sequences

```orion-task
{
  "id": "focus-sequence",
  "title": "Focus \u00b7 arbitrary sequences, start anywhere, recovery",
  "objective": "After this task, scripts/lib/focus/sequence.mjs parses any work/break sequence, starts it from any point and rebuilds the unfinished part of an ended session.",
  "context": "READ orion-backlog-1.briefs/focus-sequence.md and orion-backlog-1.briefs/common.md.",
  "scope": [
    "scripts/lib/focus/sequence.mjs",
    "tests/focus-sequence.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never touch native/Orion (the Mac app) or real files under ~/.openclaw in tests."
  ],
  "constraints": [
    "Never mutate arguments; return new values.",
    "No new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every decision in the brief, in order.",
    "Tests cover every scenario the brief names, by title."
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
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phase 4 · Focus total today

```orion-task
{
  "id": "focus-today",
  "title": "Focus \u00b7 total focus time today",
  "objective": "After this task, orion-session today reports cumulative focus for the day across every session.",
  "context": "READ orion-backlog-1.briefs/focus-today.md and orion-backlog-1.briefs/common.md.",
  "scope": [
    "scripts/lib/focus/day-total.mjs",
    "scripts/orion-session",
    "tests/focus-day-total.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never touch native/Orion (the Mac app) or real files under ~/.openclaw in tests."
  ],
  "constraints": [
    "Never mutate arguments; return new values.",
    "No new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every decision in the brief, in order.",
    "Tests cover every scenario the brief names, by title."
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
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phase 5 · Focus CLI

```orion-task
{
  "id": "focus-cli",
  "title": "Focus \u00b7 orion-session starts sequences and recovers",
  "objective": "After this task, orion-session start --sequence and orion-session recover send start-sequence requests (dry-run testable).",
  "context": "READ orion-backlog-1.briefs/focus-cli.md and orion-backlog-1.briefs/common.md.",
  "scope": [
    "scripts/orion-session",
    "tests/focus-cli.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never touch native/Orion (the Mac app) or real files under ~/.openclaw in tests."
  ],
  "constraints": [
    "Never mutate arguments; return new values.",
    "No new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every decision in the brief, in order.",
    "Tests cover every scenario the brief names, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "focus-sequence",
    "focus-today"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phase 6 · Chat-log audit

```orion-task
{
  "id": "log-audit",
  "title": "Audit \u00b7 recurring failures in real ORION chats",
  "objective": "After this task, scripts/orion-log-audit reports refusals, tool errors, repeats, rephrasings, frustration and slow turns from ORION transcripts.",
  "context": "READ orion-backlog-1.briefs/log-audit.md and orion-backlog-1.briefs/common.md.",
  "scope": [
    "scripts/lib/audit/chat-log.mjs",
    "scripts/orion-log-audit",
    "tests/chat-log-audit.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never touch native/Orion (the Mac app) or real files under ~/.openclaw in tests."
  ],
  "constraints": [
    "Never mutate arguments; return new values.",
    "No new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports exactly the interface in the task brief.",
    "Implements every decision in the brief, in order.",
    "Tests cover every scenario the brief names, by title."
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
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```
