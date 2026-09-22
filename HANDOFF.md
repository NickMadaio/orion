# HANDOFF — ORION

**Last updated 2026-09-21.** This is the only handoff. If you find another one
that is not `docs/planning/v2/HANDOFF.md` (kept solely because `PHASE_GATES.json`
cites it as evidence for phases 1–33, and marked CLOSED at the top), it is stale
and should be deleted rather than read.

Read this, then `AGENTS.md` for how the codebase works, then `NICK-TODO.md` for
what Nick himself is waiting on.

---

## 2026-09-22 — Task-level escalation, measured model choice (Claude)

THE CONTINUITY FIX. Escalation was run-level: one BLOCKED review stopped
everything, and independent tasks sat untouched until morning. That contradicted
the stated intent directly. Schema v3 makes escalations a list, each naming a
task or the run; a task-level one parks that task alone and the loop carries on.
`escalated` now means "nothing claimable remains", not "an escalation exists" —
and the panel tells those apart, because conflating them teaches you to ignore
the alert. Proven end to end: a BLOCKED review parks one task while an
independent one still runs, reviews and commits.

Also fixed the defect three separate models tripped over: the reviewer was shown
the cumulative run diff and asked whether THIS task violated its scope. It saw a
forbidden file modified — by a task it had already accepted — and escalated.
`diffForCheckpoint` shows one checkpoint. That bug killed 2 of 3 benchmark runs
and read as model confusion.

Reviewer now RE-RUNS the contract's checks rather than trusting the worker's
report; a disagreement is a `contradiction` escalation. Subtasks exist durably
(`### SUBTASK: 2/4 label`), owned by the runtime, shown in the panel, with no
authority over acceptance. Informational Discord tier for reviewer repairs —
one line, own rate limit, never asks for anything. Bare-minimum repair tightened
6 files -> 2.

MODELS, MEASURED. Eight candidates, two evals, 15 reviewer runs, cross-checked
against published SWE-bench. qwen3.6:27b both roles: 3/3 planted defects with
zero false positives every run, 77.2% SWE-bench, and one model means residency
never changes. The quantized 80B codes well and reviews badly (1/2 judgment
defects, 4/4 runs) which matches published work on MoE routing damage under
aggressive quantization; it is retired. Model choice is settable from the UI;
`enabled` stays a deliberate file edit.

65 Node tests, 503 Swift cases, layout harness green, CI --quick OK, secret scan
clean. Still NOT run against ORION code; still gated on agentic-config.json
{"enabled": true}, which does not exist.

---

## 2026-09-21 20:1x BST — Project agent UI and the live reasoning channel (Claude)

Two clocks, not one: plan progress from accepted task WEIGHT, current-task
progress from the recorded stage. They answer different questions and one ring
would answer neither. Neither number comes from a model.

Inference now STREAMS, which is what makes a live reasoning channel possible and
also makes "it is thinking" an observed fact — a non-streaming request to a 27B
is indistinguishable from a dead runtime for nine minutes at a time. The trace
goes to activity.json: one disposable snapshot, throttled to ~400ms, never
fsynced, deliberately NOT the journal, which reasoning traces would bury.
Thinking transitions bypass the throttle because a lagging indicator cannot do
the one job it has.

Panel also reads the agent's own operating-system prompts from the repository
(never duplicated), marks review-authored tasks, surfaces reviewer-authored code
as work that was not independently reviewed, and shows settings READ-ONLY —
`enabled` lives outside the repo so moving it takes a deliberate act, and a
toggle in a window is not that act.

Streaming exposed that probe() checked a model was installed but not usable as
configured: `think: true` against a model that does not support thinking is a
400 on every generation, i.e. a run that does nothing all night. probe() now
does a one-token generation per role.

Verified by measurement, not by looking: Tests/run-project-agent-ui.sh lays the
real panel out in a real NSHostingView and checks the reasoning channel keeps a
viewport inside the dashboard's ScrollView (+133pt for a 6000-char trace). That
is the nested-same-axis-ScrollView defect this repo already lost time to.

Fixed a PRE-EXISTING breakage on the way: every GUI harness in native/Orion/Tests
was failing with "no such module 'MobileCore'" because SessionService began
importing it from OrionMobile and build-modules.sh never built or linked it.
LayoutHarness is still red for an unrelated reason (BreakSurface.isFullBleed).

59 Node tests, 503 Swift cases, CI --quick OK, secret scan clean. Still NOT run
against ORION code; still gated on agentic-config.json {"enabled": true}, which
does not exist.

---

## 2026-09-21 16:2x BST — Local agentic development runtime (Claude)

Built the unattended local development loop Nick specified: a ~27B worker
implements against explicit task contracts, a stronger local model reviews
against those contracts, and a deterministic supervisor owns every gate. Mission
recorded at docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md; design and the
eleven deviations at docs/agentic/ARCHITECTURE.md; transfer at
docs/handoffs/CLAUDE_TO_ASTRA_AGENTIC_RUNTIME_HANDOFF.md.

Controller moved v1 -> v2 in place: full contracts, PASS / PASS_WITH_TASKS /
BLOCKED, bounded reviewer repair recorded SEPARATELY from reviews, escalation
state the loop cannot clear itself, append-only journal, lease with PID+boot+
start-time proof, crash recovery that discards partial writes to the last
accepted commit. Astra's 12 tests still pass unchanged in substance.

Worker gets a fixed tool vocabulary, never a shell; checks are registry names
with fixed argv, never strings from a task. Writes pass four gates, the last of
which loads ORION's INSTALLED self-change policy and fails closed. Reads are
deny-listed for var/brain/, .env and key material. Discord escalation carries a
phone-readable brief; Astra escalation stays MANUAL and pauses the run.

54 Node tests, 8 Swift tests (247 in the full app suite), CI --quick OK, secret
scan clean. Xcode license is now accepted, so the native build and XCTest run.
Tests caught three real bugs, including a `git status --porcelain` trim that
truncated the first changed file's path and would have wasted a whole night.

NOT RUN against ORION code. Execution is gated on ~/.openclaw/orion-controlled/
agentic-config.json {"enabled": true}, which does not exist. No 80B reviewer is
installed, so that half of the hierarchy is untested. Legacy scripts/orion-code
and GOVERNED_SELF_DEVELOPMENT_ENABLED untouched; do not launch the legacy loop.
No push, deploy, install or config write. capabilities.md and all worktrees
preserved. No numbered gate closed; scopeNotInManifest entry updated.

---

## 2026-09-21 15:31 BST — Disabled project-agent foundation; handoff to Claude

User requested stopping at a stable source checkpoint and a technical handoff,
not further agentic-workflow implementation. Authoritative transfer details:
docs/handoffs/ASTRA_TO_CLAUDE_AGENTIC_LOOP_HANDOFF.md. This is a scoped transfer
record; this file remains the live project handoff.

Built fixture-only durable controller, revisioned operator CLI and source Projects
view integration. No worker/model/reviewer transport enabled, no production run
state initialized, no app deployment. Independent review's three defects fixed:
lifecycle corruption, verification after timeout and pending steering at closure.
12 controller tests pass independently. Native status typechecks; six standalone
checks pass. Full native app build/XCTest blocked by unaccepted Xcode license.
Do not treat syntax checks as UI build proof. Existing self-development enablement
flag remains false. New scope registered without altering numbered gates.

46/85 complete (54%),25 in progress,14 not started. Preserve capabilities.md,
existing worktrees, personal state and installed configuration. Next work belongs
to Claude after this checkpoint; do not launch the legacy coder as a substitute.

---

## 2026-09-21 09:19 BST — Scheduler entry point and guarded preview

Added scripts/orion-automation-run and a sanitized tick adapter: accepts only an
installed name, evaluates the current minute through the guarded runtime, emits
status/reason only, and never prints calendar output into scheduler history.
Added human CLI schedule-plan <name> --timezone <IANA> with explicit expiry,
conditions, limits and derived argv. Installed OpenClaw help confirms --cron,
--tz and --command-argv; the old --schedule/--timezone route was obsolete and
bypassed runtime limits. Removed that route; install now explicitly refuses
until guarded registration exists. Existing jobs and removal are untouched.

Plan specifies disabled creation, exact timing and no fallback delivery. It is
not an installation. No scheduler job, installed policy or ledger was created.
Evidence: .builds/phase-57-schedule-2026-09-20/ (initial CI, installed CLI help,
actual install refusal) and .builds/phase-57-schedule-2026-09-21/ (final tests and
scan). Report: docs/planning/v2/PHASE_57_SCHEDULE_2026-09-21.md.
Review caught host-local expiry in the preview; fixed selected-zone current-date
and180-day validation plus invalid clock refusal.82 automation tests pass
independently; quick source CI passes348 plugin tests and82 automation tests.
Secret scan clean; dependency network audit skipped.

Overall46/85 (54%) unchanged. Next: human-only transactional registration of
policy/ledgers and a disabled job, exact read-back verification, then activation
and disposable full-route proof. Missed trigger minutes are not caught up.
No new hands-on task. Preserve capabilities.md. Rollback scoped source checkpoint;
no production schedule restoration needed. Checkpoint local, not pushed.

---

## 2026-09-20 01:44 BST — Candidate installed-policy executor

Added scripts/lib/orion-automation-runtime.mjs: reads existing installed record,
requires initialized runtime ledgers, dispatches exact agenda_today, rereads
policy and conditions before launch, then checks current authority. Explicit
installation timezone, bounded subprocess time/output, no inferred retry safety
after launch. No scheduler entrypoint, installation initialization or sender.
Extracted shared pure condition check from admission to prevent rule drift.

Independent review reproduced revocation during a slow final context probe;
fixed ordering so final authority is checked after context/record checks. All74
automation tests pass independently, including real disposable subprocess success
and write-then-fail/no-retry, policy changes, revocation, expiry/focus/mode and
midnight/quiet boundaries. Source quick CI and secret scan recorded in
.builds/phase-57-runtime-2026-09-20/. Report: PHASE_57_RUNTIME_2026-09-20.md.

Overall46/85 (54%) unchanged. No real calendar command, schedule, permission,
installed plugin or personal state changed. Next human installer migration and
scheduler entrypoint, followed by disposable complete-route proof. Existing old
installed records lack new ledger/identity fields and deliberately refuse. Policy
checks and process spawn are not atomic; timeout does not prove descendant
cancellation. No new hands-on task; preserve capabilities.md. Rollback scoped
local source checkpoint, no live restoration needed.

---

## 2026-09-20 01:08 BST — Live read-only automation host checks

