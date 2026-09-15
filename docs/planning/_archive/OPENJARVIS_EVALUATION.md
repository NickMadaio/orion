# OpenJarvis — Evaluation for ORION

**Date:** 2026-07-30
**Question asked:** what, if anything, in the open-source OpenJarvis project is worth adopting into ORION?
**Short answer:** four ideas, none of them large. The framework as a whole is a *replacement* for what ORION already is, not an upgrade to it — and its permission model is materially weaker than `orion-control`. Do not install it on the Mac you are about to hand ORION.

---

## 1. What the project is

**Repository:** https://github.com/open-jarvis/OpenJarvis
**Docs:** https://open-jarvis.github.io/OpenJarvis/
**Project page:** https://scalingintelligence.stanford.edu/blogs/openjarvis/
**Paper:** arXiv:2605.17172
**Licence:** Apache 2.0
**Authors:** Jon Saad-Falcon, Avanika Narayan, Herumb Shandilya, Robby Manihani, Gabriel Bo, John Hennessy, Christopher Ré, Azalia Mirhoseini, et al. — Stanford Hazy Research and the Scaling Intelligence Lab (SAIL).
**Status:** v1.0 released, desktop builds through `desktop-v1.0.2`, PRs merging through at least May 2026. Actively maintained.

### Confidence this is the right project: high

Reasons, since you asked me to be careful about the name:

- The task described "a local-first on-device assistant framework with tools, memory, and learning." That is almost verbatim the framing this project uses for itself ("A Local-First Framework for On-Device Personal AI Agents with Tools, Memory, and Learning"). The match is not a coincidence.
- It is the only project called OpenJarvis with institutional backing, a paper, a docs site, a PyPI package, desktop installers, and ongoing PR traffic. Everything else in that name space is a toy.
- **One namesake to be aware of:** `fedcal.github.io/open-jarvis` surfaced in search as "Iron Man-style open-source personal AI assistant." It is a different, unrelated project. If you go looking, make sure you are on `github.com/open-jarvis/OpenJarvis`.

### What it actually is, architecturally

Five primitives:

| Primitive | What it covers |
|---|---|
| **Intelligence** | Model catalog abstraction over local model families (Qwen, GPT-OSS, Gemma, Granite, GLM, Kimi) |
| **Engine** | Inference backends — Ollama, vLLM, SGLang, llama.cpp, Apple FM, Exo, Nexa, Uzu; plus 5 cloud engines |
| **Agents** | 8 built-in agents across on-demand / scheduled / continuous modes (orchestrator, ReAct, CodeAct, deep-research, monitor, operative, morning-digest, simple) |
| **Tools & Memory** | ~30 tools, MCP client, A2A, semantic indexing, 25+ data sources, 26–32 messaging channels |
| **Learning** | Trace-driven optimisation of model weights (SFT/LoRA/GRPO/DPO), prompts (DSPy), agent logic (GEPA), and engine config |

Plus a Rust extension (PyO3) that backs several hot paths, and energy telemetry (NVML / AMD / `powermetrics` on Apple Silicon at 50 ms sampling) with `jarvis bench`.

The research contribution is real and interesting: efficiency as a first-class eval target, and a closed loop that improves a local system from its own traces. That is a genuine gap in the ecosystem. **It is not, however, the gap ORION has.**

---

## 2. Capability-by-capability against ORION

### 2.1 The Mac body — ORION wins, not close

This is the comparison that matters most, so it goes first.

OpenJarvis's system-access story, quoted from **its own documentation** (`user-guide/system-access/`):

> `shell_exec` runs arbitrary commands as your user. There is no command allowlist, no denylist, and no sandbox unless you turn one on. An agent holding this tool can do anything you can do from a terminal.

And on its sensitive-filename protection:

> It matches on the filename only, not the path or the contents, and only those two tools consult it. `shell_exec`, `apply_patch` and `code_interpreter` skip it entirely, so `cat ~/.ssh/id_rsa` through `shell_exec` works fine. Treat it as protection against fat fingers, not as a security boundary.

