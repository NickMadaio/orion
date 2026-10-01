# ORION surfaces — agent work backlog

**Owner:** Nick · **Prepared:** 1 October 2026 (Claude) · **Purpose:** foundations for the finished-early button, schedule-driven focus mode, phone app lists, Deepgram Flux, the thinking orb, the phone chat box, the Mac chat mode, the floating composer and and the Mac chat screens.

## Goal
Nick asked for all of the above on 1 October 2026 and asked that the local agent build as much as it can so Claude's time goes to wiring, device testing and design. Each task here is a self-contained module, CLI or SwiftUI view with its own check. Claude wires the views into the running apps afterwards.

## Starting point
- Prepared at HEAD by Claude: the thinking orbs vendored as `ThinkingOrbsKit` (MIT) and linked into both apps; placeholder files `App/FinishEarly.swift`, `App/FocusLists.swift`, `App/PhoneOrb.swift` registered in the phone's Xcode project; the `AgentTasksTests` XCTest target; the `OrionViews` SwiftUI library (native/OrionMobile/Sources/OrionViews) for Mac screens, because native/Orion is closed to this loop; the `mobile-swift-tests`, `mac-build` and `phone-build` checks.
- Wiring (panel, home-screen transformation, live Deepgram socket, phone Screen Time migration, Live Activity taps, thinking stream) is Claude's.

## How this becomes work
```orion-plan
{"project":"ORION surfaces","options":{"maxAttempts":3,"maxCorrectionDepth":2}}
```

## Tasks

### Finished-early plan

```orion-task
{
  "id": "early",
  "title": "Finished-early plan",
  "objective": "After this task, scripts/lib/life/early.mjs exports earlyContext and finishEarly, which pull the rest of Nick's day forward when he finishes a block early or gets out of class or home early, never moving walls or anything later.",
  "context": "READ orion-surfaces.briefs/early.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "scripts/lib/life/early.mjs",
    "tests/surfaces-early.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
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
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### orion-reschedule early

```orion-task
{
  "id": "early-cli",
  "title": "orion-reschedule early",
  "objective": "After this task, `orion-reschedule early [block|out-of-class|home]` writes the finished-early plan to the calendar through the rules check, read-back and undo, and `--check` reports the context as JSON.",
  "context": "READ orion-surfaces.briefs/early-cli.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "scripts/orion-reschedule",
    "scripts/lib/life/calendar-write.mjs",
    "tests/surfaces-early-cli.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "early"
  ],
  "weight": 3,
  "risk": "medium",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Focus escalation rules

```orion-task
{
  "id": "focus-escalation",
  "title": "Focus escalation rules",
  "objective": "After this task, scripts/lib/focus/escalation.mjs decides from the schedule block, the Mac's front app and phone use whether ORION nudges, speaks, brings an app forward, quits it or locks the Mac, and when the phone warns or blocks.",
  "context": "READ orion-surfaces.briefs/focus-escalation.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "scripts/lib/focus/escalation.mjs",
    "tests/surfaces-focus-escalation.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
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
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### orion-focus tools

```orion-task
{
  "id": "focus-cli",
  "title": "orion-focus tools",
  "objective": "After this task, scripts/orion-focus gives ORION status, snooze, allow, wrong, act and log commands over one focus state file, with a dry mode for tests.",
  "context": "READ orion-surfaces.briefs/focus-cli.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "scripts/orion-focus",
    "scripts/lib/focus/state.mjs",
    "tests/surfaces-focus-cli.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "focus-escalation"
  ],
  "weight": 3,
  "risk": "medium",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phone app-list policy

