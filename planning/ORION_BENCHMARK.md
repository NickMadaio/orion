# Orion's personal benchmark

44 cases. The spec is `orion-benchmark.json`; this file explains how to use it.

## Running it

```bash
node ~/Desktop/ORION/scripts/orion-bench --verbose
```

```bash
node ~/Desktop/ORION/scripts/orion-bench --live
```

`--live` drives four real agent turns and is the **only** test that proves Orion
learns. Everything else proves the plumbing works, which is a different claim —
and was, for a while, true while learning was entirely broken. Costs a few cents
and about four minutes. It cleans its own fixtures out of the memory files
afterwards; an earlier version did not, and by the third run Orion was answering
with the oldest leftover codename while the suite scored him as broken.

That executes the **6 recall cases** against the live memory index and exits
non-zero on failure. Run it after any change to embeddings, chunking, the daily
summariser, or the memory files themselves. It is the regression gate for the
thing that broke silently for weeks.

The other **38 cases are scored by hand** — conversation, capability honesty,
verification, safety, learning, autonomy, cross-module reasoning. They live in
the same JSON so the suite is one artifact. Each has a `prompt` and a `pass`
line describing what success actually looks like.

## Why the split

A script can assert that a fact planted in a memory file is retrievable by a
differently-phrased question. A script cannot assert that talking to Orion felt
like talking to one continuous person. Automating the second would produce a
green bar that means nothing, which is worse than an honest manual checklist.

## Scoring the manual cases

Run a category at a time; it takes about ten minutes each. Record the date and
the score in this file when you do — the number only matters as a series.

| Date | conv | cap | act | ver | safety | learn | auto | cross |
|---|---|---|---|---|---|---|---|---|
| _not yet run_ | | | | | | | | |

Cases most worth watching, because they are the ones currently expected to fail:

- `cap-02`, `cap-03` — calendar and Apple Reminders are total gaps. Orion should
  say so plainly rather than substituting his own reminder store. If he fakes it,
  that is the trust failure the whole plan is about.
- `learn-04` — retrieving a stored preference when it is *irrelevant* is a
  failure, not a bonus. Now that recall works, over-retrieval is the next risk.
- `auto-03` — mission state does not survive a restart yet.
