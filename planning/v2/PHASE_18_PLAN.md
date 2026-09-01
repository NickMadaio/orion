# ORION v2 Phase 18 — ORION Memory v2

Status: **planned — 2026-08-25**. Phase 17 closed the same day.

## What the manifest asks for

Four memory classes — working, episodic, user, domain. Nine required fields on
every stored memory. **Arbitrary external content must not become durable
memory.** Permanent memory requires stronger conditions: explicit user assertion,
explicit user confirmation, strong repeated evidence, or approved structured
system state. Users can inspect, edit and delete.

## The rule that does the work

"Do not allow arbitrary external content to become durable memory" is the whole
security content of this phase, and it is not a filter on text. It is a rule
about **where a claim came from**, which Phase 3 already recorded: every context
entry carries a `Provenance`, and `EXTERNAL_UNTRUSTED` is the default for
anything nobody classified.

So promotion to a durable class requires *grounds*, and the four the manifest
names are the only ones. Each is checked against the item's provenance rather
than trusted as a label:

| Grounds | What must be true |
|---|---|
| explicit user assertion | provenance is `USER_ASSERTED` — the person said it |
| explicit user confirmation | provenance is `USER_CONFIRMED` — the person was asked and agreed |
| strong repeated evidence | observed at least N times, from a system or device source, never from external content |
| approved structured system state | provenance is `SYSTEM_GENERATED` and the shape is known |

An `ORION_INFERRED` item cannot be promoted on its own — Phase 3 already refused
to call inference authoritative, and "Orion concluded this" becoming a permanent
fact about a person is precisely the failure that rule exists to prevent.

## The four classes are four lifetimes

- **working** — this conversation. Expires in hours, never durable.
- **episodic** — what happened. Durable, but a record of an event rather than a
  claim about the world, so it needs no promotion grounds.
- **user** — facts about the person. The most dangerous class, and the one that
  requires grounds.
- **domain** — knowledge about a subject. Durable, requires grounds, and is not
  about the person.

Expiry is a required field for a reason: a memory with no end is a belief, and an
assistant that accumulates permanent beliefs about somebody from things it
overheard is the thing everybody is afraid of.

## Inspect, edit, delete

`user_editable` is a field, not a policy: an episodic record of what happened is
not something a person should be able to rewrite (it is evidence), while a fact
about them is. Deletion is always available, for every class — the manifest says
delete, not "delete unless we think it is important".

## Exit criteria

- Four classes, nine required fields, strictly decoded.
- Promotion to a durable class requires named grounds, and external content has
  none — asserted per provenance value.
- Inference alone cannot become permanent.
- Repeated evidence needs a threshold and a non-external source.
- Recall is owner-scoped and passes through Phase 3's domain matrix.
- Inspect, edit and delete work, and edit refuses where `user_editable` is false.
- Expired memories stop being recalled.
- Suites green.
