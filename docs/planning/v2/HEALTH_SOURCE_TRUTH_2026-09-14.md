# Health source truth — 2026-09-14

## Problem and resulting behavior

Installed build 225 exposed a Phase 34 presentation defect: missing WHOOP sleep
and strain readings became statements that nothing was recorded, accompanied by
high confidence borrowed from unrelated local app history. Available time in
bed was called sleep, followed by the same short-night advice even for a long
night. Provenance claimed comparisons with a personal baseline that this code
did not actually calculate.

The seven sections now report the available facts. Missing readings explicitly
leave sleep and workout activity unknown. Time in bed and sleep performance stay
distinct; no generic threshold or count becomes personalised advice. Local food,
water and journal entries do not borrow WHOOP confidence or imply that an
unlogged activity never happened. All seven sections remain present.

WHOOP history is counted per measurement, with Today using the weakest available
component. Trends use the actual displayed series. Unknown, invalid, future and
older-than-one-day aggregate measurement ages cannot produce high confidence.
The conservative age is the oldest available component's measurement period,
using the existing brief provenance helper; a network refresh does not make
old data current. The UI displays this qualification and updates each minute
while open. It does not claim that sample coverage is a personal baseline.

Duration formatting now rounds to the nearest minute (9.2 hours is 9h12, rather
than floating-point truncation to 9h11) and rejects overflowing conversions.
The headline tile says hours in bed, and the missing-summary fallback no longer
claims all page readings are live. The existing summary receives measurement
age rather than an unconditional unknown age.

## Decisions and boundaries

Suppressing unsupported interpretations was chosen over simply weakening their
adjectives: the source still would not establish personal capacity or a short
night. A real baseline comparison and validated health-aware planning remain
work to implement. This repair preserves the existing Phase 34 section contract
and numeric/clinical boundaries; it does not close Phase 34 or any REC gate.

Other Health headline/weekly-card interpretations, freeform Health summary
generation, connector Checking/Keychain lifecycle and component-specific date
labels remain separate work. The aggregate age is deliberately conservative:
one old component can lower confidence in otherwise recent readings. Historical
trend direction describes the stored series and does not establish current
health. No provider, medical recommendation, new permission or credential change
is introduced.

## Review and verification

The independent review found that even WHOOP's union of recorded days could
inflate an individual section's confidence. The adapter now counts each
measurement separately and a mixed-history regression covers many strain days
with only one sleep/recovery reading. Final review and verification results are
recorded below before checkpointing.

The earlier full native run passed 471 XCTest cases and 40 connection checks;
that run preceded the final minute-refresh, rounding and component-count edits.
Logs are retained under `.builds/health-source-2026-09-14/`.

## Installed state and next gate

Build 225 is currently installed; these Health changes are not yet installed.
The already-installed brief's optional local-model calendar selection was proven
on September 14 through Today → Read it, with correct civil date and agenda time.
See `BRIEF_GROUNDING_2026-09-12.md` for the actual observation and its limits.

After review/checks, create a scoped local source checkpoint and clean signed
candidate. Preserve build 225 under `.builds/health-source-2026-09-14/rollback/`,
verify unchanged designated requirement and saved plan, and inspect the actual
Health route. No external calendar/reminder edits or gateway restart are needed.
Unrelated `docs/planning/learning-proposals.md` is excluded; no remote push.

## Final source verification

Independent review cleared the repaired mixed-history finding; its final harness
passed 175 checks. The main final harness also passed 175 checks. Final full app
compilation passed in 5.82 seconds after the minute-refresh, duration and
component-count edits. The earlier full native wrapper passed 471 tests and
40 connection checks. Source/history secret scan is clean with the existing
reviewed allowlist; diff whitespace checks pass.

Build 225 rollback has been copied and deep-signature verified at
`.builds/health-source-2026-09-14/rollback/Orion-225.app`. The saved plan matches the
prior release fingerprint byte for byte, and there is no active focus session.
Next is a clean signed candidate and installed normal-route check.

## 2026-09-14 02:08 BST — build 227 installed and normal Health route proven

Clean source `7fdba72` produced signed build 227 (1.2.0) in 23.24 seconds. The
candidate, backup and installed deep signatures pass; designated requirement
exactly matches the existing identity. The installed executable matches the
candidate. Build 225 remains at the rollback path above, with an additional
previous application bundle recorded in install.json.

The ordinary Orion menu quit the old app, and the installed replacement launched.
Its real Health route first showed unavailable readings, all seven sections, low
confidence and the expanded source-age explanation. At 02:06, WHOOP refreshed
successfully. Actual Health UI then showed time in bed as 9.2 hours in the tile
and 9h12 in the section, reported sleep performance, recovery and strain, and
source-age qualifications. WHOOP's available history gave high confidence to
the corresponding sections, while the 14-reading trend remained moderate and
manual entries low. No synthetic fixture substituted for either observation.

Saved plan revision 8 remains byte-for-byte unchanged after quit, update, launch
and both Health states. No external record, new permission, credential or
gateway change was made by the agent. No protected Keychain dialog was operated.
Source refresh completed without an unresolved user-action gate. No screenshot
file was saved; the screenshots and AX observations are in the tool transcript.

Next: repair the separate freeform Health summary. Its actual refreshed text
asserted an immediate hydration need from an empty water log and treated a sleep
score category as below-personal-usual. These are remaining unsupported claims
in the older rail, not output from the repaired seven sections. Apply the same
factual rendering/validated selection boundary used by the brief, retaining the
Phase 33 raw-health privacy boundary. Other headline advice also still needs
review. No Phase 34 or REC closure is claimed.