Added scripts/lib/orion-automation-host.mjs: fresh installed authority map,
bounded native session status probe, conservative legacy focus handling and
eligibility for exact agenda_today only. No executor, installation grant or sender.
Unknown focus remains unknown; revoked/ambiguous authority refuses. Source-map
AUTO alone never enables standing routines or daily rollup. Candidate catalog
fallback and CLI mode/profile overrides refuse.

Live read-only proof: guarded mode, focus inactive, agenda eligible, standing
refused. No action, schedule, permission, installed plugin or personal-plan change.
11 host tests plus existing52 pass (63 total). Full quick CI passes348 plugin
tests and initial60 automation tests; final63 pass after extra review coverage.
Independent review and evidence recorded in PHASE_57_HOST_2026-09-20.md and
.builds/phase-57-host-2026-09-20/. Dependency network audit skipped by --quick.

Overall46/85 (54%) unchanged. Next: installation-bound production executor with
fresh authority at effect boundary, human installer wiring and disposable full
route proof. These checks establish eligibility, not an execution grant. Outbound
authority/transport remain absent. No new hands-on step. Preserve capabilities.md.
Rollback scoped local source checkpoint; nothing deployed by this slice.

---

## 2026-09-19 17:26 BST — Candidate delivery budgets and separate outcomes

Extended admission with separately keyed message reservations (0..48/day) and
candidate dispatcher with explicit installation-bound target plus exact-body
outbound authorization. Fresh conditions/expiry checked after action, reservation
and delivery-pending receipt persisted before fixture transport. Action completion
is separate from delivery failure/uncertainty; no automatic message retries.

Independent review reproduced cross-ledger clock regression permitting an extra
message; fixed delivery time floor against successful action admission.52 tests
pass independently (12 delivery+17 dispatch+15 admission+8 removal). Full quick
CI passes348 plugin+52 automation checks; dependency network audit skipped. Tests include
process contention and real exits before/after simulated delivery. No real sender,
schedule, permission, installed plugin or personal state changed. Report:
docs/planning/v2/PHASE_57_DELIVERY_2026-09-19.md; evidence:
.builds/phase-57-delivery-2026-09-19/.

Overall46/85 (54%) unchanged. Next production authority/context/execution/transport
adapters, human installer wiring and disposable complete-route proof. Provider
idempotency, approval consumption and power-loss recovery remain unproven. No new
hands-on task for this slice. Preserve capabilities.md; rollback scoped checkpoint.

---

## 2026-09-19 16:47 BST — Candidate automation dispatcher executes through guard

Built scripts/lib/orion-automation-dispatch.mjs around the durable admission
guard: fixed action table, installation fingerprint, trigger timing/replay guard,
exclusive execution lock, pending receipt, per-attempt authority/quota checks,
bounded safe retry and durable stopped/unknown states. No production adapters,
installer wiring or notifications enabled. Fixture proves actual disposable file
effect and refusal to replay it. No live schedule, permission or plugin change.

Review found ready state during retry could allow execution after adapter failure;
fixed to remain pending. Independent40 tests pass (17 dispatcher,15 admission,
8 removal), including real child exits and receipt publication faults. CI includes
all three suites. Full quick CI passes348 plugin+40 automation checks; dependency
network audit skipped. Report: docs/planning/v2/PHASE_57_DISPATCH_2026-09-19.md; logs:
.builds/phase-57-dispatch-2026-09-19/.

Overall46/85 (54%) unchanged; Phase57 remains open. Next production authority/
context/execution adapters plus message budgets, then human installer wiring and
disposable end-to-end proof. daily_rollup cannot be assumed retry-safe after an
ordinary process failure. No new hands-on task; old Trash ticket remains expired.
Preserve capabilities.md and personal state. Roll back scoped checkpoint only.

---

## 2026-09-18 13:40 BST — Durable automation admission guard built, not connected

Implemented scripts/lib/orion-automation-admission.mjs with explicit state
initialization, installation-bound policy, zoned inclusive expiry, daily attempt
limits, quiet/focus/effective-mode checks and fail-closed durable reservation.
Independent review found inconsistent day/timestamp could replenish quota; fixed
with stored-state invariants and regression tests.15 admission+8 removal tests
pass independently, including competing child processes, persistence failures and
process exits around atomic replacement. Full quick source CI passes348 plugin
tests and23 automation checks; network dependency audit skipped.
Report: docs/planning/v2/PHASE_57_ADMISSION_2026-09-18.md; evidence:
.builds/phase-57-admission-2026-09-18/. No real schedules/actions/state initialized.

This is admission-only. Installer/dispatcher/message limits/retry/trigger identity
and actual action authority remain unconnected. Phase57 expiry remains blocked;
46/85 (54%) unchanged. Next build bounded dispatcher, then fix install wiring and
prove disposable end-to-end execution. Existing Trash ticket expired ungranted;
no new hands-on step needed for this slice. Preserve capabilities.md and test
copy fixtures. Rollback scoped source checkpoint, no live restoration required.

---

## 2026-09-18 11:58 BST — Truthful automation removal; expired test approval

User continued after the earlier Trash ticket expired. Read-only check showed
A-QZV3 has no grant; no deletion occurred. Do not treat continue as granting the
human-only action. File-copy deployment d7d80e8 remains verified. Installed proof
and corrected Phase47 evidence saved in local checkpoint c07dc48.

Fixed Phase57 remove falsely reporting success after scheduler errors: complete
JSON list, exact unique name/ID, post-removal absence verification, no local
transition on uncertainty. Warn active tasks may finish.8 isolated tests plus
full quick CI (348 plugin tests) pass; independent code/CI reviews clear.
No real scheduler mutation. Read-only automation list:0 proposed,0 installed.
Report: docs/planning/v2/PHASE_57_REMOVAL_2026-09-18.md.

Corrected expiry evidence: required expiresOn metadata is not runtime enforcement.
Phase57 expiry is blocked; Phase58 dependency flag updated. Overall46/85 (54%).
Next implement bounded automation runner enforcing expiry/conditions/limits before
fixing install wiring. Trash recovery needs a fresh scoped human approval when
Nick is ready. Rollback scoped checkpoint; no production schedule restoration.
Preserve capabilities.md and disposable copy proof files. No remote push.

---

## 2026-09-18 04:02 BST — File copying deployed and proven; human Trash gate pending

Protected clean-checkout deployment of d7d80e8 passed rehearsal and all live
deployment suites. Installed/built fingerprint e0fbbeb7ab40. Gateway restarted,
114 actions loaded and normal tool discovery passed. Real copy and overwrite
refusal proven in ledger plus independent byte checks. Personal plan/config and
authority files unchanged. Mac app unchanged. Rollback snapshot20260918-035928
also saved under .builds/phase-47-76-2026-09-17/rollback/.

Independent review corrected inaccurate Phase47 scope prose and reopened Trash
recovery: previous passed row showed implementation, not actual recovered bytes.
Copy requirement passes; Phase47 and predecessor deviation remain open. Overall
46/85 (54%). Details: docs/planning/v2/PHASE_47_LIVE_COPY_2026-09-18.md.

Hands-on step presented immediately: Nick runs scripts/orion-approve A-QZV3 in
Terminal, for only disposable copy-proof-d7d80e8/copied.bin. Ticket expires04:16:47
BST today. The assistant must not grant it. No deletion happened. Once approved,
retry exact file_delete through gateway, inspect recorded Trash destination,
recover fixture and compare bytes. If expired obtain a fresh ticket. Preserve
unrelated capabilities.md; no remote push. The isolated deployment checkout's
audit-generated JSON changes are ours, not release source changes.

---

## 2026-09-18 03:17 BST — File-copy packaging and deployment prerequisites verified

Final independent review cleared helper packaging and fingerprinting. The full
candidate source preflight then caught file_copy missing from the capability
registry; the generator now records source-preserving read/write effects and
regeneration adds exactly one action (114 total), leaving all previous entries
unchanged. Independent review verified that result and the generated JSON.

After repair, the full quick source suite passes (348 plugin tests, typecheck,
schema, policy/catalog contracts, source secret scan and document checks). All
six other deployment suites pass: coverage, strictness (33 checks), authority,
lock, remote and phase-gate consistency. These were invoked directly against
the candidate; this was not an installation or a clean-tree deploy rehearsal.
Dependency-network audit was skipped by --quick. Evidence: preflight-*.log in
.builds/phase-47-76-2026-09-17/. Earlier source/history scan was clean with3671
reviewed allowlisted findings. The saved personal-plan hash is unchanged.

Formal progress remains46/85 (54%). File-copy installed-service proof remains
open. No restart, install, authority change, remote push or hands-on user step.
Save the scoped reviewed batch locally, preserving unrelated capabilities.md.
Next: prepare a clean deployment candidate, compare all candidate/installed
production differences, then controlled deployment and actual tool-route copy
verification. Do not bypass the dirty-tree gate to sweep unrelated work into a
release. Rollback this local checkpoint; production has not changed.

---

## 2026-09-17 09:07 BST — Phase76 closed; file-copy candidate built and reviewed

User asked for substantial total-percent progress. Audited numbered phases rather
than inflating phone sub-checkpoints. Fixed Phase76 checker ignoring deploy's
ORION_CATALOG_DIST: four before-fix assertion failures now pass, unsafe/missing/
malformed candidates refuse, installed+candidate audits pass. Independent review
cleared closure as a smoke alarm only, retaining Phase75's prerequisite deviation.
Formal roadmap is now46/85 complete (54%),25 in progress,14 not started.

Built file_copy for Phase47 under existing file_mutate authority: regular files
up to64MiB, same mutable root, no overwrites, descriptor-relative no-symlink I/O,
verified hashes and manual hash-checked Trash inverse. Copied inputs do not become
self-authored. Review found cleanup-result loss, misleading verification evidence
and ancestor-swap exposure; repaired with failure/adversarial tests. Final review
clear.348 plugin tests/8 Python tests/build/compiled controller proof pass. Candidate
inventory passes17 entries/32 tiers. Source/history scan log in evidence folder.

Installed catalog still lacks file_copy; Phase47 deliberately remains open pending
controlled deployment and live route proof. No gateway restart, permission changes,
physical-phone setup, Mac app install or remote push. No hands-on step yet. Report:
docs/planning/v2/PHASE_47_76_PROGRESS_2026-09-17.md; logs:
.builds/phase-47-76-2026-09-17/. Preserve capabilities.md. Revert scoped checkpoint
for rollback; no production state restoration needed.

Independent audit also exposed actual remaining Phase57/63/67/75 gaps; report
lists them. Do not close those from historical passed requirement rows. Next:
installed copy proof, then automation runtime enforcement defects. Persistent
phone enrollment remains open; no total progress claim was based on saving labels.

---

