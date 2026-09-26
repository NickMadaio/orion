# Phase 73: Backups and Recovery — Implementation Packet

## Baseline
- **Inspected source paths**: `scripts/orion-backup`, `scripts/orion_v2_backup_check.sh`
- **Limits**: No installed device access; Keychain items unavailable for end-to-end proof. Native Swift/Python checks not registered in local worker.

## Requirement Matrix

| Requirement ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| `creates_encrypted_backups_of_essential_state` | Built | `openssl enc -aes-256-cbc -pbkdf2 -iter 600000` in backup section; passphrase from Keychain via `passphrase()` function. | AES-256-CBC, PBKDF2 600k iters. Refuses if no Keychain item. |
| `does_not_back_up_secrets_in_plaintext` | Built | `EXCLUDES` array (filename patterns); Python `scrub()` function redacts credential-shaped values in JSON files. | Two-pass exclusion: filename and content. |
| `tests_restoration` | Built | `--verify` case performs real restore to temp dir, checks schema, absence of secrets, and file count. | Uses fd 3 for passphrase to avoid pipe bug. |
| `maintains_schema_compatible_restoration` | Built | Python block writes `MANIFEST.json` with `schema` field; `--verify` asserts schema version matches expected. | Restore targets a directory, never live system. |
| `tests_the_four_named_recovery_scenarios` | Not yet proven | Brief states 2/4 covered (Database Loss, Server Redeployment). Credential Rotation and Device Loss are blocked. | Blocked: Requires Nick's Keychain for e2e; device loss cannot be tested without losing device. |

## Architecture and Interfaces
- **Producer**: `scripts/orion-backup` (shell script)
- **Consumer**: `scripts/orion_v2_backup_check.sh` (test fixture), human operator for restore.
- **Serialized fields**: Tar archive encrypted via OpenSSL; MANIFEST.json inside archive.
- **State ownership**: Local filesystem staging area; Keychain for passphrase (not created by script).
- **Errors**: Refusal on missing Keychain item, wrong passphrase, truncated archive, unknown schema.

## Smallest Next Slice
- **Proposed Contract 1**: Verify and document the redaction logic in `scripts/orion-backup` to ensure no secrets leak into backups.
  - **Scope**: `scripts/orion-backup` (read-only investigation), `docs/planning/offline-roadmap-results/phase-73-packet.md` (update).
  - **Acceptance Criteria**: 
    1. Identify the function/command responsible for redacting secrets.
    2. Confirm it handles JSON files containing credential-shaped values.
    3. Document the mechanism in this packet.
  - **Dependencies**: None.
  - **Existing Checks**: `doc-report`.
  - **Escalation**: If redaction logic is missing or broken, escalate as blocker.

## Test Scenarios
- **Positive Case**: Run `scripts/orion_v2_backup_check.sh` with valid fixture; expect all checks pass.
- **Failure Case 1**: Inject wrong passphrase into restore step; expect refusal/no data.
- **Failure Case 2**: Inject truncated archive; expect refusal.
- **Failure Case 3**: Disable redaction in backup script; expect check failure identifying leaked secret.

## Gates and Handoff
- **Entry Gate**: Phase 72 completed (entrySatisfied: true).
- **Remaining Hands-on Proof**: 
  - End-to-end restore with real Keychain item (requires Nick).
  - Device loss scenario (cannot be tested without losing device).
  - Credential rotation procedure (documented, not exercised).
- **Rollback**: None; this is documentation only.
- **Reviewer Handoff**: Verify cited symbols exist and proposed scopes are bounded.
