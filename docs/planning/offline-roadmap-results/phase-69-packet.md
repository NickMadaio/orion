# Phase 69: Security Attack Testing — Implementation Packet

## Baseline

| Item | Value |
|------|-------|
| Commit | 9855d99 (2026-09-26) |
| Inspected source paths | `docs/planning/v2/ATTACK_SURFACE.json` (19 attack classes mapped); `scripts/orion_v2_attack_check.py` (checker: literal title matching, manifest-held class list); `scripts/orion_v2_ci_check.sh` (CI orchestrator: adversarial suite first, coverage maps step 7); `.github/workflows/ci.yml` (GitHub Actions wiring for all source checks) |
| Limits | No installed iOS device; no native-check registration. Evidence is historical until matched to live symbols. The plugin test files (`src/gate.test.ts`, `src/index.test.ts`) are cited by the map but not read here — their existence is verified by the checker's file-existence check. |

## Requirement matrix

| Requirement ID | Status | Source symbol / evidence | Notes |
|----------------|--------|--------------------------|-------|
| continuously_tests_the_named_attack_classes | Built | `ATTACK_SURFACE.json` lists 19 classes; 11 covered with tests in `plugin/orion-control/src/gate.test.ts` and `src/index.test.ts`; 8 not covered with reason + residual. Verified by `scripts/orion_v2_attack_check.py::grade()` which checks each class appears exactly once, each claimed test title exists literally in the named file, and uncovered classes carry both `reason` and `residual`. Wired into CI at step 7 of `orion_v2_ci_check.sh` and `.github/workflows/ci.yml` "coverage maps" step. | Mutation-tested per brief: renaming a security test fails the check by name. |
| the_map_cannot_go_stale | Built | `scripts/orion_v2_attack_check.py::MANIFEST_CLASSES` holds all 19 class names internally — the map cannot satisfy the check by shortening itself. Title matching uses literal regex `it\(\s*"..."` not fuzzy search. The checker does NOT run tests (only verifies titles exist in source); `orion_v2_ci_check.sh` runs them separately, so there are two independent things to compare. | Two maps, one checker: also validates Phase 68's RELIABILITY_SURFACE.json with the same three checks. |
| every_class_is_either_covered_or_has_a_stated_residual_risk | Built | All 8 uncovered classes in `ATTACK_SURFACE.json` carry both `reason` and `residual`. Largest residual: `dependency_compromise` — `npm ci` still runs install scripts, and `tests_run`/`build_run` execute repository code. Each N/A class names what would make it live (e.g., sql_injection: "if a future action ever composes SQL from an argument"; bola_idor: "Phase 83 is Multi-User Hardening"). | The checker enforces this mechanically: `grade()` fails if an uncovered entry lacks `reason` or `residual`. |

## Architecture and interfaces

The attack-surface seam is a document-validation chain, not a runtime service.

- **Producer**: `docs/planning/v2/ATTACK_SURFACE.json` — human-authored mapping of 19 attack classes to test titles or N/A justifications. Versioned (v1), carries purpose/note metadata.
- **Consumer**: `scripts/orion_v2_attack_check.py::grade(map_path, expected_classes, label)` — reads the JSON, validates every manifest class appears exactly once, verifies each claimed test title exists literally in the named source file via regex `it\(\s*"..."`, and ensures uncovered classes carry both `reason` and `residual`. Called from `main()` which grades both attack and reliability maps.
- **Orchestrator**: `scripts/orion_v2_ci_check.sh` step 7 runs the checker; `.github/workflows/ci.yml` "coverage maps" step invokes it in CI. The adversarial test suite (`src/gate.test.ts`, `src/index.test.ts`) runs FIRST (step 1) so a security failure stops the run before anything else reports green.
- **Serialized fields**: JSON object with `version` (int), `purpose` (string), `note` (string), `classes` (array). Each class entry: `class` (string, unique key), `covered` (bool), `tests` (optional array of `{file: string, title: string}`), `reason` (string, required when not covered), `residual` (string, required when not covered), `note` (optional context).
- **State ownership**: The map is a planning document; the checker is a read-only script. Neither owns runtime state. Test files (`plugin/orion-control/src/gate.test.ts`, `src/index.test.ts`) are owned by the plugin's test suite.
- **Errors**: Checker prints per-failure lines prefixed `FAIL` and returns exit code 1 on any failure. CI treats a non-zero exit as a failing step. The adversarial suite failure (step 1) exits immediately with `exit 1`.

## Smallest next slice

All three Phase 69 requirements are Built and evidenced by source. No new code is needed. The remaining work is verification that the existing checks pass against the current worktree — which requires running Python scripts not yet registered in the local worker's check registry.

