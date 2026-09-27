# Phase 49: Remote Approval System — Evidence Packet

## Baseline

Inspected source at commit `9855d99` (2026-09-26). Three files carry the implementing symbols:

| Path | Role |
|------|------|
| `plugin/orion-control/src/approvals.ts` | Ticket minting, grant writing, nonce binding, voice/turn parsing, chat grants |
| `plugin/orion-control/src/validator.ts` | Gate enforcement: `approvalGrants` option, canonical hash derivation, taint checks |
| `plugin/orion-control/src/strictness.ts` | Mode/floor derivation, `modeRequiresApproval`, delegation storage |

Nearest test suites: `plugin/orion-control/src/gate.test.ts` and `plugin/orion-control/src/index.test.ts` (170 tests combined), plus `scripts/orion_v2_strictness_check.sh` (27 live-machine checks). These are not re-run here; evidence is matched to source symbols.

## Requirement Matrix

| ID | Status | Source symbol / evidence | Verdict |
|----|--------|--------------------------|---------|
| `creates_a_canonical_job_representation_and_hashes_it` | passed | `validator.ts::canonicalActionHash(step, workingContext)` derives SHA-256 over `{action, arguments, workingContext}` with sorted keys. `approvals.ts::mintTicket()` stores it on the ticket. | Built |
| `shows_a_human_readable_approval_on_iphone` | blocked | No iPhone app exists. The human-readable half is in `approvals.ts::ApprovalTicket.summary` (one-line plain-language description) and `orion-approve` lists pending tickets. Terminal and Discord are the surfaces today. | Not yet proven — phone surface missing |
| `requires_face_id_where_appropriate` | blocked | `grep LAContext` returns nothing in the repository. No SecureEnclave key exists. | Not yet proven — phone surface missing |
| `signs_approval_with_a_device_authorization_key` | blocked | No cryptographic signature. Substitute: `approvals.ts::grant()` writes to a directory Orion cannot reach (four boundary claims checked by `orion_v2_strictness_check.sh`), bound by nonce only the minting process knew. Honest ceiling for single-user Mac without Secure Enclave. | Not yet proven — phone surface missing |
| `includes_target_device_capability_arguments_hash_expiration_and_nonce` | passed | `approvals.ts::ApprovalTicket` carries `action`, `canonicalHash`, `expiresAt` (15 min TTL), 128-bit `nonce` from CSPRNG, and `deviceId` from `hostname()`. `readTickets()` drops tickets minted on another Mac. | Built |
| `mac_verifies_signatures_independently` | blocked (partial) | No signature verification exists. Weaker but real: `validator.ts::validateTaskGraph` consults `options.approvalGrants` (filled from grant directory by plugin entry), re-derives the canonical hash from submitted bytes, and matches it — never trusting a value in the request. The step's own `approvalHash` is deliberately ignored. | Not yet proven — signing depends on phone; weaker verification built |
| `keeps_a_human_in_the_loop_for_every_approval` | passed | Four boundary claims: (1) grant directory outside mutable roots, (2) `orion-approve` absent from exec allowlist, (3) `orion-approve` in `FORBIDDEN_SCRIPTS`, (4) `orion-remote` refuses `local` sender. All checked by `orion_v2_strictness_check.sh`. Voice path: `approvals.ts::decisionsInUserTurn()` reads only `trusted_user` inputs minted from host provenance, strips machine context via `stripMachineContext()`, examines every occurrence of an id. Mutation-tested per postReviewCorrections. | Built |
| `authorization_checks_are_satisfiable_by_the_name_a_person_would_type` | passed | `approvals.ts::normalizeTicketId()` accepts `a-7f3k`, `A-7F3K`, bare `7F3K`. `validator.ts::argumentNotFromUser()` matches filename stems: strips extension from both needle and haystack so "fix executors" satisfies `executors.ts`. Test pairs two authority-classed files. | Built |
| `never_presents_an_approval_identifier_the_system_did_not_mint` | passed | Transport-side fix (not in plugin source). Real ids match `approvals.ts::TICKET_RE` (`A-` plus 4 chars from restricted alphabet). Channel brief states the model cannot create one and must say "no pending approval" rather than invent. | Built |

## Architecture and Interfaces

**Producer**: `plugin/orion-control/src/approvals.ts` — mints tickets, writes grants, reads state.
**Consumer**: `plugin/orion-control/src/validator.ts` — enforces the gate via `options.approvalGrants`.

**Serialized fields** (ticket → grant chain):
- `ApprovalTicket.id` (A-XXXX), `canonicalHash` (SHA-256 hex), `nonce` (128-bit hex), `action`, `summary`, `deviceId`, `expiresAt`, optional `sessionKey`.
- `ApprovalGrant.id`, `canonicalHash`, `nonce`, `grantedAt`, `grantedBy`.

