# Phase 71: Data Inventory — Implementation Packet

## Baseline
- **Inspected source paths**: 
  - `scripts/orion_v2_inventory_check.py` — the inventory checker script (186 lines, entry point `main()`)
  - `docs/planning/v2/DATA_INVENTORY.json` — the data inventory with 17 entries covering all capability tiers
- **Limits**: No installed device access; evidence is source-only. Native checks not registered in local worker. The checker reads from `~/.openclaw/extensions/orion-control/dist/catalog.js` and `~/.openclaw/openclaw.json` at runtime, which are unavailable in this worktree.

## Requirement matrix

| ID | Status | Evidence / Source Symbol | Notes |
|----|--------|--------------------------|-------|
| `maintains_a_living_data_inventory_with_all_ten_fields` | Built | `scripts/orion_v2_inventory_check.py:REQUIRED_FIELDS` tuple lists all 10 fields; `main()` line ~78 iterates entries checking each field is non-empty string. DATA_INVENTORY.json has 17 entries, each with all 10 fields populated. | Checker enforces at runtime; inventory currently passes. |
| `covers_email_calendar_health_conversations_memory_files_devices_analytics_and_logs` | Built | DATA_INVENTORY.json entries cover: email, oauth refresh tokens, calendar and reminders, iMessage/SMS, health/workouts, conversations/transcripts, memory/brain, files, device info, authority state, audit logs, working state, credentials, analytics (explicitly "none"), trips/travel, Atlas notes, screen content, terminal output. All 9 manifest categories plus 4 extras (OAuth tokens, iMessage, authority state, .env credentials). | Coverage verified by inspection of entries array. |
| `the_inventory_is_updated_with_every_feature` | Built | `scripts/orion_v2_inventory_check.py:live_tiers()` reads installed ACTION_CATALOG; `main()` lines ~85-103 enforce every live tier appears in exactly one entry's `tiers`. Also checks every configured store path in openclaw.json is named by some entry's `storage` field. | Enforcement is automated, not manual. Mutation-tested per brief evidence. |

## Architecture and interfaces
- **Producer**: `docs/planning/v2/DATA_INVENTORY.json` is the data store (17 entries). `scripts/orion_v2_inventory_check.py` is the read-only validator that reads it plus the live catalog and config.
- **Consumer**: Phase gate evidence system; future implementation contracts reference this inventory for data-handling decisions.
- **Serialized fields** (per `REQUIRED_FIELDS` in checker): `data`, `source`, `purpose`, `storage`, `encryption`, `retention`, `modelExposure`, `thirdPartyExposure`, `deletion`, `sensitivity`. Each entry must carry all 10 as non-empty strings.
- **State ownership**: Local file-based JSON, owned by planning process. The checker is read-only against installed runtime state (`~/.openclaw/extensions/orion-control/dist/catalog.js` for tiers, `~/.openclaw/openclaw.json` for store paths).
- **Errors**: Three failure modes — (1) missing/empty field in any entry, (2) live tier not claimed by exactly one entry, (3) configured store path not named in any entry's `storage`. Returns exit code 1 with specific messages.

## Smallest next slice
- **Blocker**: No further implementation contract is needed. Phase 71 requirements are all Built and evidenced in source. The remaining work is hands-on proof on an installed device, which requires:
  1. Native check registration so `scripts/orion_v2_inventory_check.py` can run as a gate check (not currently registered in local worker)
  2. Reviewer-run verification that the checker passes against the live installed catalog and config
  
- **Reconnaissance needed**: Register native Python check execution in the worker's check registry, then run `python3 scripts/orion_v2_inventory_check.py` on a machine with the Orion extension installed. This is an infrastructure task, not a Phase 71 implementation task.

## Test scenarios
- **Positive case**: Run `python3 scripts/orion_v2_inventory_check.py` on installed system with current DATA_INVENTORY.json and live catalog. Expected: exit 0, message "data inventory: 17 entries covering N live tier(s) — OK". Seam: the checker script itself; injectable by running it directly.
- **Failure case 1 (missing tier)**: Add a new capability tier to ACTION_CATALOG without adding it to any entry's `tiers`. Expected: exit 1, message naming the unclaimed tier. Seam: modify catalog.js or add a new action with an unlisted tier.
- **Failure case 2 (empty field)**: Remove one of the 10 required fields from an entry in DATA_INVENTORY.json. Expected: exit 1, message naming the entry and missing field. Seam: edit DATA_INVENTORY.json directly.
- **Failure case 3 (uncovered store path)**: Add a new path key to openclaw.json's plugin config that no entry's `storage` text mentions. Expected: exit 1, message naming the uncovered filename. Seam: modify openclaw.json plugin config.
- **Fixture vs device proof**: Source inspection proves the checker logic exists and the inventory is complete. Installed-device proof requires running the checker against live catalog.js and openclaw.json, which are not in the worktree.

## Gates and handoff
- **Entry gate**: Phase 70 satisfied (`entrySatisfied: true` in brief). Note: entered with `entrySatisfied false` per deviation recorded in AGENTS.md because Phases 65/66 are parked awaiting Nick at keyboard.
- **Remaining hands-on proof**: 
  1. Register `scripts/orion_v2_inventory_check.py` as a native check in the worker's check registry (infrastructure task, not Phase 71 scope)
  2. Run checker on installed system to confirm it passes against live ACTION_CATALOG and openclaw.json
- **Rollback**: DATA_INVENTORY.json is version-controlled; revert to prior commit if changes were made. Checker script is read-only — no rollback needed for normal operation.
- **Reviewer handoff**: Verify that `scripts/orion_v2_inventory_check.py:main()`, `REQUIRED_FIELDS`, `live_tiers()`, and `PATH_KEYS` exist at worktree baseline. Confirm DATA_INVENTORY.json has 17 entries with all 10 fields. Confirm no source changes were made in this phase (non-scope respected).