## 2026-09-17 03:34 BST — Remember and forget local connection details

Added an off-by-default Remember this connection choice to explicit review. Only
successful approved reads save display metadata, bound to the phone fingerprint;
no token, grant or plan is persisted. Control displays the record after normal
relaunch without connecting. Forget cancels pending work, clears live reading
and removes the saved record. Invalid metadata is not treated as verified.

All15 Swift tests pass. Actual Simulator opt-in/read/disconnect/relaunch/forget/
relaunch passes; cancellation with opt-in enabled saves nothing. Both scenarios
retain exchange/fallback-refusal/durable-revocation checks. Physical iOS compiles
unsigned only. Independent source review has no actionable findings. Report:
docs/planning/v2/REMEMBERED_CONNECTION_2026-09-17.md. Evidence:
.builds/phone-remember-2026-09-17/ plus phone-pairing-check xcresults.

This is display history, not durable account enrollment or reusable read authority.
No hands-on step required. Roadmap53% unchanged; Mac build232 and personal plan
hash unchanged. No production install or remote push. Next: durable host-side
read authorization tied to approved enrollment, retaining fresh phone-key proof
and revocation on every read; then connect that to user-controlled phone setup.
Rollback scoped checkpoint and use Forget for an opted-in record. Preserve
capabilities.md and persistent device keys.

---

## 2026-09-16 17:35 BST — Explicit local phone connection review

The Simulator can now review a validated local setup before exchanging its grant.
Connect uses the immutable reviewed value; decline makes no request. Cancel
connection prevents delayed exchange completion from installing a token or
replacing disconnected state. Review mode excludes legacy bootstrap loading.
Optional --review-connection on timed personal previews waits at most90 seconds
for approval/first read, then applies the existing bounded preview timer.

Actual review/decline/relaunch/approve/read/disconnect and delayed signed-exchange
cancellation scenarios pass. Cancellation reached both exchange endpoints but
made zero plan reads. Standard HTTP read/outage/recovery/revoke/fallback regression
also passes. Physical iOS compiles unsigned only. Independent review found no
open issues. Report: docs/planning/v2/PHONE_CONNECTION_REVIEW_2026-09-16.md.
Logs: .builds/phone-setup-review-2026-09-16/; UI xcresults in phone-pairing-check.

Still disposable account enrollment; this is explicit connection review, not
persistent account setup. Human-operated reviewed-preview invocation not claimed
as proven. No hands-on action required for this slice. Roadmap53% unchanged.
Mac build232/personal plan unchanged; no production install or remote push.
Next: durable user-approved configuration/enrollment and physical transport.
Rollback scoped checkpoint; preserve unrelated capabilities.md.

---

## 2026-09-16 15:05 BST — Immediate phone reading disconnect

Found that the authenticated phone reader had no local off control. Control now
clears its token, snapshot and history, cancels active transport and invalidates
old callbacks with a connection generation. This is local disconnect, not server
membership revocation; the UI states that distinction. Pending-refresh cancellation
is visible. Existing explicit harness launch may reconnect from development setup.

Actual Simulator delayed-refresh disconnect passes, including proof that refresh
was pending at the tap and that later completion cannot restore state. Independent
review caught a timing-test gap; synchronous pending-state evidence fixes it, final
review clear. Existing HTTP read/outage/recovery/revoke and fallback refusal pass.
Generic physical iOS compile passes unsigned only. Evidence:
.builds/phone-disconnect-2026-09-16/; report:
docs/planning/v2/PHONE_DISCONNECT_2026-09-16.md.

Mac remains build232; saved revision8 hash unchanged. No hands-on action required
for this slice, no new account/provider or physical installation. Roadmap53% stays
unchanged. Persistent user-approved setup remains next; immediate disconnect is
now a tested prerequisite. Preserve capabilities.md. Rollback scoped checkpoint;
no installed production state changed and no remote push.

---

## 2026-09-16 14:46 BST — Authenticated personal plan and timed preview

The previous HTTP exchange checkpoint used synthetic data. Explicit --source now
publishes the saved personal plan through that persistent-key authenticated route;
--preview-seconds 1..120 opens a timed Simulator preview after the first successful
read. Source remains read-only; revocation, listener shutdown and matching setup
cleanup run on exit/interruption. Enrollment is still a disposable account fixture.

Actual revision8 read/refresh/revoke-clearing and 15-second preview pass. Screenshot
visually matches the saved stale plan. Source SHA256 remains a4111fae45135cfc2bd14b48b07f761df286bb63b2de5cdd11c707779ff0a5b1.
156 backend/publication tests and synthetic HTTP regression pass; invalid CLI
options refuse before build. Temporary setup/pairing files confirmed absent.
Independent personal-publication and timed-preview reviews have no open findings.
Report: docs/planning/v2/AUTHENTICATED_PERSONAL_PLAN_2026-09-16.md; evidence:
.builds/personal-auth-read-2026-09-16/ (including secret-scan.log).

Bounded authenticated personal preview milestone100%; formal roadmap53% unchanged.
Mac build232 remains untouched; no production account, physical deployment,
provider, permanent service or remote push. Preserve unrelated capabilities.md.
Next: persistent user-approved enrollment/configuration, then physical transport;
work from the phone identity/session modules and local device registry contracts.
Rollback this scoped local checkpoint; no production state restoration required.
The legacy personal preview remains available separately for regression comparison.

---

## 2026-09-16 09:07 BST — Phone session challenge/proof/token over HTTP

LocalSessionExchange issues120-second trusted-host bootstrap grants fixed to an
owner/device/key, then accepts one signed exchange. Optional loopback POST routes
validate bounded exact-length JSON, no duplicate framing/fields; plan writes and
other verbs remain refused. Simulator PhoneHTTPReadSession gets challenge,
signs with persistent key and receives read token entirely over HTTP; token is
memory-only. Failed exchange clears old state; HTTP mode excludes legacy token.

Actual Simulator HTTP exchange/read/outage/recovery/durable-revoke-clearing and
old-mode fallback refusal pass.153 backend checks pass; physical iOS compile
passes unsigned only. Review found truncated-body admission and old-session
retention defects; fixed with socket/UI regressions, final review clear. Cleanup
tracks observed containers and preserves unrelated files. Secret scan clean
(3521 reviewed); temporary HTTP/read/pairing files verified absent.
Report: docs/planning/v2/HTTP_DEVICE_SESSION_2026-09-16.md. Logs:
.builds/http-session-2026-09-16/ and .builds/phone-pairing-check/.

HTTP exchange milestone100%; roadmap53% unchanged. Setup grant still injected
via privatefile; account/enrollment remain fixtures. No real-account sign-in,
physicaltransport/TLS, provider, remoteactions or personal-plan publication via
this route. Macbuild232 and personalplan unchanged. No service installed/push.
Preserve capabilities.md. Next: deliberate host setup plus saved personal-plan
publication on this authenticated route, then physical/account-auth gates.
Rollback scoped checkpoint; no production store/runtime changed.

---

## 2026-09-16 08:57 BST — Persistent phone key opens a local read session

DeviceReadChallenge binds owner/device/public key/server nonce with a distinct
message domain and signing-time expiry. Simulator-only bridge compares the
request key to its actual stored key and signs; DeviceReadSessions exchanges
that exact proof for the token used by the real Swift HTTP reader. Combined
pairing/approval/session/read/outage/recovery/revoke flow passes. A final isolated
--read-session rerun after cleanup repair also passes, including replay refusal
and durable revoke clearing reading and surviving process restart.

143 backend tests and13 Swift tests pass; generic physical-iOS build compiles
unsigned only. Independent review found intermediate Simulator-container cleanup
gap; all observed directories now tracked, two regressions independently pass,
no remaining findings. Source/history scan clean (3491 reviewed). Report:
docs/planning/v2/PHONE_KEY_READ_SESSION_2026-09-16.md. Evidence:
.builds/phone-key-session-2026-09-16/ and .builds/phone-pairing-check/.

Persistent-key issuance milestone100%; roadmap53% unchanged. Fixture enrollment
and private-file challenge/token delivery remain; no production auth endpoint,
real account or physicalphone proof. Personal-preview still separate legacy
development-token route. Mac build232/personal plan hash unchanged, temporary
files/stores cleaned, persistent Simulator key retained. Preserve capabilities.md.
Next: bounded authenticated local exchange transport replacing private files,
then real-account/physical deployment gates. Revert scoped local checkpoint for
rollback; no production service/store installed, no remote push.

---

## 2026-09-16 02:53 BST — Device-bound local read sessions verified

DeviceReadSessions now exchanges fresh single-use signatures bound to owner,
registered device/key and challenge for short-lived opaque local read tokens.
Every resolution checks fresh durable device trust; revoke/failed attestation
refuses401 and retires token. Storage lookup failure refuses503 without trusting
cache. Restart invalidates all sessions/challenges. HTTP remains loopback-only,
GET /plan, no session-exchange/sign-in endpoint or real account activation.

141 combined tests pass; actual Simulator identity/sample/read-recovery scenario
passes with durable registry revocation causing next refresh to clear reading.
Real-P256 exchange/revoke test passes. Independent review eight session/ten
real-crypto checks pass, no actionable findings. Source/history secret scan clean
(3461 reviewed occurrences). Report:
docs/planning/v2/DEVICE_READ_SESSIONS_2026-09-16.md. Evidence:
.builds/device-sessions-2026-09-16/ and .builds/phone-read-check/.

Local session-enforcement milestone100%; roadmap53% unchanged. Simulator credential
is still a synthetic registered HMAC fixture, not its persistent key. Phone-key
pairing/approval was proven separately; persistent phone-key session exchange is
next. Personal-preview script intentionally still uses legacy harness token.
Mac build232 and personal plan unchanged. Temporary grant/stores cleaned; no
production service/provider/install/push. Preserve capabilities.md.
Next: connect persistent phone key to bounded session exchange/trusted owner,
then real-account physical transport. Rollback scoped checkpoint; no production
registry or installed app state modified.

---

## 2026-09-16 02:43 BST — Explicit Simulator pairing approval verified

Added immutable PairingApprovalRequest and PairingApprovalView, showing exact
joining device ID/full grouped key fingerprint. Approval requires a comparison
toggle then tap; request/account/offering-key/expiry validation is repeated at
signing. UI says confirmation signed/awaiting service acceptance, never paired.
Simulator-only bridge/signing route; no real account authenticated. In the test,
fixture Mac first admits phone, then persistent phone key explicitly approves a
new joining fixture device through actual UI and backend confirmation.

