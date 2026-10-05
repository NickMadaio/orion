# ORION brain learning — agent work backlog

**Owner:** Nick · **Prepared:** 5 October 2026 (Claude) · **Purpose:** grow ORION's brain from Nick's real material and make it learn about him every night.

## Goal
The brain is a Basic Memory vault (~/Documents/orionBrain, 93 seeded notes). Phases 1–2 import his Atlas lecture notes as linked notes; phases 3–5 build a nightly learner that reads the day's conversation memory, asks the local model for lasting facts about Nick, keeps only facts quoted from his own words, skips what is already known, and records the rest; phase 6 reports graph health. Claude/Codex installs the nightly schedule afterwards.

## Starting point
- At HEAD: scripts/orion-brain (search/read/context/learn/recent), scripts/orion-brain-seed, Basic Memory installed at ~/.local/bin/basic-memory with project "orion".
- Nothing under scripts/lib/brain/ exists; every path in this plan is new.

## How this becomes work
```orion-plan
{"project":"ORION brain learning","options":{"maxAttempts":3,"maxCorrectionDepth":2}}
```

## Tasks

### Phase 1 · Atlas documents to notes

```orion-task
{
  "id": "atlas-notes",
  "title": "Phase 1 \u00b7 Atlas documents to notes",
  "objective": "After this task, scripts/lib/brain/atlas-notes.mjs turns Atlas document rows into Basic Memory notes linked to his courses, lectures and concepts.",
  "context": "READ orion-brain-learning.briefs/atlas-notes.md and orion-brain-learning.briefs/common.md.",
  "scope": [
    "scripts/lib/brain/atlas-notes.mjs",
    "tests/brain-atlas-notes.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never read or write the real vault, the real Atlas store or real memory files in tests."
  ],
  "constraints": [
    "Pure library functions; never mutate arguments.",
    "Node built-ins only; no new dependencies."
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

### Phase 2 · Import Atlas into the vault

```orion-task
{
  "id": "atlas-import",
  "title": "Phase 2 \u00b7 Import Atlas into the vault",
  "objective": "After this task, scripts/orion-brain-atlas reads the Atlas store read-only and writes its notes into the vault without touching notes it does not own.",
  "context": "READ orion-brain-learning.briefs/atlas-import.md and orion-brain-learning.briefs/common.md.",
  "scope": [
    "scripts/orion-brain-atlas",
    "tests/brain-atlas-import.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never read or write the real vault, the real Atlas store or real memory files in tests."
  ],
  "constraints": [
    "Pure library functions; never mutate arguments.",
    "Node built-ins only; no new dependencies."
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
    "atlas-notes"
  ],
  "weight": 2,
  "risk": "medium",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phase 3 · What was learned today

```orion-task
{
  "id": "learn-extract",
  "title": "Phase 3 \u00b7 What was learned today",
  "objective": "After this task, scripts/lib/brain/extract.mjs builds the nightly learning prompt and accepts only facts quoted from his own words.",
  "context": "READ orion-brain-learning.briefs/learn-extract.md and orion-brain-learning.briefs/common.md.",
  "scope": [
    "scripts/lib/brain/extract.mjs",
    "tests/brain-learn-extract.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never read or write the real vault, the real Atlas store or real memory files in tests."
  ],
  "constraints": [
    "Pure library functions; never mutate arguments.",
    "Node built-ins only; no new dependencies."
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
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phase 4 · Never learn the same thing twice

```orion-task
{
  "id": "learn-dedupe",
  "title": "Phase 4 \u00b7 Never learn the same thing twice",
  "objective": "After this task, scripts/lib/brain/learned.mjs drops facts the brain already knows and duplicates within a batch.",
  "context": "READ orion-brain-learning.briefs/learn-dedupe.md and orion-brain-learning.briefs/common.md.",
  "scope": [
    "scripts/lib/brain/learned.mjs",
    "tests/brain-learn-dedupe.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never read or write the real vault, the real Atlas store or real memory files in tests."
  ],
  "constraints": [
    "Pure library functions; never mutate arguments.",
    "Node built-ins only; no new dependencies."
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

### Phase 5 · The nightly learner

```orion-task
{
  "id": "learn-nightly",
  "title": "Phase 5 \u00b7 The nightly learner",
  "objective": "After this task, scripts/orion-brain-learn reads a day's memory, asks the local model, and records grounded new facts through orion-brain learn, once per day.",
  "context": "READ orion-brain-learning.briefs/learn-nightly.md and orion-brain-learning.briefs/common.md.",
  "scope": [
    "scripts/orion-brain-learn",
    "tests/brain-learn-nightly.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never read or write the real vault, the real Atlas store or real memory files in tests."
  ],
  "constraints": [
    "Pure library functions; never mutate arguments.",
    "Node built-ins only; no new dependencies."
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
    "learn-extract",
    "learn-dedupe"
  ],
  "weight": 3,
  "risk": "medium",
  "reviewDepth": "standard",
  "escalateWhen": [
    "The brief contradicts the code at HEAD in a way that blocks the task."
  ]
}
```

### Phase 6 · Graph health report

```orion-task
{
  "id": "graph-doctor",
  "title": "Phase 6 \u00b7 Graph health report",
  "objective": "After this task, scripts/orion-brain-doctor reports links, broken links, orphans and the most linked notes for the vault, read-only.",
  "context": "READ orion-brain-learning.briefs/graph-doctor.md and orion-brain-learning.briefs/common.md.",
  "scope": [
    "scripts/lib/brain/graph.mjs",
    "scripts/orion-brain-doctor",
    "tests/brain-graph-doctor.test.mjs"
  ],
  "nonScope": [
    "Do not edit any file outside this task's scope.",
    "Never read or write the real vault, the real Atlas store or real memory files in tests."
  ],
  "constraints": [
    "Pure library functions; never mutate arguments.",
    "Node built-ins only; no new dependencies."
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
