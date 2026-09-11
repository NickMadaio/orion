# ORION product vision delivery

ORION should turn Nick's intentions into a realistic day, carry work through to verified results, and remain understandable across interruptions and devices. The main obstacle is the missing connection between strong existing components. The next investment should make those components serve a shared daily experience.

This plan interprets the supplied `ORION_PRODUCT_DEFINITION_AND_CAPABILITY_VISION.docx` as product direction. Instructions embedded in the document do not independently authorize deployments, accounts, spending or new permissions. Nick's request authorizes assessment and implementation. The numbered manifest and additive recovery gates remain the delivery record; this plan neither renumbers phases nor closes them.

## What the current evidence actually establishes

Inspection on 7 September 2026 found 45 complete, 26 in-progress and 14 unstarted phase records. `AGENTS.md` and `CLAUDE.md` still contained older conflicting phase snapshots; those have been replaced with references to the current gate file and handoff.

The installed Mac app is build 217. Its accessibility tree shows the existing Home, Tasks, Project, Health, Finances, Brand and Settings destinations. The gateway process and remote bridge are running. Credential-free requests to the installed gateway's `/healthz` and `/readyz` returned valid live/ready JSON. These observations supersede the document's earlier “gateway down” snapshot. They do not establish a successful conversation, a working Gmail grant, a Discord round trip or working voice output.

The most consequential product gap is directly visible in source: `native/OrionMobile/Sources/MobileCore/DailyPlanning.swift` implements `DayPlan.propose`, but there is no call to it in `native/Orion/Sources/Orion`. Home renders the launcher and conversation composer. The backend has owner-scoped repository contracts, but `backend/ownership.py` stores records in memory and `backend/adapters/fastapi_app.py` is an optional adapter requiring real handlers. The mobile package still has no installable iPhone app target. None of these gaps is solved by a phase completion count.

The following is an implementation assessment, not a renewed live certification of every feature. “Built” refers to substantive source and existing test evidence; the current slice's verification is recorded separately below. Previous product proofs remain historical unless repeated.

