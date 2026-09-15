---
title: OpenClaw Workspace and Memory
note_type: resource
status: seed
source_type: official-docs-synthesis
sources:
  - https://docs.openclaw.ai/concepts/agent-workspace
license_notes: OpenClaw repository MIT; concise original synthesis.
created: 2026-07-29
updated: 2026-07-29
tags: [openclaw, workspace, memory]
---

# OpenClaw Workspace and Memory

An OpenClaw workspace contains agent-facing instructions and skills. Those
files shape behavior, but they do not by themselves create OS permissions or
tool authority.

Keep four stores conceptually separate:

- Workspace instructions: identity and operating guidance.
- Skills: reusable procedures.
- Durable TaskGraph state: active steps, approvals, attempts, and outcomes.
- Orion Brain: curated knowledge with provenance.

This separation prevents a retrieved note or learned procedure from silently
changing authorization. See [[50 Concepts/Knowledge versus Task State]].
