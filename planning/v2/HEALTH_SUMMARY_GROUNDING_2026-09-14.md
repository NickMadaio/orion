# Health summary grounding — 2026-09-14

## Problem and behavior

The actual installed build-227 Health rail told Nick to rehydrate immediately
from an empty water log, described a score category as below his personal usual,
and inferred training from a strain band. The prompt required interpretation and
one action, while the view rendered arbitrary prose if line parsing failed.
This was separate from the already-repaired seven factual sections.

Health now renders app-written source facts and manual log statements even when
the model is unavailable. A local model can select one listed fact to lead with,
using a single validated JSON ID; it cannot provide wording or advice. The rail
shows at most four rows, with all log controls and the seven sections retained.
It names the activity date explicitly because local logs follow the activity day
rather than midnight. Missing water, food and workout entries leave actual
activity unknown. A workout entry with no sets is distinguished from no entry.

WHOOP details expose only reading availability and the corresponding measurement
period, including a heart-only partial source. Fetch/edit times never substitute
for those periods. Raw measurements and score-derived personal-capacity claims
do not enter this model prompt. The actual source adapter is tested at this
boundary, not just a hand-written prompt fixture.

A shared NarrativeSelection parser serves Health and the existing brief. It
accepts only a small JSON object containing one allowed ID; unknown IDs, extra
fields, prose, malformed JSON and wrapped output retain the factual fallback.
Health uses selectionJSON through the real local client and writer, a new
health-choice-v1 semantic cache scope, and text(for: currentKey) at render time.
Legacy advice caches and selections for superseded facts cannot appear. All
fact-key changes, including workout updates, are observed by the view. Model
selection is optional; it is not a second source of health facts.

The visible generic-score coaching card was also removed. The headline names
available readings, the recovery tile names the WHOOP score, and strain is an
available cycle reading on the existing zero-to-21 scale rather than a
recommendation band. Other unused historical headline helpers and other product
surfaces are not claimed repaired. Finance's existing Takeaway parser is retained.

## Review findings and alternatives

Independent review found two partial-data defects. Heart-only snapshots initially
looked unavailable; they now receive a source detail without raw values. Removed
supplement IDs retained in daily history initially inflated the new listed-item
count; HealthFacts now intersects taken IDs with the current catalog, without
altering stored history. Both receive regressions against the actual producer.

Prompt-only caution was rejected because the old prompt already forbade generic
wellness advice and still produced it. Freeform prose filtering would likewise
leave unbounded factual claims. Factual rendering plus a validated ID makes
selection useful without giving it authority to invent a health conclusion.
This is not a personal-baseline or health-aware-planning implementation, and does
not close Phase 34, Phase 38 or a recovery gate.

## Verification and installed gate

The first full native wrapper passed 481 XCTest cases and all 40 connection
checks. The existing health firewall passed 38 checks. Final independent checks
after the two review repairs are recorded below before the source checkpoint.
Source/history secret scanning uses the existing reviewed fixture allowlist.
Logs are in `.builds/health-summary-2026-09-14/`.

Build 227 remains installed until the reviewed candidate is prepared. Preserve a
verified copy under `.builds/health-summary-2026-09-14/rollback/Orion-227.app`, use
the same designated requirement, and verify the saved plan around the update.
Next live gate: actual Health refresh, factual fallback, valid local-model
selection when returned, and absence of the earlier advice. No external source
record, credential, permission, gateway or remote push is needed. Exclude
unrelated `planning/learning-proposals.md`.

## 2026-09-14 07:36 BST — final source gate

Independent review cleared both partial-data findings. Final focused verification
passed 28 tests (12 Health summary tests, 12 brief narrative tests and four
client/writer boundary tests). The earlier full native wrapper passed 481 tests
and 40 connection checks before those two narrow fixes. Health firewall: 38
checks. Final source compiles through the focused run. Source/history secret
scan and diff checks pass. Logs and the verified build-227 backup are retained
under the release directory. No active focus session. Next: clean signed update
and actual Health selection/fallback verification.

## 2026-09-14 07:40 BST — build 229 installed; live source gate pending (95%)

Source checkpoint `882681a` produced clean signed build 229 (1.2.0) in 25.55
seconds. Candidate, rollback and installed deep signatures pass and the exact
designated requirement is unchanged. The installed executable matches the
candidate. Build 227 rollback and the additional previous bundle are recorded
in `.builds/health-summary-2026-09-14/install.json`. Quit used the ordinary Orion
menu; no active focus session was interrupted.

The actual Health screen shows the new factual fallback, correct activity date
and all seven sections. Empty water/food/workout logs explicitly leave actual
activity unknown. The previous arbitrary advice is absent. This is installed
UI evidence, not a fixture. Saved plan revision 8 is unchanged byte for byte.

WHOOP remains Checking and SecurityAgent is present. The user was asked to
handle the macOS Keychain prompt. Computer Use's protected-dialog restriction
remains in force; the agent did not operate the prompt or access credentials.
Source refresh and a valid optional Health model selection are not yet proven
on build 229. Zero-millisecond health-choice log lines on activity day September
13 came from tests and must not count as live model proof.

Next after source access clears: inspect already-installed Health, verify the
record dates and absence of the old coaching/advice, and observe an actual valid
optional selection if returned. Check the saved plan again. Do not rebuild or
reinstall just to resume this gate. Report 95% for this bounded repair until that
proof is obtained; this is not an overall program percentage. The source-history
secret scan is clean and no remote push or phase/REC closure occurred.
