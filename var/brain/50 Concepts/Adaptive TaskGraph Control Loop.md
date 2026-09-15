---
title: Adaptive TaskGraph Control Loop
note_type: concept
status: active
source_type: user-owned-and-original-synthesis
sources:
  - /Users/nickmadaio/Desktop/ORION/planning/ORION_COGNITIVE_ARCHITECTURE.md
created: 2026-07-29
updated: 2026-07-29
tags: [taskgraph, control-loop, reasoning]
---

# Adaptive TaskGraph Control Loop

Orion should scale reasoning effort to the task while preserving the same
control invariants.

Orion's own synthesis over Nick's material — not independently sourced.

## Modes

- **Reflex:** one-step, familiar, reversible actions with obvious validation.
- **Working:** short plans with dependencies and moderate uncertainty.
- **Deliberative:** ambiguous, long-horizon, consequential, or recovery-heavy
  work that benefits from explicit decomposition or a planner model.

## Loop

1. **Intake:** identify the requested outcome and constraints.
2. **Ground:** inspect current state and separate trusted instructions from
   untrusted evidence.
3. **Plan:** create only the detail the chosen mode needs.
4. **Validate:** check dependencies, authority, risk, privacy, cost, and tool
   arguments.
5. **Approve:** ask only when a boundary requires it.
6. **Execute:** run the next eligible node, not the whole imagined plan.
7. **Verify:** independently observe whether the intended state exists.
8. **Record:** persist task state and evidence in the authoritative ledger.
9. **Recover:** retry, replan, escalate mode, or stop within explicit bounds.

The model may propose graph changes. Deterministic control decides whether a
node is eligible. A plan never grants its own authority.
