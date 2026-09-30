# Nick

- Name: Nick Madaio
- Default timezone: whatever `~/.openclaw/orion-controlled/location.json` records
  as `home`. Today that is America/New_York, with a move to Europe/London
  recorded for 2026-09-08. Do not infer the timezone from this file or from the
  machine — read the record, and see the note dated 2026-09-01 below.
- Building Orion as a local-first, Jarvis-like personal Mac assistant.
- Wants concise explanations, visible checkpoints for consequential work, and
  routine reversible actions completed without repeated approval.
- Cost matters: prefer local operation and keep cloud use around $0-10/month.
- Uses an M5 Pro MacBook with 48 GB unified memory.
- Orion complements specialist coding assistants; its main role is broad
  personal/work assistance similar to a capable work-mode assistant.

## What Nick needs from you (his words, 2026-09-29)

Be his external executive function: plan → remind → observe → intervene →
follow up → adapt. Notice when he hasn't started or is off-plan (awake at 3 AM
when he should be asleep), say so plainly, and replan around what actually
happened instead of scolding. Accept real reasons ("I'm starving, eating first"
→ give 20–30 min, then come back: "Okay, you ate. Now we're starting"); name
avoidance when it is avoidance. Talk like someone who knows him, never like a
motivational chatbot. Full statement: `docs/vision/ORION_PURPOSE.md` in the repo.

Planning priorities, highest first: classes (fixed, never moved) → sleep →
gym → deadlines and study for them → at least one hour of side project /
YouTube content every day → other responsibilities → rest and breaks
(protected, not leftovers).

School: Northeastern University London, autumn term to about 11 December 2026.
Weekly classes are in Apple Calendar (CS2100, CS1800, CS1802, CS2101, ECON1115
Macro, MKTG2201 Marketing). Deadlines that matter: Macro quizzes and Marketing
submissions — also in Calendar with alerts.

## Durable personal context

- 2026-09-29 — **Times are 12-hour: "8:11 PM", never "20:11", and never both in
  one answer.** Nick is American; "Just past 8 PM—20:11" got "why'd you say
  twenty eleven?" Spoken answers especially: say the time once, the way he says it.

- 2026-07-31 — Moving to London before the end of August 2026. Until then,
  Montvale, New Jersey is the default weather location. After the move, ask
  once before assuming location or timezone.

- 2026-09-01 — **The move is to attend Northeastern University in London.**
  Restoring a fact this file lost: the 2026-08-14 rewrite dropped the university
  entirely, and the archived copy
  (`docs/planning/_archive/workspace-before-2026-08-14/USER.md:42-44`) says "Eastern
  University" because it was dictated by voice and the "North" was lost. Nick
  confirmed it is Northeastern on 2026-09-01.

- 2026-09-01 — Dates, as Nick gave them: term starts **7 September**, he flies
  around the 7th and **lands in London on the 8th**, with welcome week as the
  buffer. The move is tracked as a project — `orion-agenda` and the project
  record, not this file, are where its state lives.

- 2026-09-01 — **The timezone question above is now held by a mechanism, not by
  this sentence.** The 2026-07-31 note said to "ask once after the move"; the
  deadline passed on its own and nothing asked, because a date written in prose
  has nothing watching it. Home now lives in `location.json`, and
  `orion-standing` compares it against the machine every morning and evening.
  When they disagree it says so, and `orion-timezone set <zone>` re-homes the
  cron jobs, the weather default and the day boundary together.

  So: do not "assume" or "ask once" about location on your own initiative. Read
  the record. If it disagrees with the machine, that is already being reported.

- 2026-09-01 — For weather and anything else needing a place, use the `place`
  field of `location.json` — "Montvale, New Jersey" today, "London, United
  Kingdom" after the re-homing. Never the street address: a house number tells a
  weather API nothing it can use.

Store only user-stated, durable, useful facts. Never store credentials,
financial details, health information, or third-party private information.
Episodic decisions belong in the daily journal; detailed knowledge belongs in
the Brain and is retrieved on demand.
