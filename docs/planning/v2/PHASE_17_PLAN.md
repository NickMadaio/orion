# ORION v2 Phase 17 — Conversation and State Sync

Status: **planned — 2026-08-25**. Phase 16 closed the same day.

## What the manifest asks for

Cloud-backed conversation sync across multiple devices: offline reads, queued
offline changes, reconnection, conflict resolution, message ids, ordering,
deduplication. **Do not rely only on local timestamps.** Keep local caching
minimal and encrypted where necessary.

## Why "do not rely only on local timestamps" is the whole design

Two devices with clocks a minute apart will disagree about what came first, and
the disagreement is not detectable from the data — each is internally consistent.
Worse, it is not stable: the same two messages can sort differently on two
devices, so two people looking at the same conversation see different histories.

So ordering is a **Lamport counter**: each device sends a sequence one greater
than the highest it has seen, and ties break on device id and then message id.
Wall-clock time is carried as metadata — it is what a person is shown — and is
never consulted for order.

## The cross-language problem, and the check for it

Phase 16 already implemented this ordering in Swift, in `MobileCore`. Now the
server implements it in Python. **Two implementations of one rule is exactly how
two devices end up disagreeing about history** — the failure this phase exists to
prevent, reintroduced by the phase itself.

So `docs/planning/v2/sync-ordering-vectors.json` holds the cases, and both sides read
it: `orion_v2_sync_check.py` asserts the Python engine orders them one way, and
`MobileCoreCheck` asserts Swift produces the identical order. A change to either
implementation alone fails.

## Conflict resolution that is not last-write-wins

Last-write-wins by timestamp is the thing the manifest forbids wearing a
different hat. Edits carry a `revision`; a higher revision wins; equal revisions
break on device id, deterministically, so every device picks the same winner.
And a conflict is **recorded** rather than silently resolved — a message whose
edit lost should be able to say so, because the person who typed it is going to
notice.

## Offline

- **Reads** come from whatever the client last received, addressed by a cursor.
- **Changes** queue in an outbox, ordered, and are replayed on reconnect. Replay
  is idempotent by message id: the queue may deliver twice and the engine must
  not care, because a queue that guarantees exactly-once delivery does not exist.
- **Reconnection** asks for everything after a cursor, so a device that was away
  for a week does not re-download a year.

## Local caching, minimally

A declared policy rather than a habit: which fields may be cached at all, which
must be encrypted at rest, and how long they live. Message bodies are cached
because a conversation you cannot read offline is not much of a conversation;
approvals and anything credential-shaped are not cached at all.

## Exit criteria

- Ordering is deterministic, uses no wall clock, and is proven identical in
  Python and Swift over shared vectors.
- Ingesting the same message twice changes nothing.
- An offline queue replays in order and is idempotent under double delivery.
- Reconnection returns exactly what a cursor missed.
- Conflicts resolve deterministically and are recorded, not swallowed.
- The cache policy names every field and refuses to cache the ones it should not.
- Suites green, including the Swift check.
