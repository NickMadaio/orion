---
name: "calendar"
description: "Reading and changing Nick's Apple Calendar and Reminders. Use whenever he asks what is on, when he is free, or to add, move or cancel anything."
---

# Calendar

## Reading — do this yourself, always

`orion-agenda` is read-only and allowlisted. Use it before answering ANY
question about his day. Never answer from memory; the calendar changes without
you.

    orion-agenda today
    orion-agenda week

It speaks EventKit through Orion's own bridge, not `accli`. That matters: accli
needs its own macOS Calendar grant that was never given, and for a week Orion
told Nick he had no calendar while the capability sat there unplugged. If a read
fails, say the read failed — do not conclude he has no calendar.

## Changing — through the typed actions, never the shell

Creating, moving or cancelling goes through Orion's typed Calendar actions, which
run the catalog, provenance and approval gates first. `orion-agenda-change`
exists but is DELIBERATELY not on your exec allowlist; calling it directly would
skip those gates, so it is not available to you and should not be sought.

If you cannot find a typed action for what he asked, say so plainly rather than
improvising a route around it.

## What to say

- "Nothing on the calendar today" is a complete answer. Do not pad it.
- Lead with the next thing that actually constrains him, not a list from
  midnight.
- Times in his current zone. He moves; check rather than assume New York.
- A conflict between two required commitments is reported, never resolved
  silently — rearranging his commitments is his call, not yours.
