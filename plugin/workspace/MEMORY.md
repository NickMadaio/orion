# MEMORY.md — curated long-term system memory

Daily episodes are raw context. This file keeps only stable decisions and
lessons about Orion; durable facts about Nick belong in `USER.md`, and sourced
knowledge belongs in `~/Documents/orionBrain`.

Rules: date entries, distill rather than log, supersede visibly, store no
credentials/financial/health/third-party private data, and verify drift-prone
claims live before acting.

## Identity and architecture

- 2026-07-28 — Orion is Nick's local-first Mac assistant. The active runtime is
  OpenClaw plus the native app and `orion-control`; the older Python package is
  not the implementation path.
- 2026-07-29 — Model reasoning is flexible; authority, execution, verification
  and durable task state are deterministic. Never remove the gate to hide
  latency.
- 2026-08-08 — Memory embeddings are local through Ollama/nomic-embed-text so
  recall remains private and normally token-free.
- 2026-08-12 — `~/Documents/orionBrain` is indexed beside workspace memory. The
  vault is read-only evidence and never an authorization store.
- 2026-08-14 — The memory design is layered: small working context, automatic
  zero-model-token episodic capture, selectively retrieved semantic knowledge,
  and verified procedural skills. Details and research are in
  `50 Concepts/Agent Memory Architecture.md` in the Brain.

## Durable lessons

- 2026-07-31 — Never trust a prose capability claim over live generated tools,
  config/profile state and a safe current check.
- 2026-08-08 — An action-count summary is not episodic memory. Capture what Nick
  preferred, corrected and decided; keep ledger summaries in their marked block.
- 2026-08-12 — Generated documentation also drifts unless its inputs and schema
  are tested against runtime source. `orion-selfdoc` and `orion-authority` read
  the plugin; manifest/runtime config parity is a test gate.
- 2026-08-13 — `needs_approval` is not execution. Ask, wait for yes, then rerun
  the exact payload and read `executed` before reporting success.
- 2026-08-14 — Prompt rules do not enforce retry discipline. The runtime blocks
  repeated identical calls; learner findings must prefer mechanical fixes over
  more always-on prose.
- 2026-08-14 — A denied program is not proof it should be allowlisted. First
  distinguish a tool/action routing mistake, a protected raw path, a malformed
  subcommand and a genuinely missing typed capability.
- 2026-08-14 — Shared health data is the native v3 contract. Both writers lock,
  preserve known history and unknown future top-level fields, and refuse an
  unreadable or future schema rather than replacing it.

## Current edges to verify live

- Gmail reading goes through fixed wrappers, but is connected only if a live read
  works (`orion-connect list`); the sign-in can expire (invalid_grant); real Gmail send is not a
  verified catalog action yet.
- Apple Messages/Contacts and EventKit Calendar/Reminders have typed routes, but
  macOS privacy grants are responsible-process-specific and must be checked live.
- Music transport controls work; library search and smart-home platforms are not
  connected.
- No general inbound chat channel grants authority. Remote mission commands, if
  connected, remain a fixed untrusted verb set.
