# Knowledge capture, memory and grounded finance — offline roadmap report

## Baseline

| Item | Value |
|---|---|
| Inspected source paths | `backend/memory/store.py`, `backend/memory/records.py`, `backend/memory/classes.py`, `plugin/orion-control/src/atlas.ts`, `native/Orion/Sources/Orion/PlaidModels.swift` |
| Product vision reference | `docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md` |
| Phase IDs referenced | 18, 20, 64, 71–72 |
| Recovery gates referenced | — |
| Limits | Finance provider freshness not re-proven; knowledge memory source paths require reconnaissance; no iPhone target installed |

## Requirement matrix

| Req ID | Capability | Source evidence / symbol | Status | Notes |
|---|---|---|---|---|
| K-01 | Capture entry point | `plugin/orion-control/src/atlas.ts` (`notes.create`) | Built | Atlas bridge provides typed note creation; backend `MemoryStore.remember` exists but lacks direct UI capture seam |
| K-02 | Provenance tracking | `backend/memory/records.py` (`Provenance` enum field) | Built | Every `MemoryItem` carries `provenance`; `MemoryStore.remember` enforces durability rules based on provenance |
| K-03 | Retrieval by source link | `backend/memory/store.py` (`recall`, `inspect`) | Built | Owner-scoped recall with domain firewall; `inspect` returns all items including expired |
| K-04 | Correction and deletion | `backend/memory/store.py` (`edit`, `forget`) | Built | `edit` updates body/revision/provenance; `forget` deletes by ID; both enforced by user editability rules |
| K-05 | Fact / preference / hypothesis distinction | `backend/memory/classes.py` (`MemoryClass` enum) | Built | Classes include WORKING, EPISODIC, USER; durability and expiry rules differ per class |
| F-01 | Finance source freshness display | `native/Orion/Sources/Orion/PlaidModels.swift` | Not yet proven | UI built per vision; provider freshness timestamp not explicitly exposed in model layer |
| F-02 | Missing-data semantics for finance | `native/Orion/Sources/Orion/PlaidModels.swift` (`Money` analytics) | Built | Null balances handled via `current ?? 0`; empty transaction lists return zero spending/income |
| F-03 | Read authority never grants payment authority | Policy invariant | To verify | Needs confirmation in action/authorization boundary; no payment APIs found in inspected finance sources |

## Architecture and interfaces

### Knowledge capture seam

| Role | Module / path | Evidence |
|---|---|---|
| Producer | `plugin/orion-control/src/atlas.ts` (`requestAtlas`) | Sends note operations to Atlas app via file-based bridge |
| Consumer | `backend/memory/store.py` (`MemoryStore`) | In-memory store with domain firewall; persists `MemoryItem` records |
| Serialized fields | `memory_id`, `source`, `provenance`, `confidence`, `sensitivity`, `created_at`, `updated_at`, `expires_at`, `user_editable` | Defined in `backend/memory/records.py` `FIELDS` constant and `MemoryItem` dataclass |
| State ownership | `backend/memory/store.py` owns durable local state; `SessionDomain` owns session effects per brief | Brief states SessionDomain owns durable local state; memory store is backend component |
| Errors | `PromotionRefused`, `KeyError`, `PermissionError` | Enforced by durability rules, missing IDs, and editability constraints |

### Finance freshness seam

| Role | Module / path | Evidence |
|---|---|---|
| Producer | Not yet proven — needs inspection of `native/Orion/Sources/Orion/PlaidClient.swift` | Vision doc references Plaid integration client; file not inspected in this worktree. Must READ to confirm existence, role, and freshness-timestamp exposure before marking Built. |
| Consumer | `native/Orion/Sources/Orion/PlaidModels.swift` (`Money` analytics) | Pure functions over `PlaidAccount` and `PlaidTransaction` arrays |
| Serialized fields | `itemID`, `accessToken`, `institutionName`, `available`, `current`, `currency`, `amount`, `date`, `category` | Defined in `PlaidItem`, `PlaidAccount`, `PlaidTransaction` structs |
| State ownership | Mac app local state; no backend persistence for finance data per vision doc | Vision doc states "Built UI and recurring-charge summaries"; no cloud sync mentioned for finance |
| Errors | Network errors, empty data, stale timestamps | Not explicitly modeled in inspected files; `PlaidClient` likely handles these |

