# ORION v2 Phase 20 — Unified Capture

Status: **planned — 2026-08-25**. Phase 19 closed the same day.

## What the manifest asks for

Capture through text, voice, the iOS Share Sheet, screenshots, photos and
selected content — widgets and App Intents later. Classify each item into one of
nine kinds. **Do not permanently save ambiguous captures without resolving their
type.**

## The rule, and where it has to live

"Do not permanently save ambiguous captures" is a rule about *persistence*, so
putting it in the classifier would be putting it in the wrong place: a classifier
that refuses to guess is a classifier somebody replaces with one that guesses.

It lives in two places instead, which is deliberate rather than duplicated:

- **on the phone**: an unresolved capture has no durable payload. The function
  that would hand it to storage returns nothing, so the calling code cannot
  accidentally save it.
- **in the cloud**: Phase 18's memory store already refuses to make anything
  durable without grounds, and an unresolved capture has none.

Two independent refusals, at the two boundaries where "permanently save" actually
happens.

## Classification that admits what it does not know

Nine kinds, and `unknown` is one of them rather than a failure. A classifier that
always produces an answer produces a wrong answer for anything unusual, and the
manifest asks for ambiguity to be *resolved*, which requires it to be
representable first.

Resolution is the user picking. A capture resolved by the user records that it
was, so a later reader can tell a guess from an answer.

## Exit criteria

- Six capture sources, with widgets and App Intents marked as later rather than
  implemented.
- Nine kinds including `unknown`.
- An unresolved or low-confidence capture has no durable payload, asserted.
- User resolution records that it was resolved by the user.
- `swift run MobileCoreCheck` still exits 0.
