---
title: OpenClaw Skills and Skill Workshop
note_type: resource
status: seed
source_type: official-docs-synthesis
sources:
  - https://docs.openclaw.ai/tools/skills
  - https://docs.openclaw.ai/tools/skill-workshop
license_notes: OpenClaw repository MIT; concise original synthesis.
created: 2026-07-29
updated: 2026-07-29
tags: [openclaw, skills, learning]
---

# OpenClaw Skills and Skill Workshop

Skills are procedural knowledge: they describe how to perform a class of
tasks. They are not capabilities, permissions, credentials, or approvals.

Skill Workshop provides a governed lifecycle:

1. propose a create or update,
2. inspect content, provenance, support files, hashes, and scanner results,
3. test safe examples and failure paths,
4. apply only after review,
5. retain rollback and lifecycle metadata.

Updates are bound to the current live skill hash so stale drafts cannot
silently overwrite newer work. New learning should remain narrow, versioned,
and evidence-backed.

See [[50 Concepts/Procedural Memory and Skill Learning]].
