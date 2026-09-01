# ORION v2 Phase 2 — the Model Router

Status: **planned — 2026-08-20**. Phase 1 closed the same day; its exit-gate
deviation was accepted by Nick and is recorded in `PHASE_GATES.json`.

## The decision that shapes this phase

The manifest says "Create a centralized `ModelRouter`." Live inspection found
that ORION does not lack a router — it has **two**, and **three surfaces that
route themselves**. Building a third would be the failure this program is
supposed to avoid.

Nick's decision, 2026-08-20:

> **OpenClaw executes. ORION owns the contract.**

ORION defines a declarative role-to-model contract and one durable inference
telemetry ledger. OpenClaw remains the executing router for agent turns and is
configured *from* that contract. The self-routing surfaces are brought under the
same role names and the same ledger. **No second inference path is created.**

Rejected, and why:

- *A new ORION-owned router that makes provider calls itself.* Adds a hop to
  every turn. The 2026-08-16 routing decision in root `HANDOFF.md` deliberately
  refused to add a model hop per utterance, to protect Orion's response feel.
- *Reviving `orion/runtime.py`.* It already has roles, usage recording, cost
  estimation, and a budget — and it is dead code. Its roles (`local`/`fast`/
  `deep`) do not match the manifest's, and it would stand a second live
  orchestrator next to OpenClaw.

This is the Phase 1 runtime decision applied one phase later: Core defines
contracts; platform adapters execute them.

### The long-term intent behind that choice

Nick, 2026-08-20: *OpenClaw executes for now, and ORION owns abstract roles so
routing can be taken in-house later if we outgrow OpenClaw.* Not "A instead of
B" — **A now, B later, and A is what makes B cheap.**

That is a requirement on how this phase is built, not a footnote. Concretely it
means the contract and the ledger must be **executor-agnostic by construction**:

- no role, model, or provider name may encode "OpenClaw";
- the ledger's `source` records which ORION *surface* ran an inference — a fact
  about ORION's own shape, which survives a change of router — while a separate
  `executor` field records who actually routed it (`openclaw`, `orion_router`,
  `direct`);
- when the switch happens, the ledger becomes its own proof: rows stop saying
  `openclaw` and start saying `orion_router`, with everything else unchanged.

If taking routing in-house ever costs more than writing a new executor behind
the existing contract, this phase failed at its actual job.

## The territory, measured 2026-08-20

| Surface | Calls | Routed by | Roles it knows |
|---|---|---|---|
| OpenClaw gateway agent | `anthropic/claude-haiku-4-5` → `ollama/llama3.2:3b` → `ollama/qwen3.6:27b`; `nomic-embed-text` | **OpenClaw**, live | primary, fallbacks, utility, embedding |
| `orion/runtime.py` + `orion/cloud.py` | `ollama/gpt-oss:20b`, haiku "fast", sonnet "deep"; usage recording, `estimate_cost`, $15 budget | itself — **process is dead** | local, fast, deep |
| `native/Orion/Sources/Orion/LocalModel.swift` | `http://127.0.0.1:11434/api/generate`, one `defaultModel` constant | **nobody** | "local", implicitly |
| `native/Orion/Sources/Orion/DeepgramSpeech.swift` | Deepgram, `static let model = "nova-3"` | **nobody** | STT, hardcoded |
| `scripts/orion_tts_daemon.py` | mlx-audio local / ElevenLabs, `ORION_TTS_ENGINE=auto` | itself | TTS, own fallback |

`LocalModel` is consumed by `DistractionReasoner`, `NarrativeWriter`,
`MorningBrief`, and a `HealthTab` label.

Every model call ORION makes is on that list. Phase 2 is done when every row
names its role from one contract and lands one row in one ledger.

## Requirement derivation

Each manifest bullet, its state today, and what Phase 2 must add.

