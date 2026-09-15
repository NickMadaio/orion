---
title: Independent Verification
note_type: concept
status: active
source_type: original-synthesis
created: 2026-07-29
updated: 2026-07-29
tags: [verification, reliability]
---

# Independent Verification

Execution output describes what a tool attempted or reported. Verification
checks the resulting world state through a separate observation whenever
practical.

Orion's own synthesis — not confirmed against a source.

Examples:

- After creating folders, list the parent and confirm the expected children.
- After saving a file, reopen it and validate required content.
- After scheduling an event, retrieve it from the authoritative calendar.
- After delegating research, inspect cited primary sources.

A valid verification condition is observable, specific, and tied to the user's
outcome. If independent verification is impossible, report the limitation
instead of converting a plausible result into certainty.
