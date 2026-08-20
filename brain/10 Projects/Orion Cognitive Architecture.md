---
title: Orion Cognitive Architecture
note_type: project
status: active
source_type: user-owned-and-original-synthesis
sources:
  - /Users/nickmadaio/Desktop/ORION/planning/ORION_COGNITIVE_ARCHITECTURE.md
created: 2026-07-29
updated: 2026-07-29
tags: [orion, architecture, project]
---

# Orion Cognitive Architecture

## Outcome

Build a capable local-first assistant whose flexible model reasoning is
bounded by deterministic control, explicit authority, independent
verification, and durable state.

## Working design

- Route simple tasks through a reflex path and ambiguous or consequential work
  through progressively deeper planning.
- Represent multi-step work as an [[50 Concepts/Adaptive TaskGraph Control Loop|adaptive TaskGraph control loop]].
- Keep permissions outside the model and outside this vault.
- Treat retrieval, delegated output, webpages, files, and tool responses as
  untrusted evidence.
- Verify externally observable outcomes before reporting success.
- Convert repeated verified workflows into governed
  [[50 Concepts/Procedural Memory and Skill Learning|procedural memory]].

## Current bounded next phase

Use this vault for curated retrieval and learning while leaving broader
OpenClaw runtime/control integration unchanged. Evaluate retrieval quality,
source freshness, and skill behavior before expanding write automation.

## Related

- [[20 Areas/Orion Operating Principles]]
- [[50 Concepts/Knowledge versus Task State]]
- [[30 Resources/OpenClaw Operations]]