**State ownership**: Grant directory (`~/.openclaw/orion-control/grants/`) is owned by `orion-approve` and the non-local branch of `orion-remote`. Nothing in Orion's tool surface writes there. Tickets are read-only for Orion; he can list them to report ids but cannot create or delete grants.

**Errors**: Grant refused when `grantedBy` is "local" or "orion"; ticket expired; nonce mismatch; hash mismatch; id not found. All return `{ ok: false, reason }`.

**Proposed seam for next slice**: `chatGrantCovers()` in `approvals.ts` exists but is not wired into `validator.ts::validateTaskGraph`. The validator checks `options.approvalGrants` for one-shot grants but has no path to consult chat-level grants. Wiring this would let "allow for this chat" actually reduce friction for `terminal_run` within a conversation, which is the Phase 52 feature previewed in the approval module's comments.

## Smallest Next Slice

### Proposed Contract A: Wire chat grants into the validator gate

**Objective**: Make `validator.ts::validateTaskGraph` consult `chatGrantCovers()` so that an action already allowed for the current conversation does not trigger `approval_required`.

**Scope** (≤3 write paths):
1. `plugin/orion-control/src/validator.ts` — add chat-grant consultation in the approval gate branch
2. `plugin/orion-control/src/gate.test.ts` — tests for chat grant coverage and expiry
3. `docs/planning/offline-roadmap-results/phase-49-packet.md` — update this report

**Acceptance criteria** (≤8):
1. `validateTaskGraph` accepts a new optional parameter `chatGrantCheck?: (action: string, sessionKey?: string) => boolean`.
2. When `chatGrantCheck(action)` returns true for an approval-gated step, the step does not produce an `approval_required` issue.
3. A chat grant that has expired still triggers `approval_required`.
4. A chat grant for a different action does not cover this one.
5. A chat grant for a different session key does not cover this one.
6. Non-chat-grantable actions (not in `CHAT_GRANTABLE`) are unaffected.
7. Existing one-shot grant behavior is unchanged: a valid grant still satisfies the gate.
8. The new parameter defaults to `() => false` so callers that do not supply it see no behavioural change.

**Dependencies**: `approvals.ts::chatGrantCovers`, `approvals.ts::CHAT_GRANTABLE`. Both exist and are exported.

**Existing checks**: `gate.test.ts` (approval gate tests), `index.test.ts` (trust boundary tests).

**API signature**:
```typescript
chatGrantCheck?: (action: string, sessionKey?: string) => boolean;
```

**Escalation conditions**: If `chatGrantCovers` is not exported or its signature differs, stop and record blocker. Do not invent a new IPC mechanism.

## Test Scenarios

1. **Positive: Chat grant covers action (fixture)**
   - **Inject**: Mock `chatGrantCheck` returning `true` for `terminal_run` in current session key.
   - **Expected**: `validateTaskGraph` proceeds without `approval_required`. Grant directory untouched.
   - **Source**: `gate.test.ts` (unit fixture).

2. **Failure: Expired chat grant (fixture)**
   - **Inject**: Mock `chatGrantCheck` returning `false` due to TTL expiry.
   - **Expected**: Gate falls through to one-shot grant check; if none, emits `approval_required`.
   - **Source**: `gate.test.ts`.

3. **Failure: Non-chat-grantable action (fixture)**
   - **Inject**: Action `desktop_file_write_explicit` (not in `CHAT_GRANTABLE`).
   - **Expected**: Chat grant path skipped; standard approval gate applies.
   - **Source**: `index.test.ts`.

4. **Positive: One-shot grant still works (live machine)**
   - **Inject**: Valid file-based grant written by `orion-approve` on disk.
   - **Expected**: Gate passes, hash matches, step authorized. Verified via `orion_v2_strictness_check.sh`.
   - **Source**: `gate.test.ts` (existing) + shell script.

## Gates and Handoff

- **Entry Gate**: Phase 48 exit evidence satisfied (privilege separation boundaries established; approval gate live).
- **Remaining Hands-on Proof**: Wire chat grant consultation into validator; verify mutation tests still pass; confirm `orion_v2_strictness_check.sh` covers new path.
- **Rollback**: Revert `validator.ts` to prior commit; chat grant parameter is optional and defaults to `false`, so no breaking change if rolled back mid-flight.
- **Reviewer Handoff**: Verify cited symbols (`chatGrantCovers`, `CHAT_GRANTABLE`) exist at baseline. Confirm proposed scope does not expand authority beyond current approval boundaries. Check that test scenarios map to existing suite structure.
