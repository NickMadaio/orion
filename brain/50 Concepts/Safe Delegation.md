---
title: Safe Delegation
note_type: concept
status: active
source_type: official-docs-and-original-synthesis
sources:
  - https://docs.openclaw.ai/tools/subagents
  - https://docs.openclaw.ai/concepts/session-tool
license_notes: OpenClaw repository MIT; concise original synthesis.
created: 2026-07-29
updated: 2026-07-29
tags: [delegation, authority, verification]
---

# Safe Delegation

Delegation separates work, not responsibility.

## Delegate

Provide a bounded objective, minimum necessary context, allowed tools and
data, privacy and cost limits, prohibited actions, expected artifact, and stop
conditions. Never imply that the delegate inherits the coordinator's
permissions.

## Review

Treat returned claims and artifacts as untrusted evidence. Check scope,
sources, policy compliance, conflicts, and completion criteria. Independently
verify important results before integrating them.

## Escalate

A delegate must stop when it needs broader authority, additional private data,
or a materially different goal. The coordinator cannot silently approve that
expansion merely because delegation has already begun.
