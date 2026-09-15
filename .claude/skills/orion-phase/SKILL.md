---
name: orion-phase
description: How to build and close a numbered ORION manifest phase. Use whenever the work is "do phase N", "the next phase", closing a phase gate, writing a PHASE_GATES.json record, or when a session starts and you need to know the current program position. Covers the read order, where code goes, the test-and-mutate loop, and the two mistakes that have cost this program the most time.
---

# Closing an ORION phase

The program is 85 numbered phases in `docs/planning/v2/MANIFEST_PHASES.json`, from a
source manifest at `~/Desktop/Orion v two implementation plan.md`. Work goes in
numeric order. One phase = build it, test it, mutate the tests, close the gate,
commit. Six of them fit comfortably in a context window when done this way.

## Before anything

```bash
cd ~/Desktop/ORION && git fetch && git status -sb   # NOT just git log
date                                                # before ANY dated write
```

Read `AGENTS.md`, then `HANDOFF.md`, then `docs/planning/v2/HANDOFF.md`. Position
lives in `MANIFEST_PHASES.json` → `additiveRoadmap.numberedProgramPosition`.

Read the phase's actual text before designing anything:

```bash
awk '/^# PHASE 39 /,/^# PHASE 40 /' ~/Desktop/"Orion v two implementation plan.md"
```

Exclude `.claude/worktrees/` from every grep — it is a full duplicate checkout
and doubles every result.

## The two mistakes that have cost the most

**1. Re-planning instead of building.** On 2026-09-01 a session found something
real — the manifest's Phase 0 documented a Python runtime that was already dead
— and generalised it into "the whole ordering is superseded", replacing the
numbered phases with a lettered batch scheme. Two sessions then produced one
partial phase between them, and Nick lost the thread entirely: *"We have 'Batch
C' which idek what that is."*

The finding was true and the generalisation was not: phases 34-39 are Health UI,
Journal, Correlations, Experiments, Health-Aware Planning, Daily Planning, and
not one of them touches Python. **If a phase's requirements mention the Python
runtime, read them against the live stack — the Swift app in `native/Orion` and
the TS plugin in `openclaw-plugins/orion-control`. That changes how requirements
are READ, never their ORDER.** Do not invent a parallel taxonomy. If the
sequence genuinely has to bend, record it in `PHASE_GATES.json` with
`entrySatisfied: false` and close the gap, which the validator will then force.

**2. Building the same thing twice.** Phase 38's "give planner only derived
states" already existed as `PlanningSignal.swift`, built under Phase 33. Grep
before you design. A gate record that says "half of this already shipped, here
is where" is worth more than a second vocabulary saying the same thing.

## Where code goes

| What | Where | Tested by |
|---|---|---|
| Pure domain, shared with the phone | `native/OrionMobile/Sources/MobileCore/` | `scripts/orion_v2_mobile_check.sh` |
| Mac-only pure logic | `native/Orion/Sources/SessionDomain/` | `native/Orion/Tests/run-domain-test.sh` (XCTest) |
| Producers, stores, anything touching disk | `native/Orion/Sources/Orion/` | a `Tests/run-*-test.sh` harness |
| SwiftUI | `native/Orion/Sources/Orion/` | not directly — see below |

**Put the rules in a type, not in a view.** A rule spelled out in SwiftUI holds
only on the screens somebody remembered to apply it to. Make the initialiser
refuse the invalid value; then the view cannot render one and no reviewer has to
remember. This is why Phase 34's prohibitions are `SectionNarrative.init?`
returning nil rather than a lint rule.

**A prohibition is best expressed as an absent enum member.** Phase 38 forbids
cancelling a required commitment, so `PlanningAction` has no `cancel` case.
There is no code path to audit.

## The loop

1. **Read the phase text.** Then grep for what already exists.
2. **Build the domain first**, pure and injected. No `Date()`, no
   `TimeZone.current`, no file reads inside the logic.
3. **Write checks against the REAL producer.** AGENTS.md: "a consumer's tests
   must run over what the producer actually emits." Phase 32's hand-built
   fixtures left 23 of 42 guards unenforced.
