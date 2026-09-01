# ORION v2 Phase 22 — Calendar Read Integration

Status: **planned — 2026-08-25**. Phase 21 closed the same day.

## What the manifest asks for

Google Calendar OAuth on minimal scopes, a dedicated connector broker,
credentials only in the vault, and ten capabilities: listing, event reading,
availability, incremental sync, webhook handling, webhook validation,
subscription renewal, reauthorization, token revocation handling,
reconciliation. Google Calendar is the source of truth; **webhooks are change
signals, not canonical state.**

## The rule that shapes everything: a webhook cannot carry content

"Webhooks are change signals, not canonical state" is usually implemented as a
convention — the handler *chooses* to re-fetch. A convention is one convenient
refactor away from a handler that reads the payload, and a forged webhook is
then a way to write events into a person's calendar view.

So `Notification` has **no field that could hold an event**. It carries a
channel id, a resource id, a state word and a message number, and the handler's
only possible output is an instruction to go and fetch. Injecting content is not
prevented; it is unrepresentable.

## Credentials the module cannot hold

"Store credentials only in the credential vault" means the connector must not be
able to keep one. `backend/connectors/` therefore never imports the vault. A
connection holds a `credential_ref`; authorization is a **context manager** that
borrows from Phase 12's vault, yields headers inside the `with`, and disposes on
exit. The request object that survives the `with` refuses to carry an
`Authorization` header at all — checked in its constructor, so a token cannot be
logged, cached or retried into existence.

## Minimal scopes, meaning the fine-grained ones

`calendar.readonly` is one scope that grants every calendar. The minimal request
for what this phase actually does is three narrower ones — calendar list, events,
free/busy — and that is what is declared. Write scopes belong to Phase 25 and are
refused here by classification, not by remembering not to ask.

## Two absences that must not be read as deletion

- **An incremental page is a delta.** A local event missing from it was not
  deleted; it simply did not change. Deletion may only be inferred from a **full**
  listing, and the code takes different paths for the two so the mistake cannot
  be made by passing the wrong list.
- **A 401 on a data fetch is not a revocation.** `AGENTS.md` records this from
  the Whoop client, where clearing the grant on a fetch 401 disconnected the
  user. Only an explicit `invalid_grant` revokes; a 401 renews and retries once.

## Exit criteria

- Ten named capabilities, each with something checkable.
- `Notification` has no payload field, asserted by walking its fields.
- Webhook validation: unknown channel, wrong token, wrong resource, expired
  channel and a replayed message number all refused; the token compared in
  constant time.
- A prepared request cannot carry an Authorization header; the borrowed secret
  is disposed when the `with` ends, including on an exception.
- An expired subscription is re-created, not renewed, and forces reconciliation.
- Incremental absence never deletes; full-listing absence does.
- A fetch 401 renews and retries once and does not clear the grant; only
  `invalid_grant` does; revocation never deletes the user's data.
- Availability treats declined and transparent events as free, and an event of
  unknown transparency as busy.