Approve/reject/expired scenarios pass, with real signature/id binding, replay
refusal and durable revocation across process restart. 122 backend tests +9Swift
tests pass; final three existing identity/sample/read-recovery UI scenarios pass.
Physical iOS compilation passes unsigned only. Independent review found ID-format
and cleanup-failure gaps; both fixed, verified and tested. Fingerprint rendering
visually checked after grouping fix. Source/history scan clean (3431 reviewed).
Two overlapping resumed UI runs were stopped and rerun sequentially; final
isolated results are the evidence. Report:
docs/planning/v2/PHONE_PAIRING_APPROVAL_2026-09-16.md. Logs under
.builds/approval-2026-09-16/ and .builds/phone-pairing-check/.

Local approval-screen milestone100%; roadmap53% unchanged. No hosted account,
physical-device/biometric proof, remote transport, or actual user pairing. Mac
build232 and personal plan hash unchanged. No global install or push. Temporary
files cleaned; persistent Simulator key retained. Preserve capabilities.md.
Next: authenticated local transport/session lifecycle with durable device status
checked on every request, then physical/real-account pairing. Revert this scoped
checkpoint for rollback; no production service or store was installed.

---

## 2026-09-15 21:56 BST — Durable local device registry and revocation proven

DurableDeviceRegistry adds private SQLite storage while preserving existing
owner/signature contracts. Transaction reloads prevent stale writers restoring
revoked trust; pairing confirmation serializes trust check and admission with
revocation. Explicit create=True only creates a fresh store; reopening missing,
truncated, corrupt or unknown-schema storage refuses. No auto-reset/migration.
Failed durable confirmation cancels pairing rather than retaining completed.

121 combined tests pass; actual Simulator P-256 pairing harness passes and a
separate Python process observes persisted revocation. Independent review found
and verified fixes for lost database recreation and completed-label-after-failed-
commit;18 durable tests independently pass. No remaining review findings.
Source/history secret scan clean (3401 reviewed occurrences); matching Simulator
request/proof files removed after final run.
Report: docs/planning/v2/DURABLE_DEVICE_REGISTRY_2026-09-15.md. Evidence under
.builds/durable-devices-2026-09-15/ and .builds/phone-pairing-check/.

Local durability milestone100%; roadmap53% unchanged. Offering account/key remain
fixtures; temporary durable store removed after proof. Pending challenges and
pairings intentionally die on restart. No real account paired or bearer-session
revocation integration. Mac build232 and personal plan hash unchanged. No remote
push, production service/store install or new dependency. Persistent Simulator
key retained. Preserve unrelated capabilities.md.
Next: explicit offering-device confirmation UI and authenticated transport/session
lifecycle, with fresh durable device status on decisions. Rollback local checkpoint;
never delete a real registry/tombstones automatically.

---

## 2026-09-15 21:47 BST — Real phone pairing signatures verified locally

Added explicit P256Verifier with optional cryptography50.0.1 dependency; default
registry still refuses. Extracted PhoneDeviceIdentity.swift and added typed
pairing-claim signing. Simulator-only test bridge proves the persistent phone
key through existing registration/claim/confirmation/replay/revocation contracts.
Offering Mac key, account and registry are disposable fixtures; no real account
paired, no human confirmation UI or durable revocation claimed.

Fixed adoption's string-vs-tuple duplicate guard, which allowed a new key to
overwrite an existing/revoked device ID. Regression covered both with real crypto
and in the dependency-free suite. 60 identity/pairing tests +43 foundation/boundary
checks pass. Actual pairing UI/signature interoperability passes; three existing
Simulator identity/sample/read-recovery scenarios pass (46.035s). Unsigned generic
physical-iOS compilation passes. Independent review clean; reviewer reran60 tests.
Source/history secret scan clean (3371 reviewed occurrences).
Report: docs/planning/v2/PHONE_PAIRING_PROOF_2026-09-15.md. Logs in
.builds/phone-pairing-check/ and .builds/pairing-2026-09-15/.

Pairing-signature milestone100%; roadmap53% unchanged. Mac build232 and personal
accepted plan hash unchanged. No daemon, network endpoint, global dependency
install, real account pairing or remote push. Temporary bridge files cleaned;
persistent Simulator key intentionally retained. Preserve unrelated capabilities.md.
Next: owner-scoped durable device registry/revocation with restart proof, then
explicit offering-device confirmation UI and authenticated pairing transport.
Rollback: revert scoped local checkpoint; no installed Mac state to restore.

---

## 2026-09-15 14:22 BST — Persistent local phone identity verified

PhoneDeviceIdentity now creates/reloads P-256 Keychain references, exports only
the public key, and displays its fingerprint/status in Control. Lookup failure
does not regenerate; physical path requires Secure Enclave without software
fallback. Simulator key explicitly software-backed. No pairing/account claim.

Three actual Simulator UI scenarios pass including fingerprint persistence over
termination/relaunch, fresh challenge signing and changed-challenge rejection.
693 core checks + iOS library build pass; generic physical-iOS compilation passes
without signing/install. Independent review clean after retry-status fix.
Simulator scripts now use ad-hoc signing for Keychain entitlements. A missed
reorganization path in MobileCoreCheck now resolves docs/planning vectors.
Source/history scan clean. Report: docs/planning/v2/PHONE_DEVICE_IDENTITY_2026-09-15.md.

Local identity milestone 100%; physical hardware, biometrics, account pairing
and durable server revocation remain unproven. Key intentionally persists in
Simulator Keychain; temporary read credentials still cleaned. Mac build 232
unchanged. No REC/phase closure; roadmap 53% unchanged. Next: bind device public
identity into pairing/session contracts with approval and durable revocation.
Local checkpoint only; no remote push.

---

## 2026-09-15 14:09 BST — Personal accepted plan published to Simulator

Bounded personal-plan publication 100%. scripts/orion_phone_preview.py accepts an
explicit source, validates through Swift exporter and serves only the configured
owner via loopback. Refresh republishes valid revisions; export failure/rollback
refuses read and preserves durable snapshot. Actual revision 8 read+refresh UI
test passed; source date/reason/blocks matched visually and were labeled stale.
Normal 15-second preview exited with source unchanged; access file cleanup verified.
123 tests pass; independent publication review clean after fixing relative paths.
Report: docs/planning/v2/PERSONAL_PHONE_PUBLICATION_2026-09-15.md.

During continuation, unrelated repo reorganization landed through 3941e8f. Planning
is now docs/planning and plugin files live under plugin. Native paths unchanged;
relevant tests rerun on current tree. Do not undo those commits.
The reorganization dropped six historical fixture-path allowlist entries; exact
previously reviewed entries restored for the history scan, without new values.
Independent review confirmed restoration; full history scan clean (3311 reviewed
occurrences).

No physical pairing, production identity/TLS or installed background service.
Personal source unchanged, Mac build 232 unchanged, temporary copies cleaned.
Next: durable device/account identity and deliberate pairing, then remote
transport. REC gates remain open; formal roadmap 53% unchanged. Local checkpoint
only; no remote push.

---

## 2026-09-15 01:33 BST — Simulator read-only Today connection proven

Phone UI now reads actual loopback HTTP using synthetic data. Shared
TodayReadSnapshot validates owner/schema/plan, history rejects repeated old or
conflicting revisions, freshness preserves original evidence age. Explicit
TodayPlanExport validates a specified source without editing it; actual saved
revision8 export verified unchanged, never sent to Simulator.

Final twoUIscenarios pass: sample shell and network stale/outage/recovery/revocation.
Four Swift snapshot tests pass;693existing corechecks+iOSbuild passed before
explicit-null correction, which final Simulator build compiles. Python cleanup
regression passes. Independent review no remaining findings. Source/history
secret scan clean. Logs: .builds/phone-read-2026-09-15/ and .builds/phone-read-check/.
Report: docs/planning/v2/PHONE_READ_CONNECTION_2026-09-15.md.

Bounded Simulator connection100%; production auth/TLS/physical pairing and
normal personal-plan publication remain unimplemented. No permanent service
installed, no personal data sent to Simulator; fixture credentials cleaned.
Redirect/oversize transport cases source-reviewed only. Mac build232 unchanged.
Next: deliberate connection configuration and personal-plan publication, then
durable identity/remote transport. REC gates stayopen,45/85phases(53%) unchanged.
Preserve unrelated docs/planning/learning-proposals.md; local checkpoint only.

---

## 2026-09-14 22:42 BST — Local durable Today read-service foundation

Added backend/local_today/repository.py and backend/adapters/local_today.py:
private SQLite owner-scoped snapshots, transactional revision checks, read audit,
ephemeral local harness sessions and loopback-only GET /plan.119 combined tests
pass; final ten service tests and independent ten-test review pass. Secret scan
clean. Exact inbound http.server adapter exception preserves outbound restrictions.
See docs/planning/v2/LOCAL_TODAY_SERVICE_2026-09-14.md and backend/local_today/README.md.

Local service proof100%; phone remains sample-only. This is not account auth,
a deployed server or a connected-client closure. No real plan imported or daemon
installed; tests use disposable stores/sockets. Mac build232 untouched. Next:
validated Mac exporter and Simulator client with stale/offline/reconnect proof.
All live foundation/client REC gates remain open; roadmap53% unchanged. Preserve
unrelated docs/planning/learning-proposals.md. Local checkpoint only, no remote push.

---

## 2026-09-14 22:22 BST — Real phone Simulator shell delivered

The old “no iPhone app target” gap is now narrowed: native/OrionMobile has
OrionMobile.xcodeproj, the OrionPhone SwiftUI target, five tabs and clearly
labeled opt-in Today/Plan fixtures from shared TodayPlanScheduler. Default
state is disconnected. One actual XCTest UI route passed on iPhone17 Pro
Simulator/iOS26.5, including sample-open relaunch and dismissal;693 core checks
and iOS library build pass. Independent source review clean;secret scan clean.
See docs/planning/v2/PHONE_SHELL_2026-09-14.md and native/OrionMobile/README.md.

Simulator shell milestone100%; connected client remains unimplemented. No
authentication, pairing, real Today sync, durable backend, chat, push, HealthKit
or physical-phone proof. No phase/REC closure;45/85 phases remain marked complete
(53%). Mac build232 and accepted plan untouched. Next: authenticated read-only
Today route with owner-scoped durability and stale/offline/reconnect proof.
No provider choice, new integration, recurring cost or remote push. Preserve
docs/planning/learning-proposals.md. Outputs include phone screenshots and code links.

---

## 2026-09-14 21:47 BST — Today source recovery 100%; installed build 232

Source `0404632` prevents late callbacks and changed/unauthorized sources from
revalidating a stale preview. Direct EventKit status checks run at callback,
preview and acceptance. Final 56 focused tests +40 connection checks pass;
independent seven race tests pass with no remaining review finding. Earlier
full suite 489 passed before final permission correction. Secret scan clean.