### Proposed contract: verify attack-surface checker passes

```json
{
  "title": "Phase 69 verification: run attack-surface checker",
  "objective": "Confirm orion_v2_attack_check.py passes against current source, proving all 19 classes are mapped and no claimed test has been renamed or deleted.",
  "scope": ["scripts/orion_v2_attack_check.py"],
  "non_scope": ["No source changes. No map edits. No phase closure."],
  "acceptance_criteria": [
    "python3 scripts/orion_v2_attack_check.py exits 0",
    "Output shows 'attack surface: 19 named, 11 covered, 8 argued not-applicable with a residual'",
    "No FAIL lines in output"
  ],
  "checks": ["orion_v2_attack_check"],
  "dependencies": [],
  "brief_api_signatures": ["scripts/orion_v2_attack_check.py::main() -> int"],
  "escalation_conditions": [
    "Checker fails: a test was renamed or deleted without map update — requires source fix, not this contract",
    "Python check not registered in local worker — escalate for registry addition"
  ]
}
```

**Blocker if prerequisites unmet**: The Python checker is not yet registered as a local check command. If `orion_v2_attack_check` is not available as a registered check, this contract cannot execute and the phase remains open pending registry addition or reviewer-run verification.

### Alternative: no next slice needed

If the reviewer accepts source-grounded evidence (the map exists, the checker exists, CI wires it), Phase 69 has no further implementation work. The hands-on proof is a machine-bound check that runs on Nick's Mac before pushing — exactly as `orion_v2_ci_check.sh` step 10 documents.

## Test scenarios

The adversarial suite is `plugin/orion-control/src/gate.test.ts` and `src/index.test.ts`, run via `npx vitest run src/gate.test.ts src/index.test.ts`. The coverage map checker is `scripts/orion_v2_attack_check.py`.

| Scenario | Type | Injectable seam | Expected outcome |
|----------|------|-----------------|------------------|
| Adversarial suite passes: all gate and index tests succeed | positive | Run `npx vitest run src/gate.test.ts src/index.test.ts` in plugin directory | Exit 0; all tests pass. CI step 1 succeeds, allowing remaining steps to run. |
| Coverage map checker passes: all 19 classes validated | positive | Run `python3 scripts/orion_v2_attack_check.py` | Exit 0; output shows "attack surface: 19 named, 11 covered, 8 argued not-applicable with a residual". No FAIL lines. |
| Renamed test detected: change one test title in gate.test.ts without updating ATTACK_SURFACE.json | failure | Edit `plugin/orion-control/src/gate.test.ts` to rename any `it("...")` title cited by the map | Checker exits 1 with FAIL line naming the missing title. CI step 7 fails. This is the mutation test from the brief. |
| Deleted class detected: remove one class entry from ATTACK_SURFACE.json | failure | Edit `ATTACK_SURFACE.json` to remove one class entry (e.g., `prompt_injection`) | Checker exits 1 with FAIL line: "prompt_injection: named 0 time(s); the manifest names it once". The map cannot shorten itself to pass because MANIFEST_CLASSES is held in the checker. |
| Uncovered class without residual: mark a class as not covered but omit `residual` field | failure | Edit `ATTACK_SURFACE.json` to remove `residual` from any uncovered class | Checker exits 1 with FAIL line: "gives a reason but no `residual` — say what would make this live". |
| Adversarial suite fails: inject a failing test into gate.test.ts | failure | Add a deliberately failing `it()` block to `src/gate.test.ts` | CI step 1 exits non-zero, prints "adversarial suite failed — everything below is moot", and the entire CI run stops before step 2. |

## Gates and handoff

| Item | Value |
|------|-------|
| Entry gate | Phase 68 (entryRequiresPhase: 68, entrySatisfied: true per brief). Note: entered with entrySatisfied false originally — deviation recorded per AGENTS.md because phases behind reference non-existent surfaces (iOS app, computer-use layer). |
| Remaining hands-on proof | Run `python3 scripts/orion_v2_attack_check.py` on the worktree to confirm exit 0. Run `npx vitest run src/gate.test.ts src/index.test.ts` in plugin directory to confirm adversarial suite passes. Both are machine-bound checks not yet registered in the local worker. |
| Rollback | Revert this packet file; no source changes were made by this task. |
| Reviewer handoff | 1. Verify cited symbols exist at baseline commit 9855d99: `ATTACK_SURFACE.json`, `orion_v2_attack_check.py`, `orion_v2_ci_check.sh`, `ci.yml`. 2. Verify proposed verification contract scope (`scripts/orion_v2_attack_check.py`) does not expand authority — it is read-only execution of an existing checker. 3. Confirm all three requirement rows are satisfactorily evidenced by source, not inference. |