Compare `orion-control` at its current Tier 1, per `CAPABILITY_TIERS.md`: the single enabled real action, `test_marker_create`, takes **no caller-supplied path**, derives its destination beneath a configured root, refuses to follow symlinks, refuses non-identical overwrite, treats identical content as `already_present`, independently reads the file back before reporting success, and records validation, attempts, idempotency key, execution mode and verification evidence in an append-only JSONL ledger. Everything else in the catalog is simulation-only. Adding an action to the catalog does not enable it — code, tests, config, active permission profile, and tool policy must all separately opt in.

These are not the same category of thing. OpenJarvis has a shell. ORION has a gate.

For macOS specifically, OpenJarvis has **no computer use at all** — its docs state plainly that it cannot see the screen, move the pointer, or send keystrokes, that no input-automation library appears in the codebase, and that granting Accessibility or Screen Recording "buys you nothing on its own." Its Mac control story is `osascript` through `shell_exec`. ORION's native `Orion.app` + `orion-control` body is strictly ahead here.

**Verdict: ORION has something substantially better. Take nothing from this layer.**

### 2.2 Permission model

| | OpenJarvis | ORION |
|---|---|---|
| Default posture | Fail-open (`CapabilityPolicy(default_deny=False)`, and no config key exposes the flag) | Deny-by-default, tier-gated |
| Granularity | Tool-level capability strings (`file:read`, `code:execute`, …) | Per-action catalog entries with typed validators |
| Confirmation | Depends on entry point: `jarvis chat` prompts; `jarvis ask`, the HTTP server and the desktop app **auto-approve** | Uniform gate regardless of caller |
| Trust source | Config file | Harness provenance the model cannot forge |
| Verification | None | Independent post-execution read-back |
| Audit | SQLite table of *security scan events* only | Append-only JSONL of proposal → validation → attempt → verification |

One detail worth internalising as a lesson: OpenJarvis's config loader **accepts** `security.enforce_tool_confirmation`, but its own docs note that "nothing on the tool execution path reads it. Setting it won't change confirmation behaviour anywhere." A security control that silently does nothing is worse than no control, because it manufactures false confidence. Worth grepping your own config surface for the same failure mode.

**Verdict: ORION is ahead on every row. Do not adopt this model.**

### 2.3 Memory — mixed, and the honest answer is "each is better at a different thing"

ORION's `orion/memory.py` + `store.py`: categorised (`preference`, `person`, `project`, `decision`, `goal`, `temporary`, `outcome`), attributed with `source` / `confidence` / `relevance`, mirrored to a human-readable Markdown vault. That is a *curation and provenance* model, and it is better than OpenJarvis's, which stores opaque documents with a metadata dict.

But ORION's retrieval is:

```sql
SELECT ... FROM memories WHERE content LIKE ? ORDER BY relevance DESC, updated_at DESC LIMIT ?
```

— substring match, plus a term-splitting pass in `MemoryManager.relevant()` that keeps tokens of length ≥ 4. That will not find "what did I decide about the thesis proposal" if the memory says "dissertation outline." There is also no document ingestion: you cannot point ORION at a folder of PDFs or lecture notes.

OpenJarvis has the conventional stack done competently: `MemoryBackend` ABC over SQLite/FTS5 (default, persistent, BM25-ranked), FAISS, ColBERTv2, BM25, and a Hybrid backend doing Reciprocal Rank Fusion; paragraph-aware chunking with overlap; `ingest_path()` with file-type detection including PDF; context injection with source attribution.

Note one asymmetry in its favour and one against: its FAISS, ColBERT and BM25 backends are **in-memory only — data is lost on restart**. Only the SQLite/FTS5 default persists. So the impressive-sounding options are the least production-ready ones.

**Verdict: genuine partial gap. Take the retrieval mechanics, keep ORION's attribution model.**

### 2.4 Runtime, agent loop, channels, connectors

Commodity, exactly as the prior audit concluded. OpenJarvis has more connectors (25+ sources, 26–32 channels) and more prebuilt agents. ORION sits on OpenClaw, which OpenJarvis itself treats as an ecosystem to *import from* — its skills system pulls ~13,700 community skills from the OpenClaw skills repo. You are upstream of its skill supply, not downstream.