Signed clean build 232 installed with matching identity and executable. Actual
Today refresh/preview showed an existing off-hours commitment unchanged,
insufficient free time and task deferral. Preview discarded; saved revision-8
plan unchanged. Permission-loss and recovery proof is controlled tests only.
Rollback: .builds/today-source-race-2026-09-14/rollback/Orion-229.app.
Report: docs/planning/v2/TODAY_SOURCE_RECOVERY_2026-09-14.md. No phase/REC closure,
remote push, external record mutation or permission/gateway change. Preserve
unrelated docs/planning/learning-proposals.md. Formal roadmap remains53% (45/85).
Next: numbered-manifest connected-client/durable-bridge gaps; physical
permission/overlapping-event experiments remain unproven.

---

## 2026-09-14 15:57 BST — Health summary 100%; installed build 229 live selection proven

The pending source-access gate cleared. Already-installed build 229 showed
real WHOOP refresh at 15:42, dated source facts and unchanged missing-log
uncertainty. Actual local-model completion at 15:56:05 produced a valid selection;
the Health UI displayed the selection attribution and leading Recovery Source
fact for the associated sleep ending September 14 at 07:19. Earlier invented
advice and the visible fixed-score coaching card are absent. No protected
dialog was operated and no reinstall was needed. Deep signature passes; saved
revision-8 plan fingerprint remains unchanged.

Health-summary repair is 100% complete; source `882681a`, installed build 229.
Proof: docs/planning/v2/HEALTH_SUMMARY_GROUNDING_2026-09-14.md and
.builds/health-summary-2026-09-14/verification.json. Rollback remains
.builds/health-summary-2026-09-14/rollback/Orion-227.app. Existing source test and
review evidence below is unchanged. No new test run is claimed for read-only
installed verification. No external records, permissions, credentials or gateway
changed by the agent. No remote push or phase/REC closure.

Nick also requested a code walkthrough: outputs/ORION_CODE_GUIDE.md in this
Codex task lists the actual Desktop source tree, reading order and linked
Health example. Finder was asked to reveal the real HealthSummary.swift.
He then said to continue implementation. Preserve progress percentages per
bounded repair and explicitly distinguish formal total: 45/85 phases marked
complete (53%), 26 in progress, 14 not started. Next work follows the product
delivery plan: remaining Today conflict/recovery proofs, then connected client
and durable bridge work. Do not mistake the summary for personal-baseline or
health-aware-planning completion. Exclude unrelated learning-proposals.

---

## 2026-09-14 07:40 BST — Build 229 installed; Health summary 95%, source access pending

Installed Orion is build 229 (1.2.0), clean source `882681a`. Build 25.55 seconds;
candidate/rollback/installed deep signatures and exact identity pass, installed
executable matches candidate. Rollback is
.builds/health-summary-2026-09-14/rollback/Orion-227.app; install.json records the
additional previous bundle. No active focus interrupted; saved plan revision 8
byte-for-byte unchanged. No source record, credential, permission or gateway
change by the agent, no remote push.

Actual Health route proves factual fallback, activity date and missing-log
uncertainty; no arbitrary model prose is rendered. WHOOP remains Checking with
SecurityAgent present. Nick was asked asynchronously to handle the macOS
Keychain prompt. Computer Use cannot operate that protected dialog. Do not
attempt another tool to bypass it. No live refreshed Health or optional model
selection proof is claimed for build 229. Test-generated 0ms September-13
health-choice entries are not live completions.

Continue at 95% of this repair (user asked for progress percentages). After the
prompt clears, inspect already-installed Health and its valid factual selection;
verify record dates, no old advice/coaching and unchanged saved plan. Do not
rebuild/reinstall. Source gate is done: 481 earlier native tests + 40 connection
checks, 38 health firewall checks, final 28 focused independent tests after two
review fixes, source/history secret scan clean. Report:
docs/planning/v2/HEALTH_SUMMARY_GROUNDING_2026-09-14.md. No phase/REC closure or overall
program completion percentage. Preserve unrelated learning-proposals.

---

## 2026-09-14 07:36 BST — Health summary source gate passed (85% of this repair)

User asked to continue and show progress percentages. Percentages refer to this
bounded Health-summary repair, not overall Orion/phase completion. Build 227 is
still installed. The new rail renders app-owned source/log facts with an optional
validated model ID selection; no arbitrary prose or legacy advice cache reaches
the view. Missing logs stay unknown, source periods replace score-based claims,
and visible generic-score coaching is removed. Raw WHOOP values remain outside
the model prompt.

Independent review repaired heart-only availability and removed-supplement
counting. Final 28 focused tests pass; earlier native 481 + 40 connection checks,
38 firewall checks and source/history secret scan pass. Full report:
docs/planning/v2/HEALTH_SUMMARY_GROUNDING_2026-09-14.md. Verified rollback:
.builds/health-summary-2026-09-14/rollback/Orion-227.app. Current plan fingerprint
recorded, no active focus. Next: clean signed candidate, exact identity, install,
normal Health route and a real optional selection. No source records, credentials,
permissions, gateway or remote push changed. Preserve learning-proposals. No
phase/REC closure; personal baseline and broader health-aware planning remain.

---

## 2026-09-14 02:08 BST — Build 227 installed; missing and refreshed Health routes proven

Installed Orion is 1.2.0 build 227, clean source `7fdba72`. Candidate/rollback/
installed deep signatures pass, exact designated requirement is preserved, and
the installed executable matches candidate. Build took 23.24 seconds. Rollback:
`.builds/health-source-2026-09-14/rollback/Orion-225.app`; install.json records the
additional previous bundle. No active focus interrupted, no source records,
permissions, credentials or gateway changed by the agent. Revision-8 plan
fingerprint unchanged. No push.

Actual Health route first proved explicit missing-reading state, all seven
sections and expanded source provenance. WHOOP then refreshed at 02:06; live
Health showed real available metrics, hours-in-bed labeling and 9h12 rounding,
source age, high corresponding WHOOP history confidence, moderate 14-reading
trend confidence and low manual-entry confidence. Source access is now clear;
no pending Keychain action for this verification. Final source harness 175/175,
independent review clear, final app compilation passed; earlier native wrapper
471 + 40 connection checks. Full report: docs/planning/v2/HEALTH_SOURCE_TRUTH_2026-09-14.md.

The earlier build-225 brief model-selection gap is also now proven through the
normal Today → Read it route; see BRIEF_GROUNDING_2026-09-12.md. That proof belongs
to build 225; build 227 Health proof is current.

Next bounded repair: the separate freeform Health summary still turned an empty
water log into immediate hydration advice and a generic sleep score into a
personal-baseline claim. Its generated prose remains outside the seven-section
repair. Inspect HealthTab.readingRail, HealthFacts/NarrativeFacts, NarrativeWriter
and existing grounded-brief selection; preserve Phase 33 raw-health isolation.
Also review older headline advice. Do not reinstall just to resume inspection.
No phase/REC closure or phone/backend continuity claim. Exclude unrelated
docs/planning/learning-proposals.md from any checkpoint.

---

## 2026-09-14 02:03 BST — Brief selection proven; Health source-truth repair ready

Already-installed build 225 now refreshes real WHOOP data. Today → Read it showed
Monday September 14 at 01:51 and a valid optional model-selected calendar detail
matching the 22:30 agenda entry. This closes the previous brief selection proof
gap without reinstalling or operating the protected Keychain dialog. Plan revision
8 remains byte-for-byte unchanged. See BRIEF_GROUNDING_2026-09-12.md for scope.

Health seven-section source repair now distinguishes unavailable readings from
no sleep/workout, labels time in bed, removes unsupported personalised advice,
uses per-measurement history and actual record age, and expires age each minute.
Independent review's mixed-history finding was repaired; final harness 175/175,
final app compilation passed, earlier full native 471 + 40 connection checks.
Source/history secret scan clean. Report: docs/planning/v2/HEALTH_SOURCE_TRUTH_2026-09-14.md.

Build 225 is still installed. Verified rollback is
.builds/health-source-2026-09-14/rollback/Orion-225.app. No active focus. Next: clean
signed Health candidate, exact identity check, install, normal Health route and
unchanged-plan verification. Existing freeform Health rail/headline interpretations
and connector Checking lifecycle remain separate work. No external source writes,
new permission, gateway restart, push or phase/REC closure. Preserve unrelated
docs/planning/learning-proposals.md.

---

## 2026-09-13 15:45 BST — Build 225 installed; factual brief live, Keychain detail check pending

Installed Orion is 1.2.0 build 225, clean source `becb18c`. Deep signature and
identity checks pass; installed executable matches candidate. Build-223 rollback:
`.builds/brief-release-2026-09-13/rollback/Orion-223.app`; install.json records the
additional previous bundle. No active focus was interrupted. Plan revision 8 is
byte-for-byte unchanged; no source record, permission, credential or gateway change.

Actual Today → brief shows correct Sunday afternoon and advancing observation time,
all-day context and one unfinished reminder despite nothing due. The JSON client
fix passed 471 native tests, 40 connection checks and independent four-case review;
secret scan clean. Build-225 optional AI-selected detail is NOT yet proven: health
source is stuck Checking with SecurityAgent running. Computer Use explicitly denies
access to com.apple.SecurityAgent; Nick was asked to handle the macOS Keychain
prompt. Do not try another tool to operate that protected dialog.

Next after prompt: inspect live source refresh/selected detail in already-installed
build 225; do not rebuild or reinstall. Report and exact boundaries:
`docs/planning/v2/BRIEF_GROUNDING_2026-09-12.md`. Test-generated 0ms narrative log entries
are fixtures, not live proof. Existing Health sections also mislabel pending source
readings as no recorded sleep/workout with high confidence; keep that separate from
the now-grounded brief. No REC or phase closure; phone/backend and remaining Today
scenarios stay open. Exclude unrelated learning-proposals from checkpoints.

---

## 2026-09-13 15:39 BST — Live brief fallback proven; JSON client boundary repaired

Build 223 launched after unlock. Real Sunday afternoon brief correctly retained
all-day context and unfinished reminder scope; Tasks showed the unchecked source
reminder. Saved revision 8 is unchanged. Optional detail failed because the shared
LocalModel client required sentence punctuation for the JSON selection. The actual
app log and call path establish this defect; prior rendering tests missed it.

Source now uses selectionJSON style for the brief, retaining other prose guards.
Four boundary tests exercise actual response decoding → writer → renderer/cache.
Full native 471 tests and 40 connection checks pass; independent review is clear.
Details: `docs/planning/v2/BRIEF_GROUNDING_2026-09-12.md`. Next: clean signed candidate,
retain build-223 rollback, install and prove the model-selected detail in the app.
No task/calendar change, new permission, gateway restart or push. Exclude unrelated
learning-proposals. No phase or recovery gate is closed.

