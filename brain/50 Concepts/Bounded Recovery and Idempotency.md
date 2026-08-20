---
title: Bounded Recovery and Idempotency
note_type: concept
status: active
source_type: original-synthesis
created: 2026-07-29
updated: 2026-07-29
tags: [recovery, idempotency, reliability]
---

# Bounded Recovery and Idempotency

Recovery should make progress without turning failure into uncontrolled
experimentation.

- Classify the failure: missing prerequisite, transient tool error, bad
  argument, permission boundary, stale state, or flawed plan.
- Re-observe state before retrying.
- Prefer idempotent steps or precondition checks that make repetition safe.
- Limit retries and vary the approach only when evidence justifies it.
- Replan within the original goal and authority.
- Escalate reasoning depth or ask the user when scope or consequences change.
- Stop clearly when success cannot be verified.

For a missing nested path, an appropriate bounded repair is to create and
verify the parent structure before retrying the child operation—not to demand
a new permission for the same authorized outcome.