| Manifest requirement | Today | Phase 2 must add |
|---|---|---|
| Centralized `ModelRouter` | two routers, three self-routing surfaces | one contract all five read; OpenClaw stays the executor |
| Roles: reasoning, fast, vision, local, fallback, embedding | none named; OpenClaw has primary/fallbacks/utility/embedding | the named role set, plus ORION's `stt` and `tts`, which the manifest omits but which are model calls |
| Provider adapters | anthropic + ollama in OpenClaw; deepgram and elevenlabs ad hoc | declare all four in the contract with their credential source |
| Centralize model configuration | split across `openclaw.json`, two Swift constants, one env var | the contract is the single source; a drift check proves `openclaw.json` agrees |
| Centralize retries | **not configurable in `openclaw.json`** — provider defaults | declare per-role intent; record honestly that OpenClaw owns execution of it |
| Centralize timeouts | `agents.defaults.timeoutSeconds: 600`, `models.providers.ollama.timeoutSeconds: 300` | per-role timeouts in the contract, drift-checked against live config |
| Centralize token accounting | OpenClaw records `input/output/cacheRead/cacheWrite/totalTokens` per turn | normalize into the ledger; cover the surfaces OpenClaw cannot see |
| Centralize cost accounting | field exists but **every value is 0** | real per-role estimated cost, from a rate table in the contract |
| Centralize context construction | `contextPruning` (cache-ttl), `contextInjection`, `memorySearch` — genuinely centralized already | leave it alone; record it as satisfied and point at it |
| Support model fallback | OpenClaw fallback chain, live | keep; make the chain a property of each role |
| Provider replacement without rewriting Core | true for OpenClaw's two; false for Swift/TTS | role indirection removes the hardcoded model names |
| **Never give models credentials** | true for anthropic/ollama (Keychain SecretRefs). **False for Deepgram and ElevenLabs — both plaintext in `.env`, read directly** | move both to Keychain SecretRefs, as Phase 0 did for the other three |
| Never auto-give models all user context | `memorySearch` is conditional; recall is selective (2026-08-16) | record as satisfied; no regression |
| Least-context before every inference | pruning + conditional recall on the agent path; nothing on the Swift path | the ledger makes context size visible per inference so this stops being a claim |

Manifest tracking list — what a ledger row must carry:

| Field | OpenClaw records it? |
|---|---|
| model used | yes (`model`, `responseModel`, `provider`, `api`) |
| token usage | yes |
| latency | **no** — a timestamp, not a duration |
| estimated cost | field present, **always zero** |
| failure reason | **no** |
| fallback usage | **no** — the chain runs, nothing says it fired |

Four of six are gaps. That is the substance of this phase, not the role names.

## Architecture

### 1. The role contract

Canonical JSON Schema in `orion/core/schemas/`, matching the Phase 1 pattern:
language-neutral schema, Python reference validator, TypeScript and Swift
consumers. The live instance is runtime data, so it lives beside the app's other
runtime state in `~/.openclaw/orion-controlled/model-roles.json`.

Shape:

```jsonc
{
  "schemaVersion": 1,
  "roles": {
    "reasoning": {
      "primary": "anthropic/claude-haiku-4-5-20251001",
      "fallbacks": ["ollama/qwen3.6:27b"],
      "timeoutSeconds": 600,
      "maxRetries": 2,
      "rates": { "inputPerMTok": 1.0, "outputPerMTok": 5.0 }
    },
    "fast": { "primary": "ollama/llama3.2:3b", ... },
    "local": { "primary": "ollama/gpt-oss:20b", ... },
    "vision": { "primary": null, "status": "unassigned" },
    "embedding": { "primary": "ollama/nomic-embed-text", ... },
    "stt": { "primary": "deepgram/nova-3", ... },
    "tts": { "primary": "local/mlx-audio", "fallbacks": ["elevenlabs/..."], ... }
  },
  "providers": {
    "anthropic":  { "credential": { "source": "keychain", "ref": "..." } },
    "ollama":     { "endpoint": "http://127.0.0.1:11434" },
    "deepgram":   { "credential": { "source": "keychain", "ref": "..." } },
    "elevenlabs": { "credential": { "source": "keychain", "ref": "..." } }
  }
}
```

Two deliberate departures from the manifest's role list, both recorded rather
than quietly taken:

1. **`fallback` is not a role.** It is a property of one. A model is not "the
   fallback model" in the abstract; it is what `reasoning` falls back *to*.
   Implemented as per-role `fallbacks`, which is what the manifest means.
2. **`stt` and `tts` are added.** Deepgram and ElevenLabs are model calls with
   credentials, latency, and cost. Omitting them because the manifest's list did
   not name them would leave two of ORION's five surfaces unrouted, which is the
   problem this phase exists to fix.

`vision` is declared and left unassigned. A role with no model is honest; a role
invented to look complete is not.

### 2. The inference ledger

`~/.openclaw/orion-controlled/inference-ledger.jsonl`, append-only, one row per
inference, rotated like the task ledger:

```jsonc
{
  "ts": "...", "role": "reasoning", "provider": "anthropic",
  "model": "claude-haiku-4-5-20251001", "latencyMs": 1240,
  "tokens": { "in": 3, "out": 121, "cacheRead": 10198, "cacheWrite": 1264 },
  "estimatedCostUsd": 0.0021,
  "fallback": { "fired": false, "from": null },
  "outcome": "succeeded", "failure_reason": null,
  "context_tokens": 11465,
  "source": "agent", "executor": "openclaw",
  "correlation_id": "..."
}
```