---

## 2026-09-12 16:44 BST — Build 223 installed; Mac locked at live verification

Installed app is now Orion 1.2.0 build 223, source `dfcaee2`, built from the clean
release checkout. Candidate and installed deep signatures pass and identity is
unchanged. Orion was not running; saved plan fingerprint is unchanged. Build 221
rollback is `.builds/brief-release-2026-09-12/rollback/Orion-221.app`; install.json
records the second previous bundle. No gateway restart, new permission or push.

Built/tested: deterministic brief plus validated optional model selection,
per-component source periods, unfinished-reminder context and hostile-title
handling. 467 native tests, 40 connection checks and 38 health firewall checks;
final 12 tests and firewall repeated after wording refinement. Independent review
clear; final source/history scan clean. Full report:
`docs/planning/v2/BRIEF_GROUNDING_2026-09-12.md`.

NOT YET PROVEN: build 223's actual visible brief and model selection. Computer Use
reported the Mac locked; automatic unlock failed and Nick was asked to unlock it.
The app was not launched. Next after unlock: open installed Orion, inspect Today →
brief using real sources, confirm valid dated detail or factual fallback and unchanged
plan, then record evidence. Do not rebuild/reinstall just to resume this check.
Prior build-221 UI proof is historical. REC-USABLE-CLIENT and phone/backend remain
open. Preserve unrelated learning-proposals work.

---

## 2026-09-12 16:40 BST — Grounded brief source checkpoint

Build 221 is still installed. Nick said continue on the remaining inaccurate AI
brief. The repaired view now renders a deterministic time/calendar/task summary,
with at most one model-selected, allowlisted factual detail. Raw generated prose
and old freeform cache entries cannot appear. Unfinished work remains visible
even when nothing is due. Per-component WHOOP provenance uses linked sleep/end
and cycle start, not fetch/edit times; unknown ages remain unknown.

Full native suite: 467 XCTest cases and all 40 connection checks pass; health
firewall: 38 checks. Independent review passed 12 new tests and is clear after
canonical JSON cache keys and hostile title delimiters/bidi were repaired. Final
freshness wording also receives focused verification. Source/history scan clean.

Report: `docs/planning/v2/BRIEF_GROUNDING_2026-09-12.md`. Next: clean signed candidate,
verify build-221 rollback, install, inspect the ordinary brief and a valid optional
selection, then record installed evidence. Keep local plan state, permissions and
gateway intact. No push or gate closure. Exclude unrelated learning-proposals.

---

## 2026-09-11 16:54 BST — Build 221 installed and normal routes checked

Installed `/Applications/Orion.app` is now signed build 221 (1.2.0), clean source
`12583fc`; the previous build-220 statement below is historical. Identity and
candidate/installed deep signature checks pass. Actual UI confirms the correct
civil-date brief, working Command-Q, launch and closed-window reopen, live source
refresh and a fresh 16:53–17:23 task preview ending the day at 22:00. Preview was
discarded; saved revision 8 remains byte-for-byte unchanged. No new permission,
external task/calendar change, gateway restart or remote push occurred.

Full repair proof: 455 native tests, 26 health checks, nine transport scenarios,
five menu checks; secret scan clean; independent review clear. Its concurrent
redirect test timed out once but all 40 gateway checks passed in isolation. Main
full wrapper passed first run. Report distinguishes actual installed observations
from the midnight/zone/coverage regressions and the prior pinning/mobile fixtures.

Rollback: `.builds/today-release-2026-09-11/rollback/Orion-220.app`; install and
verification manifests identify the additional hidden previous bundle. Build 217
rollback also retained. No plan data should be removed during app rollback.

Next concrete issue: optional generated prose said “full day” late in the afternoon,
although Today budgeted only remaining hours. Ground brief narration in observation
time and actual source age, verify its claims, then finish remaining Today scenarios
and proceed to the phone shell/durable bridge. Files: `MorningBrief.swift`,
`DashboardView.swift`, `NarrativeWriter.swift`, WHOOP snapshot metadata and existing
health firewall tests. No REC-USABLE-CLIENT closure. Detailed evidence is in
`docs/planning/v2/TODAY_INSTALLED_PROOF_2026-09-11.md`. Preserve unrelated learning-proposals.

---

## 2026-09-11 16:48 BST — Installed Today proof and brief repair candidate

The earlier installed-217 statement is superseded. Clean source `187fa15` was
built and installed as signed build 220 with the original designated requirement.
Actual UI checks on 10 September proved real Calendar/Orion Reminders → preview →
accept, pin preservation and conflict refusal, restart persistence, local Finish,
extra time and Undo. Source reminder stayed unfinished; final local revision 8
is unfinished, unpinned and back to 30 minutes. Gateway and permissions unchanged.

Live use exposed a civil-date/activity-day mix-up in the brief and missing standard
Quit/reopen behavior. The repair separates the civil clock from the 4am activity
boundary, invalidates stale narrative, verifies source freshness/window coverage,
handles zone changes and date-only reminders, and restores Quit/reopen. Full native
suite: 455 XCTest cases pass. Independent review is clear; all 40 connection wrapper checks pass. Installed
repair proof is pending.

Evidence, limitations, rollback and exact next gate:
`docs/planning/v2/TODAY_INSTALLED_PROOF_2026-09-11.md`. Build 217 rollback is in
`.builds/today-release-2026-09-08/rollback/Orion.app`; retain a verified build 220
copy before replacing it. Next: finish review, checkpoint only these repairs,
build from a clean checkout, install with the same identity, verify civil-date
brief and standard Quit/reopen, then update this record. No push, phase closure
or phone/backend claim. Exclude unrelated learning-proposals work.

---

## 2026-09-08 22:55 BST — Pinned slots and source reconciliation

Nick said “continue.” The initial Today slice was committed locally as `f597f7f`;
this follow-up adds accepted task-slot pins. Replanning preserves them, including
ongoing blocks. Missed pins and calendar/transition/duration/day-budget conflicts
refuse the proposal instead of moving a pin. Individual unpin, release-all,
completion and undo stay inside the existing preview/accept flow. Confirmed
source completion/deletion releases its pin in a disclosed preview; local undo
cannot reverse that external source change. Older unpinned files decode normally.

Proof: full 448 XCTest cases pass; the last narrow Unpin repair also passed the
14-case app suite. Reviewer independently reran 46 Today cases and confirmed the
final source repair, with no actionable findings left. Eight critical mutants
are caught; MobileCore 693 checks and iOS Simulator build pass. Actual expanded
pinned content rendered with labeled fixtures and inspected. The connection
wrapper's 26 health, nine transport and five menu checks also pass.

Review caught stale pins after completion in Reminders and a remaining visible
Unpin action checking the already-reconciled list. Both are repaired with actual
model regressions. See updated `docs/planning/v2/TODAY_PLAN_IMPLEMENTATION_2026-09-08.md`.
Scoped pinning patch/logs: `.builds/today-plan-2026-09-08/pinning/`.

Installed build remains 217. No install, restart, new permissions, external
calendar/task write or remote push occurred. Next gate is an identity-preserving
candidate and installed real-source acceptance pass, not more pinning scaffolding.
The source pinning gap in the earlier entry is superseded. REC-USABLE-CLIENT still
needs installed Mac evidence plus phone/backend work; no gate or numbered phase
has been marked complete. Keep the unrelated learning-proposals edit excluded.

---

## 2026-09-08 01:29 EDT — Today/Plan source implementation

Nick said “start implementation.” Starting HEAD was `d0eeebb`; the only prior
uncommitted edit was `docs/planning/learning-proposals.md`, left untouched. Installed
build 217 remains installed. No runtime/permission/install change was made.

Implemented: actual-day calendar/Orion Reminders adapter; MobileCore real-gap
scheduler with protected off-hours, transitions and free time; Today-first Home;
preview/accept, local Finish block, 15 more minutes, replan from now and one-level
undo. Atomic local snapshot includes revision, undo and replay receipts. Stale
sources cannot become current advice, and a competing writer is reloaded.
Reminders nil snapshots are now unknown instead of an empty task list. Calendar
and source reminder records are not changed by plan operations.

Proof: 437 native XCTest cases pass, including 26 planner/store and nine actual
app model/adapter/view tests; 26 health, nine transport and five menu checks pass.
MobileCore 693 checks and iOS Simulator build pass. Six deliberate source mutants
are caught. Actual TodayPlanView rendered from synthetic inputs and inspected.
Independent review repaired stale advice, elapsed free totals, deadline order and
omitted new-work summaries; final reviewer reran 35 cases, no actionable findings
within this scope. Source/history secret scan clean with the existing allowlist.

Full details and alternatives: `docs/planning/v2/TODAY_PLAN_IMPLEMENTATION_2026-09-08.md`.
Rollback: scoped local source commit/patch and logs in
`.builds/today-plan-2026-09-08/`; nothing installed to roll back. Exclude the old
learning-proposals edit from any checkpoint. No push/remote backup claim.

Next: explicit pinned task slots and conflicts, then identity-preserving candidate
and installed Calendar/Reminders → preview → accept → restart → completion/replan/
undo proof. Task pinning and installed product proof are unmet, so delivery-plan
step 2 is partial. Phone/backend work remains required by REC-USABLE-CLIENT. No
phase counts or recovery gates were advanced. Historical missing-Mac-consumer
statements are superseded by this source implementation, not installed evidence.

---

## 2026-09-07 22:47 EDT — Product vision and first connection repair

Nick asked to assess the supplied product vision and start implementation. The
full delivery map is `docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md`; the
first slice and proof record are in
`docs/planning/v2/RUNTIME_CONNECTION_IMPLEMENTATION_2026-09-07.md`.

Found: installed Mac build 217, gateway and remote bridge running, valid live and
ready gateway probes. This supersedes the supplied document's earlier down
snapshot. Gates contain 45 complete, 26 in progress, 14 not started; the old
AGENTS/CLAUDE phase summaries were stale and now route to the canonical records.
No phase was advanced. DayPlan.propose exists but has no Mac app consumer.

Changed: typed bounded gateway health/readiness probe, expiring evidence,
contextual Home connection state, consistent dashboard/menu/preferences labels,
open-menu expiry/recovery refresh, and honest static-readiness labeling. Readiness
is not proof of a complete turn or an individual connector. No service restart,
install, permission/configuration change, credential access or remote push.

