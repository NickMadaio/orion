# Personal plan publication to Simulator

Updated 2026-09-15 14:09 BST. **Bounded personal-plan publication: 100%.**

The Simulator now displays the actual accepted Mac plan through a local read-only
service. Revision8, its original generation date, reason and two blocks matched
the source during visual inspection. The old plan was explicitly marked stale.
The original file stayed byte-for-byte unchanged. This is personal data through
the real route, extending the earlier synthetic-only connection proof.

## Use it

From `/Users/nickmadaio/Desktop/ORION`:

```bash
python3 scripts/orion_phone_preview.py --source "$HOME/.openclaw/orion-controlled/today-plan.json"
```

It opens a five-minute Simulator preview. Add `--seconds 60` for one minute or
`--verify` for an automated read/refresh check. It exits cleanly on timeout or
Ctrl-C. Each refresh revalidates the explicitly configured source; it never
changes that source or accepts a new plan.

## Proof and review

- Actual Simulator UI read and refresh passed against the personal revision 8 file.
- A separate normal 15-second preview opened and exited successfully.
- Source hash was unchanged; the temporary Simulator credential file was absent after cleanup.
- 123 combined backend/publication/auth/cleanup tests passed, including source failure, rollback, recovery and owner isolation.
- Independent review passed three publication tests and caught relative paths resolving after a directory change. Resolution now happens in the caller’s directory. No remaining review findings.
- Relevant tests rerun after repository reorganization. The history scan found six previously reviewed fixture paths dropped by the path rewrite (736 historical occurrences). Restored only their exact pre-existing path/rule/fingerprint entries; no new credential values or blanket exceptions were allowed. Independent review confirmed the restoration, and the full history scan is clean (3311 reviewed occurrences).

The publication failure scenarios use controlled exports; no personal source was
corrupted or edited for testing. The existing transport rejection limits retain
their prior proof limits. No physical phone, production account, TLS, persistent
remote connection or external records were changed. No REC/phase closure.

## Work through the code

1. [Preview command](/Users/nickmadaio/Desktop/ORION/scripts/orion_phone_preview.py)
2. [Publication repository](/Users/nickmadaio/Desktop/ORION/backend/local_today/publication.py)
3. [Publication regressions](/Users/nickmadaio/Desktop/ORION/tests/test_today_publication.py)
4. [Phone instructions](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/README.md)

Logs/screenshots: `.builds/personal-phone-2026-09-15/` and
`.builds/personal-phone-preview/`. The Mac remains build 232. No permanent service
was installed; temporary personal database copies and session files were removed.
Rollback: revert the local source checkpoint; no real-data migration to reverse.

Next: persistent device/account identity and a deliberate pairing flow, then
remote transport. This preview is local to the Mac’s Simulator. Formal roadmap
remains 45/85 phases marked complete (53%), not a product-readiness percentage.

![Actual accepted plan in Simulator](/Users/nickmadaio/Documents/Codex/2026-09-07/af/outputs/orion-personal-phone-plan.png)
