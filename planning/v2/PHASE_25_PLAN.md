# ORION v2 Phase 25 — Calendar Writes

Status: **planned — 2026-08-25**. Phase 24 closed the same day.

## What the manifest asks for

`calendar.events.create` and `calendar.events.update`. Deletion treated
separately as higher risk. Before writes: show a preview, show changed fields,
verify policy, create an audit event. Undo where practical. Start with explicit
approval; allow narrowly delegated permissions later.

## The rule with teeth: what was approved is what is executed

An approval flow that shows a preview and then executes "the write" is the
oldest race there is. Between the person reading a preview and the write going
out, the draft can change — a retry with a different body, a stale object, a
caller that mutates and re-uses. The person approved a 30-minute meeting and a
three-hour one went out under their approval.

So an `Approval` carries a **fingerprint of exactly what was previewed**, and
`execute` recomputes it. A draft that differs by one character no longer matches
and the write is refused. The approval is bound to content, not to an intent.

## An update with no changes is not a write

If a preview can show zero changed fields, then some previews are empty, and a
person who sees a few empty previews learns to approve without reading. An
update whose changed set is empty is refused as a write that would do nothing.

## Deletion is separate because undo is not honest for it

CREATE undoes by deleting what was created. UPDATE undoes by restoring the field
values the preview already recorded. **DELETE does not undo.** Recreating an
event gives it a new id, loses every attendee's response, and re-invites
everybody — which is not an undo, it is a second event that looks like the first
one to nobody except ORION. So deletion is R3 rather than R2, and `undo_for`
returns nothing with that reason attached rather than an inverse that lies.

## Delegation is declared and refused

"Allow narrowly delegated calendar permissions later" is a later. The type
exists so Phase 50 has something to widen, and every delegated grant is refused
here naming the phase that owns it — rather than the capability quietly working
because nobody wrote the check.

## Exit criteria

- Two write capabilities plus deletion as a third at a strictly higher risk.
- A write cannot execute without a preview, a policy decision and an approval.
- The approval fingerprint binds to content: a mutated draft is refused.
- An update with an empty changed set is refused.
- Every write produces an audit event, including refused ones.
- CREATE and UPDATE have undos; DELETE has none, with the reason recorded.
- A delegated grant is refused and names Phase 50.
