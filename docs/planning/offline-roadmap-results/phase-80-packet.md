# Phase 80: Future Call Capability — Investigation Packet

## Baseline

| Item | Value |
|------|-------|
| Commit | 9855d99 (2026-09-26) |
| Inspected paths | `docs/planning/v2/CALL_POLICY.md`, `scripts/orion_v2_deferred_check.py` |
| Limits | No telephony code exists; CALL_POLICY.md is the policy document. Deferred check enforces absence of telephony symbols. Installed device proof unavailable. |

## Requirement Matrix

| Requirement ID | Status | Source Symbol / Evidence | Notes |
|----------------|--------|--------------------------|-------|
| `defines_the_seven_items_before_implementation` | Built | `docs/planning/v2/CALL_POLICY.md` sections 1–7: Disclosure (§1), Consent (§2), Recording (§3), Impersonation (§4), Escalation (§5), Identity Verification (§6), Sensitive Information (§7). Each has a rule and reasoning. DISCLOSURE is fixed text in source (constant, not config). CONSENT reuses Phase 49 approval gate. RECORDING is flat no. IMPERSONATION is three separate prohibitions. ESCALATION ends call on confusion + do-not-call record. IDENTITY VERIFICATION refuses both directions. SENSITIVE INFORMATION is allowlist. | All seven defined in prose policy; not yet structured or enforced in code. |
| `does_not_bolt_calls_onto_gmail_permissions` | Built | `docs/planning/v2/CALL_POLICY.md` "Why calling is not messages, but louder" (four reasons: synchronous, no draft, participant not recipient, impersonation default failure). Structural conclusion: `calling` tier must be its own, at `external_connected` or above, listed explicitly. Six preconditions listed in "What would have to be true before any of this is built". | Policy defined; `calling` tier does not yet exist in `plugin/orion-control/src/permissions.ts` PROFILE_TIERS. |
| `nothing_telephony_has_been_built` | Proven | `scripts/orion_v2_deferred_check.py` DEFERRED entry ("AI phone answering", regex `twilio\|voip\|answer_call\|phone_(answer\|call)\|sip_`). Scans action catalog, wrapper scripts, exec allowlist. Fails if any match found. | Mechanically enforced; check runs as part of deferred feature smoke alarm. |

## Architecture and Interfaces

- **Producer**: `docs/planning/v2/CALL_POLICY.md` — prose policy defining seven rules (Disclosure, Consent, Recording, Impersonation, Escalation, Identity Verification, Sensitive Information). Not structured data.
- **Consumer**: Future telephony implementation (not yet built). Would consume a `calling` capability tier from `plugin/orion-control/src/permissions.ts` PROFILE_TIERS.
- **Current enforcement**: `scripts/orion_v2_deferred_check.py` DEFERRED entry "AI phone answering" with regex `twilio|voip|answer_call|phone_(answer|call)|sip_`. Scans three surfaces: action catalog (via `capability_names()` → node import of `catalog.js`), wrapper script names (globbed from `scripts/` directory for files matching `orion-*`), exec allowlist (`~/.openclaw/exec-approvals.json`). Returns exit 1 on any match.
- **Proposed seam**: Add `calling` to PROFILE_TIERS in `plugin/orion-control/src/permissions.ts`, at `external_connected` level, listed explicitly (not folded into EDIT_TIERS), with a `third_party_reach` floor entry so no strictness mode can free it. This is the same structural pattern as `messages_send`.
- **Serialized fields**: None for policy; PROFILE_TIERS uses `ReadonlySet<CapabilityTier>`. Permission state is `{ profile, version, updatedAt }` in JSON.
- **State ownership**: Policy document owned by planning (docs/). Tier definitions owned by plugin/orion-control/src/permissions.ts. Enforcement currently owned by deferred-check script. Future enforcement would be in the policy engine's tier resolution.
- **Errors**: Deferred check prints FAIL per matched surface and exits 1. Permission system returns `{ status: "rejected", reason }` for unauthorized profile changes.

## Smallest Next Slice

**Evidenced blocker**: Six preconditions from `docs/planning/v2/CALL_POLICY.md` "What would have to be true before any of this is built" must be satisfied before implementation code can be written. None are optional per the document:

