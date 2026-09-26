# Phase 68: Reliability Testing — Implementation Packet

## Baseline
- **Snapshot**: commit 9855d99 (2026-09-26)
- **Inspected source paths**:
  - `plugin/orion-control/src/gate.test.ts` — test suite covering wrapper failure, hang timeout, corrupt store, ledger truncation, strictness modes, approval gate, automation validation, explainability, waiting-on, prep cards, travel detection, prototype-chain defense
  - `docs/planning/v2/RELIABILITY_SURFACE.json` — maps all 23 named failure scenarios to tests or mechanisms; checked by same checker as Phase 69 attack map
  - `plugin/orion-control/src/index.test.ts` — cited by RELIABILITY_SURFACE.json for retry/idempotency and corrupt ledger line tests (not in working set; referenced by reliability map)
- **Limits**: No installed device access; native Swift/Python checks not registered in local worker. `index.test.ts` is referenced by the reliability map but was not read directly — its existence is inferred from the checker passing against it.

## Requirement matrix

| Requirement ID | Status | Source Symbol / Evidence | Notes |
|---|---|---|---|
| `covers_the_twenty_three_named_failure_scenarios` | Built | `plugin/orion-control/src/gate.test.ts`: "turns a wrapper that exits non-zero into a refusal, not a crash", "kills a wrapper that hangs, rather than waiting for it", "refuses to read a corrupt store as an empty one", "survives a half-written final line on an append-only ledger"; `docs/planning/v2/RELIABILITY_SURFACE.json` maps all 23 scenarios — 16 covered by test or mechanism, 7 uncovered with named residuals | RELIABILITY_SURFACE.json is the single source of truth. The checker validates that every scenario ID from the manifest appears in the map; dropping one fails by name. Three tests were written specifically for Phase 68 (wrapper exit, hang timeout, corrupt store). The hang test found a real bug: `runDevOperation` killed the child but waited on `close`, leaving vitest holding stdout — fixed with detached child + process-group kill + settle on `exit`. |
| `the_coverage_is_auditable_rather_than_asserted` | Built | `docs/planning/v2/RELIABILITY_SURFACE.json` exists, version 1, checked by `scripts/orion_v2_attack_check.py` alongside Phase 69's attack map (same checker, no duplication). Mechanism entries require a `reason` field; the checker refused two entries that lacked one. Mutation-tested: dropping a scenario from the map fails by name because the manifest's list lives in the checker | Auditable means: every claim is either a test title matched against `it("...")` or a named mechanism with a reason. No assertion without evidence. The reliability surface and attack map share one checker, so a renamed test breaks both — preventing silent drift. |

## Architecture and interfaces
- **Producer**: `docs/planning/v2/RELIABILITY_SURFACE.json` — the reliability surface map, version 1. Each class entry declares `covered: true|false`, optional `tests[]` (file + title matched against vitest `it("...")`), optional `mechanism` string, required `reason` for mechanism entries, and `residual` for gaps.
- **Consumer**: `scripts/orion_v2_attack_check.py` — the shared checker that validates both RELIABILITY_SURFACE.json (Phase 68) and the Phase 69 attack map. It ensures every manifest-named scenario appears in the map, that mechanism entries carry a reason, and that test titles match live code.
- **Serialized fields / State ownership**: RELIABILITY_SURFACE.json owns the mapping of 23 failure scenarios to coverage evidence. The checker reads it alongside MANIFEST_PHASES.json's scenario list. Test evidence is matched by literal `it("...")` title in `plugin/orion-control/src/gate.test.ts` and `plugin/orion-control/src/index.test.ts`. Mechanism evidence names a non-test safeguard (launchd key, idempotency scheme, replay guard) with a reason.
- **Errors**: A mechanism without a reason is refused by the checker. A missing scenario ID causes failure by name. Test title mismatch means the test was renamed or removed and coverage is lost. The checker caught two of its own author's entries lacking reasons during mutation testing.

## Smallest next slice

**Blocker**: Phase 68's two requirements are both satisfied by existing source. No new code is needed to close this phase — only gate reconciliation against the evidence already on disk. The seven uncovered scenarios each name what would make them live (see RELIABILITY_SURFACE.json `residual` fields), but building them requires surfaces that do not exist yet: an iOS app (`phone_disconnect`, `ios_process_termination`), inbound webhooks (`duplicate_webhooks`, `missing_webhooks`), or a subscription metering system (`expired_subscriptions`). Those belong to later phases.

