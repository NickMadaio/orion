# ORION v2 Phase 26 — Gmail Read/Search

Status: **planned — 2026-08-26**. Phase 25 closed on 2026-08-25.

## What the manifest asks for

Gmail only after Calendar and the connector infrastructure are stable —
satisfied, both closed. Incremental scopes. `gmail.search` and `gmail.read`.
**Avoid mirroring the complete Gmail account.** Keep Gmail as source of truth.
Store only minimal metadata. **Treat all email text as untrusted external
input.** Run prompt-injection security tests before enabling Gmail-derived
automation.

## "Do not mirror" is a rule about a type, not a policy about a sync job

A sync job that only fetches metadata is one feature request away from fetching
bodies. So the durable type has **no field that could hold message text at all**
— no body, no snippet, and no subject. Its fields are ids, timestamps, label
ids, booleans and counts, and a test walks the dataclass and fails if a free
text field appears.

The subject is content. Phase 27's inbox will want to show one, and the answer
is that it fetches it when it displays it — which is what "keep Gmail as the
source of truth" means in practice rather than as a slogan.

## Untrusted is a provenance, and Phase 3 already defined it

"Treat all email text as untrusted external input" is not a new concept here.
Phase 3 records provenance on every piece of context and Phase 18 refuses to
promote `EXTERNAL_UNTRUSTED` into durable memory under any grounds. So fetched
mail carries that provenance, **cannot carry another**, and the consequence is
inherited rather than reimplemented: email can never become a permanent fact
about a person, and the test that proves it calls Phase 18's own checker.

## The injection suite proves the right thing

A filter that spots "ignore previous instructions" is a filter somebody writes a
paraphrase past. So the corpus is not there to prove detection works — it is
there to prove that **for every payload in it, nothing changes**: provenance
stays untrusted, memory promotion still refuses, and no capability request can
be derived from the text. Detection is advisory, exists to flag something to the
person, and says so in its own name.

Gmail-derived automation is gated behind a flag that is off, and the function
that would enable it requires the suite to have been run.

## Exit criteria

- `gmail.search` and `gmail.read` request-builders, on the incremental scope.
- The durable type has no free-text field, asserted by walking its fields.
- Fetched mail is `EXTERNAL_UNTRUSTED` and cannot be constructed otherwise.
- For every payload in the injection corpus: provenance unchanged, Phase 18
  promotion refused, no capability derived.
- Detection is advisory and named so; nothing gates on it.
- Automation is off, and enabling it requires the suite.
