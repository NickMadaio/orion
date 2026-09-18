# Phase 47 installed file-copy proof — 2026-09-18

File copying is installed and verified through the running gateway. Formal
roadmap remains46/85 complete (54%): independent review reopened the unsupported
Trash-recovery claim, so Phase47 remains in progress.

## Deployment

Deployed reviewed commit d7d80e8 from a clean detached checkout at
.builds/deploy-file-copy-d7d80e8. The protected dry run and actual deployment each
passed all seven required suites. Quick source checks include348 plugin tests;
network dependency auditing is skipped by that prescribed quick gate. The
candidate differs from prior production only in catalog.js, executors.js and the
new file-copy-helper.py. No permission or Mac application changes were required.

Production fingerprint: e0fbbeb7ab40, equal to the built candidate.
Helper SHA256:16ad90dc4693f18d158764c3e7116713d33a5f9a5d810dcf8e7d7c0d7023d555.
Gateway restarted, imported114 actions and5 profiles, and exposed orion_task_run.
Generated live TOOLS.md and the deployment checkout's authority snapshot refreshed.

Rollback snapshot: ~/.openclaw/backups/orion-control/20260918-035928, also copied
into .builds/phase-47-76-2026-09-17/rollback/20260918-035928. Previous production
fingerprint b25f0d951bda. Restore that snapshot using the controlled deployment
rollback process and restart/re-probe the gateway; do not mistake a file restore
alone for proof that the process reloaded it.

## Actual route evidence

All requests used the normal gateway agent route and orion_task_run, without an
exec fallback or fabricated trust anchor. Ledger authorization came from the
host session transcript. Test files are disposable and isolated under
~/.openclaw/orion-controlled/test-workspace/copy-proof-d7d80e8/.

- Copy task orion-c6541141318a7284 succeeded with observed SHA256 verification.
  source.bin and copied.bin are292 identical bytes. Source is unchanged.
- Collision task orion-99ee465ff55d4497 failed permanently because existing.bin
  already exists. Independent hash checks confirm its original bytes remain.
- Source/copy SHA256:bffe9e61995f3b9f039147a8fd19ccd27f4af62cad272448517066e154dda511.
- Personal plan, permission state, exec approvals, gateway configuration and
  strictness file are byte-identical before/after deployment and proof.

Logs, extracted ledger rows and hash assertions are in
.builds/phase-47-76-2026-09-17/. No external delivery was requested.

## Remaining human gate and evidence corrections

Independent review found old Phase47 descriptions wrongly said every action
accepts root and restricted mode disables all reads. Corrected: mutation roots
are explicit; read roots can be fixed by the action definition; restricted mode
retains desktop_read but not file_mutate. Phase46 prerequisite deviation remains.
Earlier list/read/move rows retain catalog-level evidence, not new execution proof.

The old Trash-recovery passed row cited implementation only. Reopened it until
an actual disposable file is moved to Trash and recovered with matching bytes.
Task orion-6ee35569ffd021a2 correctly stopped at needs_approval. Pending ticket
A-QZV3 covers only copied.bin, expires2026-09-18 04:16:47 BST. Nick must run the
human-only orion-approve command himself. No deletion or approval occurred.
If expired, request a new scoped ticket instead of bypassing the gate.

Next after approval: retry exactly the same file_delete arguments through the
normal gateway route, verify the recorded Trash destination and recover the
exact fixture without overwriting anything. Preserve source.bin/existing.bin.