**Verdict: nothing to take.**

### 2.5 Voice and interface

OpenJarvis: Kokoro TTS inside the `morning_digest` agent; CLI, browser webchat dashboard, Tauri desktop app.

ORION: MLX TTS daemon over a unix socket with NDJSON, sentence-chunked streaming and barge-in cancel; native SwiftUI menu-bar app with a non-activating floating panel, global Right-Option push-to-talk, on-device `SFSpeechRecognizer`.

**Verdict: ORION is well ahead. Nothing to take.**

### 2.6 Learning loop

The most novel part of the project and the one I'd most expect a student to want. `jarvis optimize` runs trace-driven improvement across weights (SFT, LoRA, GRPO, DPO), prompts (DSPy), agent logic (GEPA), and engine tuning.

It is a real gap — ORION has no self-improvement loop. But see §4; I am recommending against it, and the reason is a security argument, not an effort argument.

### 2.7 Energy / efficiency telemetry

`powermetrics`-based sampling at 50 ms, per-query energy and FLOPs and cost, `jarvis bench`, a dashboard. ORION tracks turn latency (~1.3 s) but not energy or cost.

**Verdict: small genuine gap, low value. Nice for a report or a class project; does not move the Jarvis goal.**

### 2.8 The security module — the interesting part

Undocumented in the user guide but present in the source tree: `taint.py`, `injection_scanner.py`, `capabilities.py`, `boundary.py`, `credential_stripper.py`, `signing.py`, `ssrf.py`, `subprocess_sandbox.py`, `severity_policy.py`, `rate_limiter.py`, plus a `sandbox/` package with `wasm_runner.py` and `mount_security.py`.

Two of these contain ideas ORION genuinely lacks. See §3.

---

## 3. Worth adopting — ranked

### #1 — Taint tracking / information-flow control
**Source:** `src/openjarvis/security/taint.py` (~130 lines)
**Effort:** 1–2 days
**Why it's the top pick:** it is *orthogonal* to what `orion-control` does, not overlapping. Your gate answers "may this action run?" Taint tracking answers a question you currently do not ask at all: **"where is this data allowed to go?"**

The model: data carries an immutable `TaintSet` of labels (`PII`, `SECRET`, `USER_PRIVATE`, `EXTERNAL`). A `SINK_POLICY` dict declares which labels may not reach which tools. Taint propagates through tool chains — `propagate_taint()` returns the union of the input taint and whatever is auto-detected in the output text.

```python
SINK_POLICY = {
    "web_search": {TaintLabel.PII, TaintLabel.SECRET},
    "channel_send": {TaintLabel.SECRET},
    "code_interpreter": {TaintLabel.SECRET},
}
```

Concretely for ORION: once you wire in Gmail, this stops the shape of bug where content read from an email is later handed to a web search or an outbound message. Your gate would happily approve both steps individually — each is a permitted action — and the leak happens in the composition. Taint is what catches composition bugs.

**Take the idea, not the file.** Honest caveats about the implementation:
- `declassify(taint, remove, reason)` accepts a `reason` and **throws it away**. The docstring admits it: "The *reason* is not stored on the TaintSet itself but should be logged externally for accountability." For ORION, declassification must be a ledger event. That is the whole point of your architecture.
- `SINK_POLICY` is a hardcoded three-entry dict. Yours should be catalog-driven, alongside the action definitions.
- `auto_detect_taint()` is regex-only and will both miss and over-fire. Treat detection as a *floor*; label at the source (anything from Gmail is `EXTERNAL` + `USER_PRIVATE` by construction) rather than relying on pattern-matching the content.

### #2 — Deferred approval queue with pattern-keyed permission memory
**Source:** `src/openjarvis/tools/approval_store.py`
**Effort:** 2–4 days
**Why:** `orion-control`'s gate is synchronous — propose, validate, execute, verify, all in one turn with you present. That is correct for the interactive case and useless for the proactive one. When ORION eventually runs scheduled work (morning digest, mail triage) you are not at the keyboard, and the only two options a synchronous gate offers are "block forever" or "auto-approve," both bad.

