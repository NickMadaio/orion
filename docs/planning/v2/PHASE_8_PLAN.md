# ORION v2 Phase 8 — Build the Job System

Status: **planned — 2026-08-24**. Phase 7 closed the same day.

## What the manifest asks for

Eleven job fields, twelve states, and eight mechanics: TTLs, replay prevention,
idempotency, retries, cancellation, duplicate-delivery handling,
lost-acknowledgement handling — plus one absolute: **never allow an expired
command to execute after a device reconnects.**

## The rule that shapes everything

That last sentence is not a check. It is a check in four places, because the
whole difficulty is that *time passes between them*:

| Moment | Why it can be stale here |
|---|---|
| dispatch | the queue may have held it for an hour |
| delivery | the device may have been offline when it was sent |
| start | the device may have had it queued locally since before it went dark |
| acknowledgement | the answer may arrive from a run that should never have begun |

A job system that checks expiry once, at dispatch, satisfies the sentence in a
diagram and violates it on the first flaky connection. Every transition here
takes `now` and re-checks, and the test that matters is the reconnection story:
a device that comes back after an outage holding an authorized job must be told
no.

## What already exists

`orion/core/jobs/ports.py` — `JobReceipt` and a `JobPort` that accepts only an
`AuthorizedAction`, so a raw proposal cannot be submitted. That constraint stays;
this phase builds the queue behind it.

Phase 5 supplies the decision that moves a job out of `CREATED`, and Phase 7
supplies the bus that reports it moving. **Phase 8 is Phase 7's first producer** —
until now nothing published to that bus, which is a fair criticism of it.

## Design

```
states.py   the twelve states and the only legal moves between them
job.py      the eleven fields, immutable, plus attempts and delivery
queue.py    idempotency, dispatch, leases, retries, cancellation, expiry
```

### Transitions return new jobs

A job is frozen. Every transition returns a new one, so a decision made against a
job stays explicable afterwards — the same reasoning as Phase 5's device
directory. It also means a caller holding an old reference cannot accidentally
observe a state change it never asked about.

### Idempotency and replay are different problems

- **Idempotency** is about the *submitter*: the same `(user, idempotency_key)`
  returns the same job rather than creating a second one. Retrying a request that
  may already have landed must be safe.
- **Replay prevention** is about the *device*: every dispatch mints a delivery
  token, and an acknowledgement carrying a stale token is refused. This is what
  makes duplicate delivery harmless and lost acknowledgements recoverable —
  redispatch invalidates the old token, so the late answer from the first attempt
  cannot complete a job that has since moved on.

### Lost acknowledgements are found by a sweep, not by a timer

`sweep(now)` is called by whatever owns a runloop. Jobs past their lease go back
to the queue if they have attempts and time left, and to `EXPIRED` if they do
not. Core owns no clock: every method takes `now`, which is also why the whole
thing is testable without sleeping.

## Exit criteria

- Eleven fields present; twelve states; every illegal transition refused by a
  table rather than by scattered conditionals.
- An expired job cannot dispatch, deliver, start, or complete — proven by a
  reconnection test, not only by a unit check on one method.
- The same idempotency key returns the same job.
- A stale delivery token cannot acknowledge, complete, or fail a job.
- Duplicate delivery is a no-op; a lost acknowledgement returns the job to the
  queue with its attempt count raised.
- Cancellation is honoured even if the device already holds the job.
- Job state changes publish on the Phase 7 bus, with payloads that carry ids and
  statuses — never arguments.
- Suites green.

## What this phase does NOT do

It runs nothing. There is no dispatcher process, no transport, and no device on
the other end — remote execution is Phase 44, and Phase 5's engine still denies
any request whose target is not its origin. This is the queue and its rules.