```orion-task
{
  "id": "phone-lists",
  "title": "Phone app-list policy",
  "objective": "After this task, scripts/lib/focus/phone-lists.mjs decides which of the phone's app lists (messaging, feeds, video, games) to block from today's use, the current block and the escalation step.",
  "context": "READ orion-surfaces.briefs/phone-lists.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "scripts/lib/focus/phone-lists.mjs",
    "tests/surfaces-phone-lists.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
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

### Deepgram Flux turn reader

```orion-task
{
  "id": "flux-turns",
  "title": "Deepgram Flux turn reader",
  "objective": "After this task, MobileCore has FluxConfig, FluxTurns.parse and FluxTurnTracker: the Flux v2 URL and a tested reader that turns Flux messages into prepare/resume/finish decisions.",
  "context": "READ orion-surfaces.briefs/flux-turns.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "native/OrionMobile/Sources/MobileCore/FluxTurns.swift",
    "native/OrionMobile/Tests/AgentTasksTests/FluxTurnsTests.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
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

### Chat history store and model list

```orion-task
{
  "id": "chat-store",
  "title": "Chat history store and model list",
  "objective": "After this task, MobileCore has ChatStore (one JSON file per conversation, merge, rename, delete, thinking saved) and ChatModels.choices reading model-roles.json, with XCTest coverage.",
  "context": "READ orion-surfaces.briefs/chat-store.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "native/OrionMobile/Sources/MobileCore/ChatStore.swift",
    "native/OrionMobile/Sources/MobileCore/ChatModels.swift",
    "native/OrionMobile/Tests/AgentTasksTests/ChatStoreTests.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
  ],
  "checks": [
    "mobile-swift-tests"
  ],
  "dependencies": [],
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### ORION orb view (phone)

```orion-task
{
  "id": "orb-views",
  "title": "ORION orb view (phone)",
  "objective": "After this task, the phone has PhoneOrb: the thinking orb mapped from ORION's mood, audio-reactive, ready for the chat screen.",
  "context": "READ orion-surfaces.briefs/orb-views.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "native/OrionMobile/App/PhoneOrb.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
  ],
  "checks": [
    "phone-build"
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

### Cleaner phone chat box

```orion-task
{
  "id": "phone-composer",
  "title": "Cleaner phone chat box",
  "objective": "After this task, the phone chat box is slimmer, dismisses the keyboard on a tap or a chevron, and shows the ORION orb at the top and while he answers.",
  "context": "READ orion-surfaces.briefs/phone-composer.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "native/OrionMobile/App/ConversationView.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
  ],
  "checks": [
    "phone-build"
  ],
  "dependencies": [
    "orb-views"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Finished-early button

```orion-task
{
  "id": "finish-early-ui",
  "title": "Finished-early button",
  "objective": "After this task, FinishEarlyButton offers one tap during a block and, right after class, morphs into two symbol choices (out of class early, already home) with smooth springs.",
  "context": "READ orion-surfaces.briefs/finish-early-ui.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "native/OrionMobile/App/FinishEarly.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
  ],
  "checks": [
    "phone-build"
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

### Floating pop-up composer

```orion-task
{
  "id": "summon-composer",
  "title": "Floating pop-up composer",
  "objective": "After this task, SummonComposer is a small Mac control with close, mute and a text field that grows as he types, ready for the floating panel.",
  "context": "READ orion-surfaces.briefs/summon-composer.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "native/OrionMobile/Sources/OrionViews/SummonComposer.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
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

### Mac chat mode screens

```orion-task
{
  "id": "chat-mode-views",
  "title": "Mac chat mode screens",
  "objective": "After this task, ChatModeView shows saved conversations on the left and the current chat with a model picker and collapsible thinking on the right.",
  "context": "READ orion-surfaces.briefs/chat-mode-views.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "native/OrionMobile/Sources/OrionViews/ChatModeView.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
  ],
  "checks": [
    "mobile-swift-tests"
  ],
  "dependencies": [
    "chat-store"
  ],
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phone app lists

```orion-task
{
  "id": "focus-lists-ui",
  "title": "Phone app lists",
  "objective": "After this task, FocusLists stores four app lists from Apple's picker in the app group and shields exactly the chosen lists through its own settings store, with a screen to fill them.",
  "context": "READ orion-surfaces.briefs/focus-lists-ui.md and orion-surfaces.briefs/common.md.",
  "scope": [
    "native/OrionMobile/App/FocusLists.swift"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope."
  ],
  "constraints": [
    "Never mutate arguments; small functions; no console.log in library code.",
    "No network access; no new dependencies."
  ],
  "preconditions": [],
  "acceptance": [
    "Implements exactly the interface in the task brief.",
    "Implements every decision in the brief, in the stated order.",
    "Tests (or, for views, the behaviour list) cover every item the brief names, by name."
  ],
  "checks": [
    "phone-build"
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
