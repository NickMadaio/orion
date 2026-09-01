# ORION v2 Phase 7 — Build the Event System

Status: **planned — 2026-08-24**. Phase 6 closed the same day.

## What the manifest asks for

A versioned internal event envelope with nine fields; event types across eleven
categories; producers kept separate from consumers; and unrelated systems not
directly coupled.

## The requirement that is not a data structure

Eight of the nine fields are a morning's work. The requirement with teeth is the
last one — *do not directly couple unrelated systems* — and it is a property of
how the code is wired, not of any record. A bus can carry a perfectly versioned
envelope and still be the mechanism by which the health subsystem ends up
driving the email subsystem.

Three ways that coupling actually happens, and what stops each here:

| How it happens | What prevents it |
|---|---|
| a producer calls a consumer directly | `publish()` takes an envelope and no target; there is no API that names a consumer |
| a consumer reaches back into a producer | handlers receive an envelope and nothing else |
| a consumer publishes mid-handling, so A's event silently triggers C | re-entrant `publish()` raises; handlers **return** follow-up events, which the bus delivers in a bounded second pass |

And then the one that survives all three: a handler in one category legitimately
returning an event in another. That is not a bug — a completed task should be
able to raise a notification — so it is governed rather than banned, by a
**default-deny cascade matrix** in the shape Phase 3 already established for
context domains. Each allowance names the reason it exists. A pair nobody wrote
down does not fire.

## Design

```
categories.py   the manifest's eleven, with default sensitivity per category
envelope.py     the nine fields, strict, and a payload that refuses credentials
types.py        registered event types, each with a version
coupling.py     which category may cascade into which, and why
bus.py          publish / subscribe, isolation, bounded follow-ups
```

### The bus refuses credentials rather than redacting them

Phase 6 redacts, because an audit record must be written even when something in
it should not be. An event is different: it is data moving between subsystems,
and a payload carrying a credential is a **defect at the producer**, not an
unavoidable fact. So the envelope raises. Redaction there would let the defect
ship quietly and turn up later as a missing field nobody can explain.

The Phase 6 credential shapes are reused, so there is one answer in the codebase
to "what does a credential look like".

### Versioned means refused when unregistered

An envelope whose `(event_type, version)` pair is not in the registry does not
publish. A version field that nothing checks is decoration; this one is the
reason a consumer can say which versions it accepts and be believed.

### Delivery is deterministic and isolated

Subscribers are called in registration order. A subscriber that raises does not
stop the others and does not fail the publisher — the failure is collected and
returned in the delivery report. An event system whose publisher dies because
some unrelated consumer threw is a coupling mechanism wearing a bus's clothes.

## No drift-check script this time

Phases 2, 4, 5 and 6 each carry one because each has a live counterpart that can
disagree with the contract. The event system has no live counterpart yet; a
script that checked this against nothing would be ceremony. The tests are the
evidence, and Phase 8's job system will be the first consumer.

## Exit criteria

- Nine fields, strictly decoded, with unknown and missing keys both refused.
- Eleven categories, each with at least one registered, versioned event type.
- An unregistered type or version cannot be published.
- A payload containing a credential shape is refused, not redacted.
- No API by which a producer can name a consumer, or a consumer a producer.
- Re-entrant publishing raises; follow-ups are returned, bounded, and governed by
  a default-deny matrix whose every allowance carries a reason.
- A failing subscriber affects neither the publisher nor the other subscribers.
- Suites green.