The design worth stealing has three parts:

1. **A durable pending queue.** Actions are proposed, persisted, and wait for an out-of-band decision. `queue_action(...)` with a `ttl_hours` default of 24, and `expire_stale()` marking past-TTL proposals `expired`. Proposals go stale rather than lingering — an approval you grant tomorrow should not execute a decision made about yesterday's inbox.
2. **Risk tiers** — `trivial` / `low` / `medium` / `high` — governing default ask behaviour, which maps naturally onto your existing capability tiers.
3. **Permission memory keyed by a semantic fingerprint, not a literal command.** This is the genuinely clever bit:
   ```
   "email_delete:domain:noreply.github.com"
   "sms_draft_reply:contact:+15551234567"
   ```
   You approve a *class* of action once. This is how you avoid prompt fatigue without weakening the gate — the alternative everyone reaches for is a blanket "don't ask again," which is how permission systems die.

**Caveat, and it matters:** in OpenJarvis the tier is *advisory metadata*. `TIER_HIGH` is documented as "Always ask, never auto-remember," but `set_permission()` will cheerfully write an `always_approve` rule for any key regardless of tier — enforcement lives in the calling agent, not the store. If you build this, enforce the tier invariant **in the store**, where it cannot be forgotten by a caller. Storing a permission is itself a privileged action and belongs in the ledger.

### #3 — Semantic retrieval over an ingested corpus
**Source:** `architecture/memory/` — chunking, ingestion, hybrid RRF
**Effort:** 2–3 days for a good version
**Why:** this is the gap §2.3 identified, and it is the one that most directly serves "talk to it, get comprehensive answers." Right now ORION cannot answer anything from your coursework, notes, or papers, because it cannot ingest them and its search is `LIKE '%query%'`.

What to take:
- **Paragraph-aware chunking with overlap.** Split on `\n\n`, accumulate to a size budget, carry an overlap window, split oversized paragraphs into fixed windows, discard chunks below a minimum. Defaults 512 / 64 / 50 tokens. This is unglamorous and it is most of the quality.
- **Hybrid retrieval with Reciprocal Rank Fusion**, `RRF(d) = Σ wᵢ / (k + rankᵢ(d))`, `k = 60`, over-fetching `top_k * 3` from each sub-retriever. Combining a sparse retriever with a dense one via RRF is the single best quality-per-line-of-code move in retrieval, and it needs no training.
- **SQLite/FTS5 as the sparse side.** Zero dependencies, persistent, BM25-ranked, and you already have SQLite in `store.py`.

What **not** to take: FAISS / ColBERT as configured — in-memory only, lost on restart, and ColBERT drags in `torch`. Start with FTS5 alone; add a dense side later with a small local embedder if retrieval quality actually proves insufficient.

**Keep ORION's model.** Do not replace `MemoryManager`. ORION's categories, `source`, `confidence`, and Markdown vault mirror are better than anything OpenJarvis has, and they are what make the memory auditable by you. Add ingestion + ranked retrieval *underneath* that model as a second store for documents, distinct from curated memories.