1. **Phase 65/66 unblocked** — app-bundle and designated-requirement work done with Nick present. Current status: both open, `entrySatisfied: false` per manifest deviation record. This is a human-present gate, not code.
2. **`calling` capability tier** — must be added to `plugin/orion-control/src/permissions.ts` PROFILE_TIERS at `external_connected` or above, listed explicitly (not folded). Does not yet exist.
3. **`third_party_reach` floor entry** — asserted by test so no strictness mode can free it. Does not yet exist.
4. **Data inventory entry (Phase 71)** — covering recipient speech as well as outbound speech. Must be written before first line of code. Phase 71 is open.
5. **Attack-surface entry (Phase 69)** — for call-borne injection, with test. Phase 69 is open.
6. **Independent review (Phase 75)** — by somebody who did not build it. This document was written by the same model that would build the feature; CALL_POLICY.md records this as such.

**No proposed implementation contract** because prerequisites 1, 4, 5, and 6 are not code changes within this worker's scope. Prerequisites 2 and 3 are small additions to `plugin/orion-control/src/permissions.ts` but require the policy-to-code translation to be reviewed first (prerequisite 6), which is a human gate.

**Exact reconnaissance needed**: None — the blocker is structural, not informational. The six preconditions are explicitly listed in CALL_POLICY.md and none can be bypassed. The next executable task would be a Phase 65/66 advancement contract (human-present) or a permissions.ts tier-stub contract after independent review approval.

## Test scenarios

Nearest existing suite: `scripts/orion_v2_deferred_check.py` run as `python3 scripts/orion_v2_deferred_check.py`. This is a Python check, not a native Swift test. It scans the live action catalog dist, wrapper scripts, and exec allowlist.

| Scenario | Type | Injectable Seam | Expected Outcome |
|----------|------|-----------------|------------------|
| Deferred check rejects telephony symbol in action catalog | Positive | Add an action named `answer_call` to the compiled `catalog.js` with any execution kind | Script prints FAIL for "AI phone answering" in "the action catalog"; exits 1 |
| Deferred check passes when no telephony symbols present | Positive | Run against current worktree (no telephony actions exist) | Script prints "none has arrived"; exits 0 |
| Deferred check rejects telephony symbol in wrapper script name | Positive | Create `scripts/orion-phone_call.py` | Script prints FAIL for "AI phone answering" in "wrapper script names"; exits 1 |
| Deferred check rejects telephony symbol in exec allowlist | Positive | Add pattern `sip_register` to `~/.openclaw/exec-approvals.json` allowlist | Script prints FAIL for "AI phone answering" in "the exec allowlist"; exits 1 |
| Action catalog unavailable | Failure | Set `ORION_CATALOG_DIST` to non-existent path or kill node | Script prints "FAIL candidate catalog unavailable or malformed"; exits 1 |
| `email_send` transitions from simulate to real | Positive (cross-check) | Change `email_send` execution kind from `simulate` to `local` in catalog | Separate check fires: "email_send is no longer a simulation"; exits 1 |

**Fixture vs. device proof**: All scenarios above are fixture tests against the local worktree. No installed-device proof exists because no telephony code has been built. Device proof would require a real phone call attempt, which cannot exist until Phase 65/66 unblock the app-bundle surface for approval UI.

## Gates and handoff

- **Entry gate**: Phase 79 (Future Location Context) exit evidence must pass. Per manifest: `entryRequiresPhase: "79"`, `entrySatisfied: false`. Phase 79 is in the deferred features track (76-84). Entry satisfied is recorded as false because Phases 65 and 66 are open on the app bundle's designated requirement, deliberately parked until Nick is at the keyboard. This is a deviation per AGENTS.md, not asserted true.
- **Remaining hands-on proof**: 
  - Independent review (Phase 75) of CALL_POLICY.md by somebody who did not write it — recorded as required because the same model that authored the policy would build the feature.
  - Native check registration for telephony enforcement is not needed yet; `scripts/orion_v2_deferred_check.py` already enforces absence mechanically.
  - Phase 65/66 advancement requires Nick at keyboard (human-present gate).
- **Rollback**: No code was changed by this investigation. CALL_POLICY.md and deferred_check.py are untouched. If future implementation adds a `calling` tier to permissions.ts, rollback is removing that entry from PROFILE_TIERS and restoring the previous version number.
- **Reviewer handoff**: 
  - Verify `docs/planning/v2/CALL_POLICY.md` exists at worktree baseline (it does; 227 lines).
  - Verify `scripts/orion_v2_deferred_check.py` DEFERRED entry "AI phone answering" regex matches telephony symbols (it does; confirmed in source).
  - Verify `plugin/orion-control/src/permissions.ts` PROFILE_TIERS does not contain `calling` (confirmed; six profiles exist, none include it).
  - Confirm no proposed scope expands authority: this packet proposes no implementation, only investigation and blocker documentation.