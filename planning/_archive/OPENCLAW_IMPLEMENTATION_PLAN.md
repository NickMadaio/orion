# Orion on OpenClaw — current implementation plan

Date: July 29, 2026

## Source-of-truth order

When older recommendations conflict, use this order:

1. `ORION_COGNITIVE_ARCHITECTURE.md`
2. `IMPLEMENTATION_HANDOFF.md`
3. `OPENCLAW_MIGRATION_PLAN.md`
4. This execution plan
5. `ORION_BUILD_ROADMAP.md` only for product intent and historical context

The selected architecture is local-first and adaptive. Gemma 4 31B is the
proposed executive model, but it is not promoted until the deterministic
control skeleton and gateway benchmarks pass. GPT-OSS remains a low-authority
utility. Cloud remains an optional analysis-only adviser under the $0–10/month
ceiling.

## Verified baseline

- OpenClaw `2026.7.1-2` is installed and its Gateway runs as a LaunchAgent.
- The Gateway is loopback-only with token authentication.
- GPT-OSS 20B remains the primary model; this implementation did not change it.
- Ollama web and browser tools remain denied.
- Security audit after the Orion Control install: zero critical findings, two
  unchanged warnings.
- A verified private backup was created before the plugin configuration change.

## Implementation sequence

### Slice 1 — deterministic control skeleton

Status: implemented and loaded.

The local `openclaw-plugins/orion-control` package provides:

- a typed TaskGraph contract;
- a fixed action catalog and risk taxonomy;
- deterministic argument, trust, dependency, cycle, risk, verifier, retry, and
  approval-binding checks;
- simulation-only execution;
- independent read-back verification;
- an append-only durable JSONL task ledger;
- a read-only task-status tool.

The execution tool is optional and therefore is not exposed to the model until
explicitly allowlisted. The status tool is read-only. The initial executor
cannot change files, apps, messages, reminders, calendars, or other real state.

Acceptance evidence:

- seven tests pass;
- nested parent/children ordering passes;
- three combined harmless actions pass and are independently verified;
- ambiguous cleanup produces clarification without actions;
- destructive approval is invalidated by an argument or context change;
- an action sourced only from quoted untrusted text is rejected;
- an incomplete email send is rejected;
- OpenClaw's plugin validator passes;
- live runtime inspection reports both tools loaded with no diagnostics.

### Slice 2 — Gemma gateway evaluation

1. Keep the real action executor disabled.
2. Run Gemma through the real Gateway against the TaskGraph schema.
3. Measure structured-output correctness, first-action latency, and recovery.
4. Run the adversarial suite, including prompt injection, stale approval,
   duplicate request, partial failure, and contradictory instructions.
5. Promote Gemma only if it clears the agreed gates; otherwise keep it proposed
   and record the failures.

### Slice 3 — adaptive cognition

1. Add observable routing between reflex, working, and deliberative modes.
2. Let reflex mode handle only complete, reversible, single actions.
3. Use a verified next-action loop for ordinary short work.
4. Reserve full TaskGraphs for dependency, ambiguity, durability, risk,
   unfamiliarity, untrusted input, or recovery.
5. Keep trust labels and instruction/data separation common to all modes.

### Slice 4 — harmless real actions

1. Add one canonical action at a time.
2. Start with read-only state and scoped, non-destructive actions.
3. Require an independent verifier before marking success.
4. Add idempotency keys and bounded retry before live combined requests.
5. Do not add destructive or external actions until approval binding, preview,
   interruption, and resume are proven.

Task Flow should hold durable work once the controller creates detached child
tasks. Lobster should encode reviewed, stable workflows later; it should not
replace the general adaptive controller.

## Follow-on: voice activation using “Orion”

Status: recommendation complete; not enabled.

The installed macOS app already supports native Voice Wake and push-to-talk on
macOS 26+. The current Mac is on macOS 26.5.2. OpenClaw exposes a Gateway-owned
global trigger list, a native overlay, mic-level display, chimes, silence
timeouts, a 120-second hard stop, and push-to-talk by holding Right Option.
The current trigger list is still the default `openclaw`, `claude`, and
`computer`; it was not changed. Always-listening behavior was not enabled.

Recommended local-first design:

1. **Push-to-talk pilot first.** After explicit user confirmation, enable only
   hold-Right-Option capture. Keep the visible overlay and listening chime on.
   This proves transcription, routing, cancellation, and the Orion controller
   without an always-open microphone.
2. **Native wake-word pilot second.** After a separate opt-in, replace or add a
   single distinctive trigger, `Orion`, using OpenClaw's built-in macOS Speech
   path and local Gateway. Do not add a cloud realtime-voice provider. Verify
   whether the selected macOS locale performs recognition on-device before
   describing the path as fully offline.
3. **Visible state is mandatory.** Listening must always show the overlay,
   live meter, and menu-bar state; detection and send chimes remain enabled.
   The X button and a spoken cancellation phrase should discard the pending
   transcript without creating a task.
4. **Treat wake detection as attention, not approval.** A wake transcript may
   create a proposal. It may not approve destructive, external,
   account-changing, financial, publishing, or speak-on-the-user's-behalf
   actions.
5. **Separate consequential confirmation.** The assistant reads or displays
   the exact proposed effect, then requires a fresh explicit confirmation
   bound to the canonical action hash. Changed arguments or context invalidate
   it. Critical actions should retain a click/type confirmation option even
   when normal voice approval is later supported.
6. **Handle false positives locally.** Use OpenClaw's required pause after the
   wake name, trigger-only timeout, debounce, and hard capture stop. Track only
   local aggregate counts for wake-without-command, manual dismissal, and
   accidental sends; do not retain ambient audio. Tune or disable wake mode if
   false activations exceed the agreed threshold.
7. **Keep push-to-talk available permanently.** External keyboards can miss
   Right Option, so provide a configurable fallback shortcut before calling
   voice complete.

No service installation, microphone/privacy change, trigger-list mutation, or
always-listening toggle should occur without a later explicit user decision.

## Decisions still reserved for Nick

- When to expose the simulation runner to the main model.
- Whether Gemma clears the live promotion gate.
- Which first harmless real action to connect.
- Whether to begin the push-to-talk pilot.
- Whether to opt into always-listening Voice Wake after the pilot.
- Whether spoken approval is allowed for high-risk actions or those remain
  click/type-only.