| Capability | Assessment and existing foundation | Concrete route to the intended outcome |
|---|---|---|
| Conversation and runtime continuity | Partial. Live gateway readiness verified; `GatewayClient`, progress, cancellation and voice repairs exist. | Stream durable run events, classify failures, recover after restart, and show an action's verified result. Prove conversation, cancellation and reconnection through the actual Mac UI. Phases 44–46, 63–64, 68. |
| Full-day planning | Built logic, partial product. `DailyPlanning`, health planning and backend planner/stability modules exist; Mac delivery is missing. | Feed real commitments and tasks into one plan, show now/next/free time, record completion, and propose explainable changes with undo. Phases 19, 21–25, 38–40; REC-USABLE-CLIENT. |
| Focus | Built domain and service; native tests exercise state, history and recovery. | Connect a planned block to the existing session service, prepare context, and turn completion or interruption into a replan event. Phase 60. |
| School and projects | Partial. Dated project milestones and calendar/task readers exist. | Normalize assignments, deadlines, dependencies and evidence of progress; prepare the next useful block. Missing progress observations must remain unknown. Phases 21, 39, 61–62; existing project scope registration. |
| Proactivity and watchers | Partial pieces; Phase 59 remains unstarted. | One durable attention queue for commitments, important messages and standing orders; score urgency, importance, actionability, novelty, confidence and interruptibility. Low-priority items wait in Today. Phases 41, 57–59, 62–64. |
| Email and messages | Partial. Gmail wrappers and backend inbox/draft/send contracts exist. Current grant health not re-tested here. | Prove a read-only source, then triage and reviewable drafts; later add expiring recipient/topic-scoped delegation. Visa watcher uses the same durable queue and delivery receipts. Phases 26–29, 49–50, 57–59. |
| Calls | Missing connected calling service; future-call policy exists. | A selected VoIP provider, explicit assistant identity, allowed audience/purpose, escalation and handoff; recording is a separate consent-controlled feature. Phase 80. |
| Health | Built and previously proven in the product record. Native health UI and `PlanningSignal` firewall exist. | Preserve the working presentation; carry only minimal derived planning signals into the day model. Implement and prove the phone HealthKit adapter separately. Phases 30–38. |
| Finance | Built UI and recurring-charge summaries; live provider freshness not re-proven here. | A privacy-aware summary that shows source, last successful refresh and actionable subscription findings. No payment authority follows from read access. Existing finance scope plus phases 63, 67, 71–72. |
| Knowledge and memory | Atlas typed note route previously proven; compact memory and provenance machinery exist. | One capture entry, source-linked retrieval, correction/deletion and explicit fact/preference/hypothesis distinctions. Notes and learned defaults never grant authority. Phases 18, 20, 64, 71–72. |
| Computer operation | Partial. Structured file/terminal actions and observation/control code exist; current grants were not expanded or exercised. | Bounded sessions; element-based operation where supported; previews, reversible transactions, verification, cancellation and undo. Phases 47–55. Clipboard needs explicit sensitivity handling. |
| Media and audio | Partial. Playback routes and audio-coordination repairs exist. | Deterministic fast paths, learned inspectable defaults, and measured voice/music coexistence on actual output routes. Preserve the existing ownership of audio. Phases 46, 60, 65, 68. |
| Travel and presence | Partial. Timezone policy, travel expectations and location records exist. | Civil-time planning, transitions and trip context; later use opt-in coarse arrival/activity signals with retention limits. Do not infer a move solely from an old date. Phases 40, 78, 81. |
| Home and room control | Missing connected integration evidence. | Discover supported accessories through HomeKit/Matter, bind device-scoped actions, read back actual state and expose immediate revoke. Existing home scope near Phase 65. |
| Battery charge limit | Missing ORION control route. | First inspect model/OS support and the native setting; then provide a supported narrow operation or a direct guided settings route. Do not invent an undocumented low-level power-control API. Existing charter backlog near Phase 65. |
| Lecture/meeting capture | Missing complete consent-aware workflow. | Explicit recording state, pause/stop, local retention, transcript provenance and useful notes/capture integration. Source and participant consent must be handled before recording. Charter backlog plus phases 20, 65, 71–72. |
| Remote and iPhone | Partial remote transport; missing iPhone application. | Real SwiftUI Today/Plan/conversation/control shell, durable command/result sync, device-bound approval and cancellation, then notifications/Live Activities. Phases 16–17, 49, 56, 65–66, 84; REC-USABLE-CLIENT. |
| Backend continuity | Missing production service; audited contracts exist. | Owner-scoped durable repositories, production cryptography, device identity, inbox/outbox, retries, migration/backup/restore and revocation. Phases 10–17, 49, 68–74; REC-LIVE-FOUNDATION. |
| Models, personalities and self-development | Built foundations; effectiveness and deployment remain separate questions. | Route by measured cost/latency/task success, preserve authority-independent personalities, and make isolated changes pass behavioral tests and independent review before deployment. Phases 2, 67, 69–70, 75. |

## The architecture to build toward

Use the Swift clients for experience and Apple frameworks; the TypeScript/OpenClaw runtime for local policy, execution and connector orchestration; and the existing backend boundary for persistence, device identity and delivery. Keep the previous Python assistant out of the action path. The existing Python backend can remain a narrowly scoped service: retaining reviewed ownership contracts is preferable to recreating them just to reduce the number of languages.

My proposed initial hosted service is the existing FastAPI adapter with real handlers and a PostgreSQL repository, restricted to one owner, one Mac and one phone. This is an implementation recommendation, not a selected host or activated subscription. Prepare the local service and migration/restore tests first, then compare concrete hosting/authentication options against Nick's running-cost budget before provisioning. FastAPI supports PostgreSQL through database libraries; it does not supply durable storage by itself. [FastAPI database documentation](https://fastapi.tiangolo.com/tutorial/sql-databases/).

