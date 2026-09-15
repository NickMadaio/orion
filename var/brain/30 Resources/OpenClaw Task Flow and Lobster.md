---
title: OpenClaw Task Flow and Lobster
note_type: resource
status: seed
source_type: official-docs-synthesis
sources:
  - https://docs.openclaw.ai/automation/taskflow
  - https://docs.openclaw.ai/tools/lobster
license_notes: OpenClaw repository MIT; concise original synthesis.
created: 2026-07-29
updated: 2026-07-29
tags: [openclaw, taskflow, lobster, workflow]
---

# OpenClaw Task Flow and Lobster

OpenClaw's workflow surfaces are useful for deterministic orchestration:
explicit steps, dependencies, state transitions, and resumable operations.
Orion's cognitive layer should compile intent into similarly inspectable work
rather than relying on a single unconstrained model turn.

Good workflow nodes have:

- a clear purpose and bounded inputs,
- declared dependencies and authority requirements,
- an idempotency strategy where practical,
- an expected observation,
- an independent verification condition,
- explicit recovery and stop behavior.

See [[50 Concepts/Bounded Recovery and Idempotency]].
