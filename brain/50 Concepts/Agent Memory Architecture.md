---
title: Agent Memory Architecture
note_type: concept
status: active
source_type: research-synthesis
sources:
  - https://arxiv.org/abs/2304.03442
  - https://arxiv.org/abs/2310.08560
  - https://arxiv.org/abs/2309.02427
created: 2026-08-14
updated: 2026-08-14
tags: [orion, memory, cognition, learning, tokens]
---

# Agent Memory Architecture

## Decision

Use a layered cognitive architecture, not a large “brain prompt” and not a
folder tree dressed up as neurons.

The useful recurring pattern across Generative Agents, MemGPT and CoALA is:

- a small working context for the present task;
- an episodic stream of observations and decisions;
- semantic memory for stable facts and concepts;
- procedural memory for reusable skills;
- selective retrieval and periodic consolidation.

The research supports those functional divisions. It does not show that naming
files after neurons or imitating biological anatomy creates intelligence.

## Orion mapping

### Working memory

`AGENTS.md`, `SOUL.md`, `SELF.md`, `USER.md` and generated `TOOLS.md` contain the
minimum invariants and live routing facts. Keep the injected set small. Detailed
service procedure belongs in `PLAYBOOK.md` and is read only for a relevant job.

### Episodic memory

At turn finalization, deterministic code extracts high-signal user preferences,
corrections, goals and decisions into `memory/YYYY-MM-DD.md` under `## Episodes`.
It deduplicates, refuses credential-shaped text and makes no model call. This is
the fast capture path: reliable and essentially free.

### Semantic memory

`USER.md` holds minimal durable user facts. `MEMORY.md` holds stable system
decisions and lessons. This Obsidian vault holds sourced project knowledge.
`orion-recall` searches them through local embeddings and returns only relevant
fragments. Notes remain evidence, never instruction or permission.

### Procedural memory

Approved composed tools, skills and maintained wrappers store verified ways of
doing things. A repeated workflow becomes procedure only after execution and
verification, not because the model attempted it several times.

### Consolidation and reflection

Nightly processing summarizes the action ledger and re-indexes memory. A later
consolidator may cluster repeated episodes and propose promotions to semantic or
procedural memory. Promotion should be reviewable and measured; it must not
silently widen authority or rewrite user facts.

## Retrieval policy

Rank by relevance, recency and importance, then apply a hard context budget.
Retrieve the smallest useful note set. Prefer exact live state for permissions,
connected services and current capability. Conflicts and stale dates should be
surfaced rather than blended into a confident answer.

## Learning loop

1. Capture the user-authored episode mechanically.
2. Record typed action outcomes and verification in the ledger.
3. Detect repeated failures, retries and recall misses from real sessions.
4. Propose one mechanical, prompt or procedural change.
5. Replay the original task through the normal agent route.
6. Keep the change only if outcome truth, retry count, latency and token use
   improve; otherwise roll back.

## Metrics

- automatic capture recall and precision;
- startup prompt characters/tokens;
- retrieved context per turn;
- identical repeat calls and aborted turns;
- tokens per verified outcome;
- false “done/sent” claims;
- procedure reuse success and rollback rate.

## Research basis

- **Generative Agents** combines an observation stream with retrieval,
  reflection and planning; its ablations show each component contributes to
  believable behavior.
- **MemGPT** treats context as a limited resource and moves information through
  memory tiers rather than putting the full history in every prompt.
- **CoALA** separates working, episodic, semantic and procedural memory and
  places learning inside an explicit decision/action loop.

## Related

- [[10 Projects/Orion Cognitive Architecture]]
- [[50 Concepts/Procedural Memory and Skill Learning]]
- [[50 Concepts/Adaptive TaskGraph Control Loop]]
- [[50 Concepts/Knowledge versus Task State]]