### #4 — Injection scanning at untrusted-content boundaries
**Source:** `src/openjarvis/security/injection_scanner.py`
**Effort:** half a day
**Why:** cheap defence in depth for the moment ORION starts reading email and web pages. Pattern classes worth having: prompt-override ("ignore previous instructions"), identity override, delimiter/chat-template injection (`<|im_start|>`, ` ```system `), exfiltration phrasing, and shell-injection sequences.

**Sharp caveats, and please internalise these rather than just copying the file:**
- A regex list does not stop prompt injection. It stops the laziest 20% and produces a comforting green light for the rest. Its value for ORION is as a *signal to log and to raise the approval tier*, never as a gate. Your actual defence against injection is that the model cannot forge provenance — keep it that way.
- The Python `_INJECTION_PATTERNS` list in that file is **dead code**. `InjectionScanner.__init__` compiles it into `self._patterns`, then `scan()` ignores it entirely and delegates to the Rust implementation ("always via Rust backend"). So the patterns you read in the Python source are not necessarily the patterns that run. If you port from this file, you are porting a list that may have drifted from the enforced one.

### #5 (marginal) — Per-turn energy and cost telemetry
**Effort:** ~1 day. Sample `powermetrics`, attribute energy and marginal cost per turn, surface in `orion-doctor`. Genuinely useful for deciding when the local fallback is good enough to be the default rather than the fallback — which is a decision you will eventually want data for. Not a priority.

---

## 4. Do NOT adopt

### `shell_exec`, `code_interpreter`, `apply_patch`, `docker_shell_exec` — categorically
This is the serious one. Adopting a general shell tool would route around `orion-control` entirely and delete the distinction that makes ORION worth building. Every property in `CAPABILITY_TIERS.md` — no caller-supplied paths, no symlink following, hash-bound replacement, independent verification, ledgered evidence — evaporates the moment a tool exists that can run `mv`. You would not be adding a capability; you would be adding a bypass, and the audit ledger would keep producing confident records of a system that no longer constrains anything.

If you ever want ORION to run shell commands, the answer is a new *catalog action* with a validator and a verifier, gated at its own tier — not a shell tool.

### `GuardrailsEngine` as a security boundary
It is a content scanner that wraps the *inference engine* and looks for secrets and PII in prompts and completions. That is a data-hygiene feature, not an action gate — it sits at the model layer, where ORION's threat model already assumes the model is untrusted. Its own docs concede that in streaming mode "BLOCK mode only applies to the input side" because tokens are delivered before the scan completes. Adopting it risks the worst outcome available: believing you have a boundary where you have a filter.

The `WARN` / `REDACT` / `BLOCK` mode ladder is a decent *UI* idea. The engine wrapper is not a boundary.

### `CapabilityPolicy` as implemented
Constructed with `default_deny=False`, and per the docs no config key exposes that flag, so "an agent with no explicit policy entry gets every capability." Fail-open. ORION is fail-closed. Importing this would be a regression dressed as an RBAC upgrade. The *vocabulary* (`file:read`, `code:execute`, resource glob patterns) is fine to borrow; the policy engine is not.

### The Learning loop
This is the one I expect you'll most want, so here is the actual reasoning rather than just a no.

ORION's security model rests on a specific claim: **the model is untrusted, and trust is minted from harness provenance the model cannot forge.** A learning loop inverts part of that. If local traces adapt weights, prompts, or agent logic, then anything that can influence traces can influence ORION's future behaviour. Once ORION reads email and browses, an attacker gets a slow, low-bandwidth, *persistent* channel into the system's disposition — and unlike a prompt injection, it does not have to win in a single turn and it survives restarts. Poisoned adaptation is much harder to detect and audit than a rejected action, because there is no discrete event to log.

You could build this safely — trace provenance labelling, a human-reviewed promotion step, ledgered weight/prompt transitions, reproducible rollback. That is a serious research project on top of a system that does not yet have a second real catalog action enabled. Revisit when the body is finished. Not now.

### Installing or running OpenJarvis on your Mac
See §6. Read the source; do not run the system.

### Auto-importing the skills catalogs
~150 skills from Hermes plus ~13,700 community skills from the OpenClaw repo. Its trust tiers (`bundled` > `workspace` > `indexed` > `unreviewed`) are the right *shape* — provenance-based, which is your own instinct — but `has_dangerous_capabilities()` checks `manifest.required_capabilities`, which is **self-declared by the skill**. A skill that wants to do something dangerous simply does not declare it. Provenance-based trust only works when the provenance is attested by something the untrusted party cannot control, which is exactly the property `orion-control` gets right and this does not.

### Its agent loop, orchestrator, channels, and connectors
Commodity, per the prior audit. You are already on OpenClaw, which is upstream of OpenJarvis's own skill supply.

### `file_policy` sensitive-filename globs
Fine as a fat-finger guard, as its own docs say. Not a boundary — filename-only matching, consulted by exactly two tools. If you add it, do not let it appear in any document that describes ORION's security properties.

---

## 5. Licence notes

**OpenJarvis is Apache License 2.0** (`LICENSE`, "Copyright 2025 The OpenJarvis Authors"). Permissive, OSI-approved, **not viral**, no copyleft. Compatible with a personal project with no meaningful friction. Nothing here is AGPL, SSPL, BSL, or "source-available."

What Apache 2.0 asks of you, in practice:

- **Using it privately / not redistributing:** essentially no obligations. This is your situation today.
- **If you copy code into ORION and ever publish ORION:** retain the Apache licence text and any `NOTICE` content, keep copyright/attribution notices on the copied source, and **add a prominent note to any file you modified** stating you changed it. The clean pattern is one `third_party/` or a per-file header — e.g. a `taint.py` derived from theirs gets a header naming the origin and the Apache 2.0 licence.
- **If you only take the *idea*** — a taint label set, an RRF formula, a tier vocabulary — reimplemented in your own code, there is no licensing obligation at all. Ideas and algorithms are not copyrightable. For recommendations #1, #2 and #4 I am explicitly suggesting you reimplement rather than copy, which sidesteps the question entirely.
- **Patent grant:** Apache 2.0 includes an express patent licence from contributors, which is a plus over MIT/BSD. It terminates if you sue a contributor for patent infringement over the work. Irrelevant to you.
- **Trademark:** the licence does not grant rights to the "OpenJarvis" name. Don't call anything OpenJarvis.

**Transitive dependencies** — only relevant if you adopt modules wholesale rather than ideas: `faiss` (MIT), `colbert-ai` (MIT), `torch` (BSD-3), `rank_bm25` (Apache 2.0), `sentence-transformers` (Apache 2.0). All permissive. But since I'm recommending SQLite/FTS5 for the sparse side and nothing dense to start, you take on zero new dependencies for recommendation #3.

**Nothing flagged as restrictive.** Licence is a non-issue here.

---

## 6. Security notes

### Published vulnerabilities
I searched and found **no published CVE or security advisory specific to OpenJarvis.** Note the epistemics: that is absence of evidence, not evidence of absence. The project is roughly five months old publicly, and a young research framework with low deployment count is not a well-audited one. Do not read "no CVEs" as "safe."

I could not fetch the GitHub API for issue/advisory counts — the request returned empty. Not routed around, per constraints; flagging the gap.

### The real concerns are design choices, documented by the project itself

These are not bugs someone found. They are how the system ships:

1. **`shell_exec` is unconstrained by default** — "no command allowlist, no denylist, and no sandbox unless you turn one on."
2. **Confirmation silently depends on entry point.** `jarvis chat` prompts. `jarvis ask`, `jarvis agent ask`, the HTTP server and the desktop app all **auto-approve**, and "tools you added to an agent's toolkit count as pre-approved." The user-facing GUI is the *least* protected path.
3. **`security.enforce_tool_confirmation` is a dead config key.** Accepted by the loader, read by nothing. A user who sets it believes they hardened the system and did not.
4. **`allowed_dirs` is never populated by any config key**, and empty means every path is allowed.
5. **`CapabilityPolicy` is fail-open** (`default_deny=False`, flag not exposed).
6. **Sandboxing is off by default.** Both container isolation and capabilities require explicit opt-in.
7. **The sensitive-filename list is bypassed by the tools that matter** — `shell_exec`, `apply_patch`, `code_interpreter` all skip it.
8. **Streaming output cannot be blocked.** Tokens reach the caller before the scan runs.
9. **Install path is `curl -fsSL … | bash`**, which executes a remote script with your privileges, and "the Rust extension and bigger models continue downloading in the background" after install.
10. **macOS guidance is to grant Full Disk Access to the host process** (your terminal, `OpenJarvis.app`, or `/usr/local/bin/jarvis` for the launchd daemon), and child processes inherit it. Combined with (1) and (2): an unconstrained shell inside a Full Disk Access context, auto-approving by default in the GUI.
11. **Skill trust tiers rest on self-declared manifests** (§4).

### A concrete bug I found in `src/openjarvis/tools/shell_exec.py`

`ShellExecTool.execute()` carefully builds a sanitised environment (`PATH`, `HOME`, `USER`, `LANG`, `TERM` only) and clamps the timeout to 300 s max — and then, *before* using either, tries the Rust fast path first:

```python
_rust = get_rust_module()
output = _rust.ShellExecTool().execute(command, working_dir)
return ToolResult(
    tool_name="shell_exec",
    content=output or "(no output)",
    success=True,
    metadata={"returncode": 0, "timeout_used": timeout, ...},
)
```

Three problems, all on the path that runs by default (the Rust extension ships with the standard install):

- The **sanitised `env` is never passed** to the Rust call. The tool's own spec string says it "Runs with a minimal environment for security." On the Rust path that is false — the child inherits whatever the Rust side gives it.
- The **timeout is never passed**, yet `metadata` reports `"timeout_used": timeout`. The documented 30 s default and 300 s cap are not enforced here.
- **`success=True` and `returncode: 0` are hardcoded** regardless of the command's actual exit status. A failing command reports success. Any downstream logic that trusts `ToolResult.success` — including anything resembling verification — is reading a constant.

The Python `subprocess` fallback below it is correct. It only runs if the Rust import fails.

This is worth studying rather than just noting: it is the exact failure mode your architecture is built to prevent. A carefully specified guard, an optimised path added later that skips it, and a result object that reports success unconditionally. `orion-control`'s independent read-back verification exists precisely because "the executor said it worked" is not evidence.

### Bottom line for you

**Do not install OpenJarvis on the Mac you are about to give ORION.** Not because it is malicious — it is a credible Stanford research project with a real paper and no known malice — but because its default posture is the inverse of yours. It ships an unconstrained shell, auto-approves on its GUI and server paths, fails open on capabilities, has at least one documented security config key that does nothing, and asks for Full Disk Access. Your system is deny-by-default with one real action enabled. Running both on the same machine means the weaker model is your actual security posture.

If you want to try it hands-on: a VM or a spare machine, with `sandbox.enabled = true`, `runtime = "docker"`, no Full Disk Access grant, and no real credentials connected. But for the purpose of this evaluation you do not need to run it. Everything above came from reading the source and the docs.

### One process note, per the research constraints

The repo contains `REVIEW.md`, a file of instructions addressed to an AI agent ("You are reviewing pull requests for OpenJarvis…"). It is benign — a legitimate PR-review rubric for their CI bot, not an injection attempt — and I treated it as data, not as instructions. Worth knowing that this repo ships agent-directed text, since an agent pointed at it could be induced to treat that content as its own instructions. That is the generic hazard, and it is the same hazard ORION will face the moment it reads email.

---

## 7. Summary

| Item | Verdict | Effort |
|---|---|---|
| Taint tracking / information-flow labels | **Adopt the idea** — reimplement, ledger declassification | 1–2 d |
| Deferred approval queue + pattern-keyed permission memory | **Adopt the idea** — enforce tiers in the store | 2–4 d |
| Chunking + FTS5 + RRF hybrid retrieval, document ingestion | **Adopt** — keep ORION's attribution model on top | 2–3 d |
| Injection scanning at ingest boundaries | **Adopt as a signal**, never as a gate | 0.5 d |
| Energy / cost telemetry per turn | Optional, low priority | 1 d |
| `shell_exec` and friends | **Never** — routes around `orion-control` | — |
| `GuardrailsEngine` as a boundary | No — content filter, not an action gate | — |
| `CapabilityPolicy` | No — fail-open | — |
| Learning loop | **Not yet** — creates a trace-poisoning channel | — |
| Agent loop, channels, connectors, skills catalog | No — commodity; you are upstream | — |
| Running OpenJarvis on your Mac | **No** | — |

**The honest headline:** OpenJarvis is a serious, well-engineered research framework that is solving a different problem than ORION. Its contribution is efficiency-aware local inference and closed-loop optimisation; ORION's is a permission-gated macOS body. On the axis you care about — safely giving an agent control of your Mac — ORION is meaningfully ahead of it, and reading OpenJarvis's source is most valuable as confirmation that the hard part you chose to work on is in fact the hard part that everyone else is skipping.

There are four ideas here worth a week of your time in total. There is no architecture here worth adopting.