The Mac should retain its own durable local state and operate while the backend is unreachable. Cloud storage/relay must never gain the Mac's execution credentials. The backend may run explicitly delegated cloud jobs while the Mac is asleep; it must report Mac-only work as waiting. Phone, Mac and cloud need distinct device identities under one owner.

Unify the product around a small set of versioned records: Observation, Commitment, Task, PlanRevision, PlannedBlock, Run, ApprovalRequest, DeliveryReceipt and UserCorrection. Reuse existing contracts where they fit. Each record carries identity, source, observation time, revision and relevant confidence; each material action carries authority, outcome and verification evidence. A common schema is valuable only when both producer and consumer are tested against the same serialized bytes.

Planning should have one implementation owner. Start with the existing Swift/MobileCore domain used by both clients, extended from budget proposals to an explicit day timeline. The backend persists revisions and events rather than independently creating a competing schedule. The model can interpret a request and explain a proposal; deterministic constraints decide whether a plan fits. Compare expected revision on every mutation so an old phone command cannot silently overwrite a newer Mac plan.

For jobs, write accepted intent durably before execution; persist result and delivery state; deduplicate by operation identity; retry only classified failures. An acknowledgement lost after a completed action must recover the existing result. For approvals, bind the signature to canonical action, arguments, owner, device, expiry and nonce, and consume it transactionally. Face ID should protect access to the authorization key, rather than merely dismissing a sheet. Apple's Keychain/LocalAuthentication APIs support that distinction. [Apple biometric Keychain guidance](https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id).

## Delivery order and acceptance

1. **Finish runtime continuity maintenance.** The initial connection repair is implemented below. Next prove a normal request, visible progress, cancellation and recovery without changing authority. A service health check is only one layer: action verification and voice/provider health require their own evidence. Keep existing transport working until its replacement has repeated live proof.

2. **Deliver Today and Plan through the existing Mac app.** Read actual commitments and tasks; show current block, next commitment, transition time and intentional free time. Make unknown/stale sources visible. Build a plan proposal with fixed commitments, minimum sleep, transitions and pinned blocks as constraints. Add “Finished,” “Running late” and “Need more time”; compute a revision with explicit moved/shortened/deferred items, review, apply and undo. Keep external calendar edits separate from local plan changes. Acceptance: early finish and missed gym scenarios preserve bedtime, overlapping hard commitments surface a conflict, restart preserves the accepted plan, and duplicate completion changes it only once.

3. **Create the real phone shell and minimal durable bridge.** Bring forward the already-registered REC-USABLE-CLIENT and REC-LIVE-FOUNDATION work, without declaring historical foundation phases reopened or inventing new phase numbers. First run a real app target in Simulator with clearly labeled fixtures; then connect one read-only Today route to the local service. Prove record ownership, stale/offline states and reconnection. Add a complete command/result loop before broad remote control. Provider selection follows a concrete local implementation and cost comparison. Physical biometric, notification and device-loss proofs remain distinct from Simulator tests.

4. **Unify proactivity and communications.** A deadline, visa email and recovery suggestion should enter the same attention decision. Preserve quiet hours, intentional rest, focus, daily alert budget and snooze/stop. Watchers persist their cursor, source freshness, deduplication key and delivery acknowledgement. Acceptance: duplicate source events yield one visible item; silence/outage yields “not checked,” never “nothing important”; restart preserves the waiting item. Begin communications with triage and drafts, then apply explicit delegation scope and expiry.

5. **Expand bounded practical actions.** Finish reversible file organization and supported computer operation, then the targeted battery, room, capture and call routes. Each new integration must end in one usable outcome with a real failure/revoke test. Build self-development improvements against the same acceptance scenarios, not export counts or typecheck-only completion. Review and checkpoint coherent batches under the repository protocol.