`source` and `executor` are deliberately two fields. Collapsing them into one
would mean that swapping routers later forces every historical row to be
re-labelled, or that the ledger silently loses the distinction between "the
agent asked" and "OpenClaw answered".

**No prompt text, no completion text, ever.** The ledger answers what it cost
and whether it worked. It is not a transcript, and a file that quietly became
one would be a privacy regression on a machine that holds health and financial
data.

Agent-path rows are derived from OpenClaw's own session records rather than by
intercepting its calls — that keeps the "no second inference path" promise
literal. Swift and TTS rows are written by those surfaces directly.

## Test-gated slices

1. **Contract schema and reference validator.** JSON Schema, Python validator,
   strict decoding, drift test against the schema. No live effect.
2. **Ledger schema and writer.** Same shape, plus a redaction test that fails if
   any prompt-shaped field can reach a row.
3. **Drift check against live config.** A script that reads
   `~/.openclaw/openclaw.json` and the contract and reports disagreement.
   Read-only first; applying comes later and separately.
4. **Agent-path telemetry.** Normalize OpenClaw session records into ledger rows,
   including the four fields it does not record: latency, real cost, failure
   reason, fallback usage.
5. **Credentials.** Move `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` out of
   plaintext `.env` into Keychain SecretRefs, exactly as Phase 0 did for the
   other three. This is the one requirement currently answered "false".
6. **Swift surfaces.** `LocalModel` and `DeepgramSpeech` resolve their model by
   role. **Build only — do not install without asking.** A new binary costs Nick
   roughly fifteen Keychain dialogs (AGENTS.md, measured 2026-08-18), and that
   is his call to spend, not mine.
7. **TTS surface.** The daemon resolves its engine by role and writes ledger rows.

Each slice: contract test, failure test, and regression test before it counts.

## Exit criteria

Phase 2 is complete only when:

- every one of the five surfaces resolves its model through the contract, with
  no model name hardcoded outside it;
- the six tracked fields — model, tokens, latency, estimated cost, failure
  reason, fallback usage — are present on real rows for the agent path, and on
  the Swift and TTS paths once those ship;
- no provider credential is readable in plaintext on disk;
- a provider can be swapped by editing the contract alone, demonstrated once;
- the full Python, plugin, and native suites pass, and a live authenticated smoke
  still produces an unchanged user-visible result and durable ledger row;
- the whole phase can be disabled without data migration.

An empty contract file with all seven roles declared is not evidence. A role is
routed when a real inference lands a real row.

## Required checks per slice

```bash
uv run python -m unittest discover -s tests -q
uv run python scripts/orion_v2_phase_gate.py --phase 1 --require-open
uv run python scripts/orion_v2_authority_snapshot.py --check
uv run python scripts/orion_v2_secret_inventory.py --check
uv run python scripts/orion_v2_secret_scan.py --root . --history \
  --allowlist planning/v2/secret-scan-allowlist.json
```

Slices touching the plugin, live config, or the app additionally require the
ORION Control suite and compile, the native domain suite, `scripts/orion-doctor`,
and an authenticated live smoke.

## Costs and risks, stated up front

- **Slice 6 costs Nick ~15 Keychain dialogs** if the rebuilt app is installed.
  Build and verify without installing; let him choose the moment.
- **Slice 5 touches live credentials.** Phase 0's migration is the template, and
  its rule holds: verify the new value works before removing the old one.
- Slice 3 reads live config; applying to it is a separate reviewed step.
- The signing identity does not change. No certificate is regenerated.

## Scope raised that this manifest does not cover

Nick raised **texting** and **smart home** on 2026-08-20. Neither appears
anywhere in the manifest's 85 phases; the nearest is PHASE 65, App Intents and
System Integration. Texting is already partly live, ahead of the document
(`enableMessagesReadActions` / `enableMessagesSendActions`, and
`scripts/orion-messages-send`).

**Neither is a model role, so neither belongs in Phase 2.** They are tool
capabilities — which *hands* act, not which *brain* answers. Routing them
through the ModelRouter would be a category error.

Both are registered in `PHASE_GATES.json` under `scopeNotInManifest`, with the
same discipline as `pendingGateAmendments`: record it rather than either
refusing it or quietly building outside the requirements source. Smart home in
particular will need its own capability tier with approval gating — a device
that unlocks a door or heats a room is consequential in a way that reading a
calendar is not.