Verification: Mac build passes; 402 native XCTest cases, 26 connection checks,
nine real loopback scenarios, five menu checks pass. Five critical mutants are
caught. Component render inspected; production probe passes against the installed
gateway. Independent review findings repaired. Source/history secret scan clean
with the existing reviewed allowlist. Full installed UI/voice/conversation proof
remains outstanding; build 217 is still installed.

Rollback: isolated local source checkpoint; patch and logs at
`.builds/product-vision-2026-09-07/`. Do not reset the mixed tree. The existing
`docs/planning/learning-proposals.md` edit was excluded. Next: finish candidate Home
layout/release proof, then wire real agenda/tasks to a persisted Today/Plan
revision with completion/replan/undo using MobileCore. Follow the delivery plan's
REC-USABLE-CLIENT and REC-LIVE-FOUNDATION path; do not mistake this first repair
for complete runtime recovery or delivery of the whole vision.

---

## 1. Where the program is

**45 of 85 phases complete.** 25 part-done, 15 not started. The manifest is
`docs/planning/v2/MANIFEST_PHASES.json`; the live state is `docs/planning/v2/PHASE_GATES.json`
and that file, not this one, is the source of truth — this table is a snapshot of
it and will drift.

Two things to know before reading the table:

**"part-done" is not a synonym for "nearly done".** Several phases sit there
because one requirement needs Nick at a keyboard — a TCC grant, an OAuth
re-auth, a device — and the rest of the phase is finished and proven. Others sit
there because the work genuinely is not done. The unmet-requirement column is the
only way to tell them apart, which is why it is printed in full.

**The interpretation rule still applies** (see `AGENTS.md`): where a phase's text
refers to the Python runtime or `orion/*.py`, read it against the LIVE stack —
the Swift app in `native/Orion` and the TypeScript plugin in
`plugin/orion-control`. That changes how a requirement is READ, never
the order phases are done in.

| # | phase | state | what is still unmet |
| -: | ----- | ----- | ------------------- |
| 0 | Freeze, Inventory, and Understand Existing ORION | **done** | — |
| 1 | Establish Repository and Module Boundaries | **done** | — |
| 2 | Build the Model Router | **done** | — |
| 3 | Create the Context Firewall | **done** | — |
| 4 | Formalize Tool Contracts | **done** | — |
| 5 | Build the Policy Engine | **done** | — |
| 6 | Build the Audit System | **done** | — |
| 7 | Build the Event System | **done** | — |
| 8 | Build the Job System | **done** | — |
| 9 | Security Invariant Test Suite | **done** | — |
| 10 | Backend Foundation | **done** | — |
| 11 | Database Foundation | **done** | — |
| 12 | Secret and Credential Vault | **done** | — |
| 13 | Authentication | **done** | — |
| 14 | Device Identity | **done** | — |
| 15 | Device Pairing | **done** | — |
| 16 | ORION Mobile Foundation | **done** | — |
| 17 | Conversation and State Sync | **done** | — |
| 18 | ORION Memory v2 | **done** | — |
| 19 | Today Screen | **done** | — |
| 20 | Unified Capture | **done** | — |
| 21 | Task System | **done** | — |
| 22 | Calendar Read Integration | **done** | — |
| 23 | Planner v1 | **done** | — |
| 24 | Schedule Stability | **done** | — |
| 25 | Calendar Writes | **done** | — |
| 26 | Gmail Read/Search | **done** | — |
| 27 | ORION Action Inbox | **done** | — |
| 28 | Gmail Drafting | **done** | — |
| 29 | Gmail Sending | **done** | — |
| 30 | HealthKit Local Layer | **done** | — |
| 31 | Health Baseline Engine | **done** | — |
| 32 | ORION Health State | **done** | — |
| 33 | Health Privacy Firewall | **done** | — |
| 34 | ORION Health UI | **done** | — |
| 35 | Natural-Language Health Journal | **done** | — |
| 36 | Behavior Correlations | **done** | — |
| 37 | Experiment Mode | **done** | — |
| 38 | Health-Aware Planning | **done** | — |
| 39 | Daily Planning | **done** | — |
| 40 | Travel and Timezone Support | part-done | the live cron weather and day boundary are re homed |
| 41 | Notification Engine | **done** | — |
| 42 | Security Center | **done** | — |
| 43 | LOCK ORION | part-done | requires reauthentication for sensitive operations |
| 44 | Mac Remote Connection Foundation | part-done | no named requirement recorded |
| 45 | Remote Mac Read-Only | **done** | — |
| 46 | Harmless Mac Actions | part-done | supports mobile cancellation, optional arguments are visible where the model reads its capabilities, a timed out action is retried at least once |
| 47 | File Capabilities | part-done | adds files copy |
| 48 | Mac Privilege Separation | not started | splits execution into user worker and privileged broker, privileged broker exposes only a tiny explicit interface, keeps privileged code minimal, signs and hardens executables, prevents unauthorized replacement or tampering, binds destructive authorization to the requesting turn |
| 49 | Remote Approval System | part-done | shows a human readable approval on iphone, requires face id where appropriate, signs approval with a device authorization key, mac verifies signatures independently |
| 50 | Delegated Policies | part-done | every delegation defines capabilities resources exceptions limits expiration ceiling and devices |
| 51 | Structured Terminal Operations | part-done | the bare git allowlist entry is retired |
| 52 | Raw Terminal Access | part-done | treat raw terminal as r5 with session visibility faceid duration audit and cancellation |
| 53 | Automation Sessions for Complex Computer Work | not started | creates bounded computer use sessions, every session defines goal device apps directories domains capabilities and ceilings, requires additional approval to expand scope |
| 54 | Screen Observation Privacy Layer | **done** | — |
| 55 | Prompt Injection Defense for Computer Use | **done** | — |
| 56 | Remote Session UI | not started | shows task device step elapsed risk and capabilities on mobile, uses live activities where appropriate |
| 57 | Automation Framework | part-done | no named requirement recorded |
| 58 | Automation Simulation | part-done | uses historical data where available |
| 59 | Proactive ORION | not started | scores items by urgency actionability novelty confidence importance and interruptibility, places low priority suggestions in today |
| 60 | Focus Sessions | part-done | no named requirement recorded |
| 61 | Prep Cards | not started | no named requirement recorded |
| 62 | Waiting-On Tracking | not started | no named requirement recorded |
| 63 | Explainability | part-done | no named requirement recorded |
| 64 | Confidence Handling | part-done | no named requirement recorded |
| 65 | App Intents and System Integration | not started | adds ask add start focus whats my day run automation and lock, exposes through siri shortcuts widgets and control center |
| 66 | Live Activities | not started | uses live activities for focus sessions and remote jobs |
| 67 | Cost Controls | part-done | no named requirement recorded |
| 68 | Reliability Testing | not started | no named requirement recorded |
| 69 | Security Attack Testing | part-done | no named requirement recorded |
| 70 | CI/CD Security | part-done | no named requirement recorded |
| 71 | Data Inventory | part-done | no named requirement recorded |
| 72 | Privacy Controls | part-done | no named requirement recorded |
| 73 | Backups and Recovery | part-done | tests the four named recovery scenarios |
| 74 | Incident Response | part-done | no named requirement recorded |
| 75 | Development Workflow | part-done | no named requirement recorded |
| 76 | Features Explicitly Deferred | part-done | no named requirement recorded |
| 77 | Future Apple Watch Expansion | not started | creates a lightweight watch companion |
| 78 | Future Travel Assistant | part-done | adjusts schedule timezone |
| 79 | Future Reservation Capability | not started | discovers inspects presents books and records a reservation |
| 80 | Future Call Capability | part-done | no named requirement recorded |
| 81 | Future Location Context | part-done | maintains retention limits |
| 82 | Public Release Preparation | not started | tests account recovery device loss and secret rotation, performs the external reviews |
| 83 | Multi-User Hardening | not started | enforces tenant isolation and object level authorization, adds rate limits quotas and abuse controls, isolates jobs connectors memories and encryption context |
| 84 | Final ORION Mobile Product Shape | not started | delivers today plan orion health and control surfaces |
---

## 2. What happened in the 2026-09-05 → 09-07 run

Nick set seven priorities in his own order, then extended them. Every claim below
was verified in the moderating session by re-running the check or the mutation,
not taken from an agent's report — several agent reports were wrong in ways that
only re-running caught, and that is recorded where it happened.

### 2.1 The seven

**1 — Discord dispatch.** It works. `files desktop` was driven end to end through
`inject` → `poll` → outbox against the *installed* bridge with the real
allowlisted sender. Non-allowlisted senders, replays, `local` approvals and
fabricated gate ids were each refused by exercise rather than by reading.

The defect was on the failure path: a crashed or timed-out brain call put raw
exec output into the Discord reply — absolute paths, the message-file location,
and the live session key, in a DM, on every crash. Discord is a third party, so
that is a disclosure. It answers in one plain sentence now.

**Still not installed.** `orion-remote-install --status` reported DRIFTED.
Installing restarts Nick's only proven remote route, and that script is off the
exec allowlist deliberately.

**2 — "Do actual tests."** Asked "I have something this Friday" four times from
identical state on a Saturday, Orion answered Sep 5, Sep 12, Sep 5, and "Sep 5 —
that's today". The answer was Friday **Sep 11**; Sep 5 and Sep 12 are both
Saturdays. He had no grounded clock and was doing weekday arithmetic from memory,
which is why every wrong answer sounded confident.

One baseline run is the whole diagnosis: it tried `orion-agenda friday`, got an
exec failure, and fell back to `upcoming`. He was asking for the capability that
was missing — the tool had three subcommands and no way to ask about a named day.