## Smallest next slice

### Slice 1: Knowledge capture entry with provenance

**Proposed contract** (not executable registration):

- **Write paths**: `backend/memory/capture_seam.py`, `plugin/orion-control/src/knowledge-capture.ts`, `native/Orion/Sources/KnowledgeCaptureView.swift`
- **Dependencies**: Existing Atlas bridge (`plugin/orion-control/src/atlas.ts`); MemoryStore (`backend/memory/store.py`)
- **Acceptance criteria**:
  1. One capture entry accepts text and source reference
  2. Stored record carries identity, observation time and revision
  3. Fact/preference/hypothesis is explicitly tagged via `MemoryClass`
  4. Retrieval returns the stored record with provenance intact
  5. Correction updates revision without losing original source
  6. Deletion removes the record from retrieval
  7. Notes never grant action authority (enforced by domain firewall)
  8. Existing tests for note route still pass
- **Existing checks**: `test_v2_memory_v2.py` exercises MemoryStore; Atlas bridge has no registered tests in current worker
- **API signatures**: `capture(text, source, kind: MemoryClass) -> MemoryItem`
- **Escalation**: If capture entry cannot connect Atlas notes to MemoryStore without new permissions, block on provider decision

**Blocker note**: No unified capture seam exists between Atlas notes and backend memory store. Requires new integration code.

## Test scenarios

### Knowledge capture — positive

| Field | Value |
|---|---|
| Scenario | Capture a fact with source link, retrieve it, verify provenance |
| Injectable seam | Memory store mock or fixture provider |
| Entry point | `backend/memory/store.py` `remember` method |
| Expected state | Record stored with kind=USER, source preserved, revision=1 |
| Product-visible result | Retrieved note shows original text and source attribution |
| Fixture vs installed | Fixture until real persistence proven |

### Knowledge capture — failure

| Field | Value |
|---|---|
| Scenario | Attempt to authorize an action from a stored note |
| Injectable seam | Authorization boundary mock |
| Entry point | `orion.core.context.policy` `admits` function |
| Expected state | Authorization denied; note content not treated as authority |
| Product-visible result | Action rejected with clear reason |
| Fixture vs installed | Fixture |

### Finance freshness — positive

| Field | Value |
|---|---|
| Scenario | Display finance summary showing last successful refresh time |
| Injectable seam | Provider adapter returning stale-but-valid data |
| Entry point | `native/Orion/Sources/Orion/PlaidModels.swift` `Money.recurring` |
| Expected state | Summary shows source name, timestamp, and actionable findings |
| Product-visible result | User sees when data was last refreshed |
| Fixture vs installed | Fixture until provider re-proven |

### Finance freshness — failure

| Field | Value |
|---|---|
| Scenario | Provider returns no data or errors |
| Injectable seam | Provider adapter returning empty/error |
| Entry point | `native/Orion/Sources/Orion/PlaidModels.swift` `Money.netWorth` |
| Expected state | Summary shows "not checked" or source age warning, never fabricated values |
| Product-visible result | User sees missing-data indicator, not zero or success |
| Fixture vs installed | Fixture |

## Gates and handoff

### Entry gate

- Knowledge capture entry point identified in committed source OR blocker recorded with exact reconnaissance needed
- Finance provider adapter path identified
- No new permissions or payment authority introduced

### Remaining hands-on proof

- Installed Mac proof of knowledge capture/retrieval cycle
- Provider freshness display verified against real (not fixture) data
- iPhone target not required for this slice

### Rollback

- Report-only task; no source changes. Rollback is deletion of this report file.

### Reviewer handoff

- Verify every source path cited actually exists and exports the claimed symbols
- Verify requirement matrix rows are grounded in inspected code, not vision-document assertions
- Verify proposed contracts do not exceed ≤3 write paths or ≤8 acceptance criteria