4. **Mutation-test every rule.** Four or five per phase. Break the rule, confirm
   a named assertion fails, restore.
5. **Close the gate**, run everything, commit.

### Mutation testing is where the real findings come from

Every survivor in this program has been a defect in the code or the test, never
"the test is fine actually":

- A survivor meant `verdict` had **two identical branches**, making a condition
  look load-bearing when it was dead — and a comment claiming so was false.
- A survivor meant the assertion was a **near miss**: `hour != 2` passed because
  the spurious digit resolved to 2 *pm*. A near-miss assertion is worse than
  none; it reports a guard as tested.
- A survivor meant the **code comment overclaimed**: pooling spreads does not
  behave the way the comment said, and no fixture could separate the rules.
  The honest fix was to correct the claim and record it as a limitation — not
  to tune numbers until something passed.

If a mutation survives, suspect the code and the claim before adding a test.

### Two rules that keep recurring

- **Pin CONTENTS, not counts.** `allCases.count == 8` passed after two members
  were swapped for two others.
- **An injected value that equals the ambient one proves nothing.** 322 tests
  injected `America/New_York` on a machine that *was* `America/New_York`, and
  missed a real off-by-one day key. Sweep the whole space, or pick a value the
  machine cannot be.

## Closing the gate

`docs/planning/v2/PHASE_GATES.json`. The validator (`scripts/orion_v2_phase_gate.py`)
enforces: every requirement needs `status` (`passed`|`blocked`) and `evidence`;
a blocked one needs `reason`; `nextPhaseAllowed` must equal "all passed"; and
`entrySatisfied` must match the previous phase's real state. It will refuse the
whole document, which is the point.

Then `MANIFEST_PHASES.json` → `current[N]` and
`additiveRoadmap.numberedProgramPosition`.

**Write `blocked` when something is blocked.** A gate full of green that hides
undone work is the failure this whole register exists to prevent. Phase 40 has
four blocked requirements and is more useful than it would be closed.

**Evidence means numbers and mechanisms**, not "tests pass". Say what would fail
if the rule broke.

```bash
./.venv/bin/python scripts/orion_v2_phase_gate.py --phase N
PYTHONPATH=. ./.venv/bin/python -m unittest discover -s tests -t tests -q
./.venv/bin/python scripts/orion_v2_secret_scan.py \
  --allowlist docs/planning/v2/secret-scan-allowlist.json
```

## Running everything

```bash
cd native/Orion
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # CLT has no XCTest
swift build
./Tests/run-domain-test.sh                # XCTest, the pure domain
./Tests/run-health-firewall-test.sh       # Phase 33, numeric
./Tests/run-health-sections-test.sh       # Phase 34
./Tests/run-journal-store-test.sh         # Phase 35, real file
./Tests/run-location-contract-test.sh     # Phase 40, cross-language
./Tests/run-timezone-set-test.sh          # Phase 40, the live command
cd ~/Desktop/ORION && ./scripts/orion_v2_mobile_check.sh
```

### Harness traps, all paid for once

- `MobileCoreCheck/main.swift` is **one top-level scope**. A `let full` collides
  with every other `full` in 2,000 lines. Prefix new names.
- Anything the check file calls must be `public`.
- `find .build -name Modules | head -1` picks **Sparkle's** Modules directory.
  Select by content: `find ... -name 'SessionService.swiftmodule'`.
- Scope object globs to `-path '*/debug/*'` or the link fails with 2,000+
  duplicate symbols.
- **zsh does not word-split unquoted variables.** Harness scripts are `#!/bin/bash`
  for a reason; a one-off `swiftc -I "$MOD" $OBJ` from the shell tool needs
  `bash -c`.
- Never force-unwrap in a harness. A missing value is usually the defect under
  test, and a crash reports `Trace/BPT trap: 5` instead of naming it — and kills
  every later check.

## Committing

Conventional commits, no Co-Authored-By (this repo has none). One phase per
commit. The body should say what was FOUND, not only what was built — every
useful commit here names a mutation that survived, a claim that turned out
false, or a number that was measured rather than assumed.