Four repairs: a real `orion-agenda day <date|weekday|today|tomorrow>`; a dated
header printed by every subcommand (suppressed under `--json`, since a
fingerprint carrying today's date changes at midnight); a `## Dates` rule saying
dates are read from tool output, never worked out; and reminders checked
alongside the calendar, because "something on Friday" is as likely to be a task.
Eleven runs under one rubric: **57.5 → 91.7 → 100**.

**The harness needed more repair than Orion did.** It accused him of mutating the
calendar by string-comparing JSON whose key order is not stable; it read
`replayInvalid` as "untrustworthy" when OpenClaw defines it as *unsafe to replay
after compaction*, which every tool-using run sets; its tool parser looked for
`tool_use`/`input` while OpenClaw writes `toolCall`/`arguments`, so the
tool-selection dimension scored real behaviour against an empty list; and its
misdate regex passed the exact answers it existed to catch. The first correction
to that regex also caught nothing — `sept` never matches "Sep 5", and a trailing
`\b` fails on "12th" — which is why the replacement was verified against all
nine stored answers *before* being written.

**3 — Timeouts and visible progress.** Three ceilings, and two were exactly
equal: the client's hard read deadline (180+30) and the thinking watchdog were
both 210s. A tie, not an ordering, so one failure produced either the gateway's
specific error or the watchdog's generic one at random — which is why the same
symptom never looked the same twice. `RunTimeouts` states the ordering as a check
rather than three literals in three files. The agent's own budget went 180s →
300s, because "update yourself" is a build, a copy and a relaunch.

`RunProgressModel` gives the feed Nick asked for by name — "Ran two commands." —
and says so honestly when it knows nothing: "Still working — nothing new for
14s." **`openclaw audit` cannot distinguish domain actions**: calendar, mail and
health all dispatch through `orion_task_run` with the action in arguments audit
never records, so "Checking your calendar" was left unbuilt rather than faked.
**Cancellation did not exist at all** before this run; Escape was not even armed
during `.thinking`.

**4 — "He STILL cuts me off."** The setting Nick raised from 900 to 1400 ms was
never read in hands-free mode. Two independent end-of-turn decisions existed:
Deepgram's server-side endpointing, which honours it, and `AppState.checkHandsFree`,
which ended the turn on a hardcoded `handsFreeHangover = 1.3` and consulted the
setting nowhere. 1.3 fires before 1.4. Across the whole app that setting was read
in exactly two places: the Deepgram query string, and the Settings row that
displays it back to him. He was turning a knob wired to a label.

It is an adaptive model now — transcript stability, terminal punctuation,
confidence, and a continuation vocabulary — and a preserved fragment is appended
to what follows, so a premature endpoint costs a late sentence instead of a lost
one. Spoken barge-in exists, gated on the audio route.

**Unmeasured, and the design note says so:** the confidence floor (0.55), speaker
energy floor (0.22) and extension multiplier (1.8×) are reasoned, not measured;
whether Deepgram populates `confidence` for this account is unverified; wired
headphones are not distinguished from speakers.

**5 — Local models and personalities.** A personality cannot express authority,
and the compiler proves it: `PersonalityProfile` has seven fields and no
capability, tier, profile or strictness field exists to be set. The test runs the
real TypeScript compiler over the actual source plus a fixture that tries to add
`capabilityTier`, and asserts TS2353 — with a clean fixture asserted to compile
with zero diagnostics, so it cannot pass vacuously.

**6 — "The audio is terrible the second I talk to him."** He asked us to mask it.
It was avoidable. His headset is both default input and default output; opening
its mic collapses output 44100/2ch → **16000/1ch** and leaves it there four
seconds after he stops. Capturing from the built-in mic held **44100 stereo
through three full turns**. And restoring the route politely between utterances
*re-triggers* the collapse, because `AVAudioEngine`'s input node tracks the
system default for as long as the engine object exists — so the lease is held for
the app's run. The media duck now spans listening, thinking *and* speaking.

**7 — Permissions.** Already shipped 2026-09-02 as the strictness axis
(`contained | guarded | open | sovereign`), composing with the five-rung
permission profile, with a floor no mode can lower. The machine sits on `guarded`.

### 2.2 Capability and permission repair

`scripts/orion-learn` had been reading Orion's sessions the whole time: **263
sessions, 157 findings, none ever applied.** Retry loops alone had burned
**11,826,304 tokens**.

The top finding was not a prompt problem. `episodic.ts`'s durable-signal
classifier did not recognise "before I forget", so the harness's own live test
for capturing a fact stated in passing failed regardless of the instructions. Two
lines. `orion-bench --live` went 2/4 → 3/4 and P4, P5, P6 and P7 now report zero.

**The 11.8M-token loop had a cause.** Every transcript was the same shape: a
correct refusal that taught nothing, answered by guessing a different command.
`grep` **is** allowlisted; the *pipe* was refused, so the second guess reasoned
from a false premise the error itself supplied. That message comes from the
vendored openclaw package and cannot be patched here — but `before_tool_call`
fires first, so `routeForDoomedExec` now names the route before the unhelpful
refusal happens.

**Web search was dead.** It was in the tool profile all along; the free
DuckDuckGo provider was one of 61 disabled plugins and `plugins.allow` blocked
enabling it. Fixed at all three layers and verified with a live query. `web_fetch`
and readability extraction are on. Orion did not know he had any of it, so his
operating rules say so now.

**Computer use exists.** `screen_observe` walks the AX tree; `screen_capture` is
the pixel fallback, because AX metadata is text — cheap, redactable, and it does
not carry pixels of a bank balance. `screen_click`/`screen_type`/`screen_key` are
floored at APPROVAL in every mode including `sovereign`, and that floor is earned
by `reversible: false` + `risk: critical` rather than by `approvalRequired`
alone. **Both capabilities are behind config flags; observe is on, control is
off.** Neither works until the TCC grants land (§4).

### 2.3 The offline coder

`scripts/orion-code` — Orion changes his own code with no network. Ollama on
loopback, git local, tests local.

- **`orion-code loop --hours N`** is the agentic one: it surveys what this
  repository records as unfinished — 44 unmet phase requirements, the
  `orion-learn` findings, TODO markers; 92 items on the first run — picks one,
  writes its own concrete task, works out which file that means, edits, checks,
  commits, and asks again. It stops only when the survey returns nothing
  unattempted, two tries per item.
- **`orion-code flight --hours N`** works a fixed queue instead.
- **`selfdev_queue`** is the typed action, so Nick says it in a sentence.

**Model: `gpt-oss:20b`**, on throughput. Ollama's server log gives it directly:
~30–53 tokens/sec against `qwen3.6:27b`'s **5.2**, because MXFP4 is natively
accelerated on Apple silicon and Q4_K_M is not. Over seven hours that is twenty
tasks versus a hundred. Both wrote correct code for the same real task; the 27b's
regex was more careful, at 392s against 106s.

**It is bounded by:** a git worktree on `orion-selfdev`; whole files rather than
diffs; the **installed** plugin's forbidden-surface table, so it cannot edit the
approval verifier or policy evaluator and cannot widen that list without a human
deploying first; a check that must pass; and it never pushes and never installs.

---

## 3. Lessons this program keeps re-learning

Written down because each of these has cost real time more than once.

**A count goes stale; pin contents.** `expect(dev.length).toBe(7)` broke the
moment a dev action was added — the third time a stale count has reported a
correct change as a regression. Assert the names.

**A line that MENTIONS an effect is not a line that performs one.** This has bitten
the `orion-authority` regex declarations, a secret scan on a comment, and a
deferred check reading source prose.

**The repo copy is not always the live copy.** `plugin/workspace/AGENTS.md` is
tracked; Orion reads `~/.openclaw/workspace/AGENTS.md`. Nothing kept them in
step, so two same-day edits were inert while looking authoritative. Seven live
*skills* existed in no repo at all, one of them actively telling Orion to
`npm install` a binary that is not allowlisted.
`scripts/orion_v2_workspace_sync.sh` reports both, and CI runs it.

**A check nobody runs is not a check.** Two Python contract checks refused
correctly for three days with no listener. So did `orion-learn`, for 263 sessions.

**A test whose verdict depends on the page cache proves nothing.** Four
compile-time proofs had no stated timeout: 1–3s warm, 8–16s cold, against
Vitest's 5s default. They passed here and failed in a fresh worktree.

**A refusal that teaches nothing invites a guess.** See the 11.8M tokens above.

**Measure the right thing.** Model choice was made on wall-clock over a tiny
prompt and was wrong; tokens/sec reversed it. Two jobs against one Ollama model
also serialise — a benchmark running beside the coder makes both crawl, which was
misread as the model being slow.

**A typecheck rewards dead code.** The first autonomous cycle passed by adding a
well-documented, correctly-typed function that nothing calls. The bar is the test
suite, and an added export that nothing references now fails the attempt.

---

## 4. What only Nick can do

1. **`gog auth manage`** — Gmail's refresh token is dead (`invalid_grant`). Click
   **"Add more permissions"** on the account row; that is the re-grant path,
   despite the label. Everything local reports healthy because a token *exists* —
   only Google can say it works. It has died twice and sat dead for three weeks.
   `orion-doctor` now makes a real read and says which failure it is.
2. **`scripts/orion-remote-install`** — the Discord leak fix is written, not live.
3. **TCC grants for computer use** — Accessibility, and Screen Recording for
   `screen_capture`, on `/Users/nickmadaio/.openclaw/tools/node-v24.15.0/bin/node`,
   then relaunch the gateway. Note that granting Accessibility to a bare `node`
   binary is a broad grant. Then, if wanted:
   `openclaw config set plugins.entries.orion-control.config.enableComputerControlActions true --strict-json`
4. **Talk to him with headphones on, and play music while you do.** Three voice
   thresholds are reasoned rather than measured, and whether the audio route
   *sounds* right is a judgement only he can make.
5. **Assign the `unrestricted` role** if he wants it. It is declared and
   deliberately unassigned in `model-roles.seed.json`; no uncensored model is
   installed and choosing one is his call. It inherits the permanent rule either
   way: unrestricted *speech*, never unrestricted capability.

---

## 5. Known-not-done, stated plainly

- **There is no iPhone app.** `native/OrionMobile` is a `MobileCore` library and
  a check executable. No app target, no `.xcodeproj`, nothing installable.
  Phases 49, 56, 65, 66 and 84 are written against an app that does not exist.
- **Phase 53's bounded automation sessions** are not built. 54 and 55 are.
- **Computer use has no click-by-element** — coordinates only — and no scroll or
  drag.
- **No clipboard capability.** `pbpaste` is refused and now says so rather than
  inviting a retry.
- **Phase 68 reliability testing**: 7 of 23 scenarios uncovered.
- **The remote bridge's reconnect log has no timestamps**, so its 36 socket
  errors and 36 session invalidations cannot be correlated to wall-clock time.
  That churn is the most likely explanation for "sometimes it doesn't work" and
  is currently unmeasurable.

---

## 6. Running things

```bash
scripts/orion_v2_ci_check.sh          # everything that can run without the Mac
scripts/orion-doctor                  # the live stack, including a real Gmail read
scripts/orion-deploy                  # build, full suites, install, prove, auto-rollback
scripts/orion_v2_workspace_sync.sh    # is the tracked copy what Orion reads
scripts/orion-eval replay             # re-score every stored eval run, offline
scripts/orion-learn                   # what his own sessions say he gets wrong
scripts/orion-code loop --hours 7     # he works on himself until nothing is left
```

Six suites assert against the live Mac and cannot run in CI — strictness, lock,
remote, backup, authority contract, mobile. `orion-deploy` runs them, which is
why a deploy is the real gate and "CI was green" is not a sufficient answer here.
