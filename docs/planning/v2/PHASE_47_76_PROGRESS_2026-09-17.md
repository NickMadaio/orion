# Phase 47 and 76 progress — 2026-09-17

Formal roadmap: **46/85 phases complete (54%)**, up from45/85. Phase76 is now
closed following a reproduced defect, repair and independent verification.
Phase47 remains open until file copying is installed and proven on the live route.

## Phase76: deployment candidate deferral check

The deployment script already passed ORION_CATALOG_DIST, but the checker ignored
it and inspected the previous installation. That allowed a proposed update with
a deferred capability to pass behind a clean installed catalog. The checker now
honors the candidate directory and explicitly refuses missing/malformed catalogs.

Four unittest tests reproduced four failed assertions before repair. They pass
now: a safe candidate passes, purchasing and actual email sending fail, and
missing/malformed candidate code fails. Independently rerun tests and both actual
installed/candidate checks pass:15 deferred features across3 surfaces. Phase gate
validation passes. Phase76 is a policy smoke alarm, not proof about arbitrary code.
Phase75 remains incomplete; its pre-existing prerequisite deviation is retained.
No connected-product recovery gate was closed by this result.

## Phase47: bounded file copying

The candidate now has file_copy under the existing file_mutate tier: same root,
regular files up to64MiB, visible paths, no directory trees or overwrite. Copies
use private0600 files; they copy content, not extended metadata. The controller
uses its existing authorization gate. Copied material is not marked self-authored.

A fixed Python3 stdlib helper opens directories relative to held descriptors,
refuses symlinks at each component and bounds reads. It writes/fsyncs/closes a
private temporary file before publishing with an exclusive hard link. The source
and destination hashes are independently verified. A manual Trash inverse is
recorded with a hash to check before acting; no automatic destructive undo occurs.

Independent review found three defects and all were addressed:

- Cleanup failure after publication could hide a committed copy. The result now
  survives with the temporary name recorded for cleanup.
- Failed verification used success-shaped evidence. It now reports separate
  source/destination match booleans.
- String-path operations allowed ancestor replacement to redirect access. The
  descriptor-based helper prevents symlink redirection. An adversarial test swaps
  an ancestor to a sibling outside the authorized root after descriptors open:
  the original directory is used, outside remains untouched, and later verification
  refuses the changed path. Held directory identity, not a mutable path string,
  determines the operation.

## Validation and installed state

- 348 plugin tests pass across13 files, including7 new copy checks.
- 8 Python tests pass (3 helper adversarial/failure checks,4 deferral checks and1 deployment packaging check).
- TypeScript build and compiled candidate controller copy/verification pass.
- Independent final reviews clear for file copying and Phase76.
- A pre-existing test assumed New York. It now constructs local civil dates and
  checks both midnight edges, so the same test runs correctly in London.
- Candidate data inventory check passes:17 entries,32 tiers. Copy temporary-data
  handling is documented. Source/history secret scan result is in the evidence log.

The deploy path explicitly ships and fingerprints the Python helper; an isolated
packaging test verifies that the real copy loop includes it and excludes tests.

Evidence: `.builds/phase-47-76-2026-09-17/`. The installed catalog was checked and
still lacks file_copy. No gateway restart, installation, permission change, account
setup, external message or remote push occurred. The Mac app and saved plan were
not modified. No hands-on user step is required for this checkpoint.

## Other audited phases remain open

Phase57 needs a correctly wired bounded automation runner (expiry, conditions,
limits, failure handling), correct delivery arguments/timezone and truthful removal.
Phase63 needs explanations for actual plan decisions and execution-time evidence.
Phase67 has unenforced automation/remote-session budget fields and inconsistent
JSON task-breach reporting. Phase75 still lacks staging/validation, fails to bind
review to changed scope and treats workflow failures as nonfatal debt. Their old
passed requirement text is not sufficient evidence to close them.

Next: prove file_copy through a controlled installed route, then prioritize the
identified automation runtime defects. Host/phone durable enrollment remains open.
Rollback: revert the scoped local checkpoint; nothing was installed. Preserve
unrelated capabilities.md and existing personal data.

## September 18 deployment prerequisite review

Independent review also cleared production helper packaging/fingerprinting.
The full source preflight found a missing capability-registry entry. Regeneration
now adds only file_copy, with reads_files/writes_files effects; independent review
confirmed all existing entries unchanged. The candidate registry has114 actions.
The complete quick source preflight passes, including348 plugin tests and policy
parity. All six additional deployment suites pass: coverage, strictness (33),
authority, lock, remote and phase-gate consistency. Network dependency auditing
was skipped by --quick. These suites were run directly, without installation or
bypassing the dirty-tree deployment guard. Evidence: preflight-*.log alongside
the earlier logs. Installed file-copy proof remains outstanding.