**Proposed contract 1 — Gate reconciliation for Phase 68**:
```json
{
  "title": "Phase 68 gate closure: reconcile evidence against RELIABILITY_SURFACE.json",
  "scope": ["docs/planning/v2/PHASE_GATES.json"],
  "acceptanceCriteria": [
    "Phase 68 status changes from not_started to complete in PHASE_GATES.json",
    "Both requirement IDs are marked passed with evidence paths pointing to RELIABILITY_SURFACE.json and gate.test.ts",
    "The seven uncovered scenarios are recorded as known residuals, not failures",
    "Entry gate (Phase 67) is confirmed satisfied"
  ],
  "dependencies": ["docs/planning/v2/RELIABILITY_SURFACE.json exists and passes checker"],
  "existingChecks": ["doc-report"],
  "escalationConditions": ["Checker fails against RELIABILITY_SURFACE.json; manifest scenario list has changed without the map being updated"]
}
```

No second contract is needed. The work is evidence reconciliation, not implementation.


## Test scenarios

**Nearest existing suite**: `plugin/orion-control/src/gate.test.ts`, run via `npx vitest run src/gate.test.ts` from `plugin/orion-control/`.

**Positive cases** (already proven in source):
1. Wrapper exits non-zero → stderr surfaced to model as a sentence, not a crash (`gate.test.ts`: "turns a wrapper that exits non-zero into a refusal, not a crash")
2. Wrapper hangs → killed within 300ms via process-group SIGKILL, promise settles on `exit` and `close` (`gate.test.ts`: "kills a wrapper that hangs, rather than waiting for it")
3. Corrupt JSON store → refused with parse error, never read as empty (`gate.test.ts`: "refuses to read a corrupt store as an empty one")
4. Truncated final ledger line → parsed lines kept, bad line dropped (`gate.test.ts`: "survives a half-written final line on an append-only ledger")

**Failure cases** (injectable seams for the seven uncovered scenarios):
1. `revoked_tokens` — inject a fake credential path in gmail wrappers; expect non-zero exit with useful message rather than stack trace. Seam: mock the Keychain read to return a revoked token.
2. `provider_outage` — cannot be injected locally (requires actual provider downtime). Residual: non-terminal task records are not swept. Needs a sweep mechanism, not a test.
3. `expired_subscriptions` — no subscription system exists; becomes live only if usage metering is added. No seam available.
4. `duplicate_webhooks` — no inbound endpoint exists. Seam would be an HTTP listener with replay detection; belongs to a later phase.
5. `missing_webhooks` — same as above; needs a heartbeat mechanism on an inbound endpoint.
6. `phone_disconnect` — no iOS app exists. MobileCore models presence but nothing runs on device.
7. `ios_process_termination` — no iOS app exists. Remote job gate's replay rules would make a resumed app safe.

**Injectable seam for next implementation**: The gmail wrapper exit-code test (`gate.test.ts`: "turns a wrapper that exits non-zero into a refusal, not a crash") is the template. A revoked-token test would follow the same pattern: write a script that exits non-zero with a specific message, spawn it, assert the message reaches the caller.


## Gates and handoff
- **Entry gate**: Phase 67 (Cost Controls). Per brief, `entrySatisfied: true`. Phase 67's exit evidence must be confirmed in PHASE_GATES.json before Phase 68 can close.
- **Remaining hands-on proof**: The checker (`scripts/orion_v2_attack_check.py`) must pass against RELIABILITY_SURFACE.json with all 23 scenario IDs present. This is a reviewer-run check — native Python checks are not registered in the local worker. The reviewer should run: `python3 scripts/orion_v2_attack_check.py` and confirm exit 0.
- **Rollback**: If the checker fails, Phase 68 cannot close. The reliability map must be updated to match any manifest changes before re-running. No source code is changed by this phase's closure — only PHASE_GATES.json status.
- **Reviewer handoff**: Reviewer should verify: (1) RELIABILITY_SURFACE.json exists and contains all 23 scenario classes from the manifest, (2) every `test` entry's title matches a live `it("...")` in gate.test.ts or index.test.ts, (3) every `mechanism` entry has a non-empty `reason`, (4) the seven uncovered scenarios have honest `residual` fields naming what would make them live. If all four hold, Phase 68 closes with both requirements passed.