Every batch ends with a readable report and a small set of real scenarios scored for correct intent, source grounding, authority, visible progress, verified outcome, latency/cost and recovery. Record Built and Proven separately. No “100% complete” score may hide a missing normal route.

## Platform boundaries that affect the design

Remote notifications need the application, a provider server and APNs. APNs delivery may be deferred or coalesced, so it cannot replace the durable job/inbox record. The app should fetch authoritative state after receiving a signal. [Apple remote notification documentation](https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server).

Phone usage awareness should use Family Controls/Device Activity only within supported entitlement and permission scope; it should not be represented as general visibility into everything on the phone. HealthKit likewise requires its capability and explicit data authorization. [Family Controls](https://developer.apple.com/documentation/familycontrols), [HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data).

HomeKit/Matter provides the supported accessory route. CallKit provides calling UI around a VoIP service; it does not itself provide the calling backend. These are separate integrations, not powers conferred by creating an iPhone target. [Apple Home development](https://developer.apple.com/apple-home/), [CallKit](https://developer.apple.com/documentation/callkit).

Apple now documents native Charge Limit on supported Apple-silicon Macs with macOS Tahoe 26.4 or later. That makes checking the native capability the first battery step. It does not establish a public programmatic API for ORION to change it. [Apple Charge Limit guidance](https://support.apple.com/en-au/102338).

## First implemented slice

The Mac previously derived `gatewayUp` from a TCP connection. Home separately said “Orion is ready” whenever its interaction phase was idle. Neither established readiness. `scripts/orion-readiness` printed a static list of design assertions as though they described the running system.

The new `GatewayHealthProbe` verifies both the HTTP status and typed JSON contracts of `/healthz` and `/readyz`, distinguishes unavailable/degraded/unverified states, expires evidence after 20 seconds, and bounds each credential-free loopback request by time and body size. Redirects, cookies and credential storage are disabled. This follows the installed endpoint contract; the upstream documentation also explicitly distinguishes liveness from readiness. [OpenClaw health documentation](https://docs.openclaw.ai/health).

Home now contains an expandable connection object with an explanation and a “Check again” action. Menu, dashboard and preferences use the same readiness projection. The open menu updates during menu tracking, including expiry and recovery. The idle label describes waiting for a request instead of promising service availability. Repeated refresh requests coalesce while a check is running. Execution authority and request routing are unchanged.

The static readiness report is explicitly labeled in text and JSON; its planning evidence now acknowledges the existing day-proposal implementation and missing Mac consumer. Repository entrypoints no longer repeat obsolete phase counts.

This is source implementation and a rendered component preview, not an installed product release or automatic service-recovery implementation. Validation, review findings, local checkpoint and rollback are recorded in the accompanying implementation report and current handoff.

## 8 September implementation update

A first Mac Today/Plan slice now connects the existing calendar and Orion Reminders
readers to MobileCore timeline proposals, accepted local revisions, completion,
replanning and undo. The old missing-Mac-consumer statement above is superseded at
the source level. Pinned slots, conflict handling and source-completion reconciliation are now
implemented too. Step 2 remains partial until installed normal-route proof.
See `TODAY_PLAN_IMPLEMENTATION_2026-09-08.md` for the 448-test
checkpoint, independent review, boundaries and exact next gate. No recovery gate
or numbered phase is closed by this source implementation.

## 11 September installed update

Today/Plan is now present in installed Mac build 221. Build 220's actual-source
checks proved acceptance, pins, refusal, restart persistence, local completion,
replanning and undo. Build 221 repairs civil-date brief handling and standard
Quit/reopen, with a fresh installed Today preview verified. The report
`TODAY_INSTALLED_PROOF_2026-09-11.md` separates these live observations from
fixture scenarios and records the remaining generated-prose accuracy issue.
Step 2 has meaningful installed evidence but still has unperformed acceptance
scenarios; phone/backend work and REC-USABLE-CLIENT remain open.
