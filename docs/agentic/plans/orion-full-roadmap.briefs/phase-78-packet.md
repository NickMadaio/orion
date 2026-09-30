# Phase 78: Future Travel Assistant

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Future Travel Assistant",
  "status": "in_progress",
  "entryRequiresPhase": "77",
  "entrySatisfied": false,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phases 65 and 66 are open on the app bundle's designated requirement, which is deliberately parked until Nick is at the keyboard, and neither is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "plugin/orion-control/src/travel.ts, five actions under the `travel` tier, covered by src/gate.test.ts and enabled live.",
  "requirements": [
    {
      "id": "builds_on_calendar_gmail_travel_detection_and_timezone",
      "status": "passed",
      "evidence": "All four foundations already existed; what was missing was the object in the middle. `trip_detect` reads mail through the hard-wired read-only wrapper, `trip_brief` reports the timezone shift, and trips are Orion's own state."
    },
    {
      "id": "recognizes_confirmations_and_creates_trip_objects",
      "status": "passed",
      "evidence": "Detection PROPOSES and never creates. A confirmation email is untrusted text and anyone can send one that looks real, so `detect` returns candidates with the verbatim line each came from, and a trip is only made by an explicit act with arguments from Nick's own turn. The patterns require a STRUCTURED token \u2014 an airline code plus digits near a departure word, a check-in line \u2014 because a loose pattern does not make a slightly-wrong trip, it makes a trip out of a marketing email. Four such emails are in the test and none matches. Repeats are deduplicated: the same confirmation arrives as booked, reminder and check-in, and three copies of one flight is a brief nobody reads."
    },
    {
      "id": "adjusts_schedule_timezone",
      "status": "blocked",
      "evidence": "REPORTED, deliberately not applied, and this is a decision rather than a gap. `orion-timezone set` changes what every reminder, quiet-hours rule and calendar read believes the time is; a travel feature that moved it quietly would make all of them wrong on exactly the days Nick is least able to notice. The brief computes the shift at the trip's START rather than at now \u2014 New York to London differs by an hour depending on the date, so a single 'it is +5 there' is wrong for half the trip \u2014 and prints the exact command for him to run.",
      "reason": "Applying the timezone is deliberately left to Nick; the brief reports the shift and gives the command."
    },
    {
      "id": "requires_approval_before_creating_or_modifying_bookings",
      "status": "passed",
      "evidence": "Satisfied by absence, which is the strongest form: there is no operation in this tier that books, modifies or cancels anything, a test asserts the five action names and that none mentions booking or payment, and Phase 76's deferral check watches for one arriving. A trip object is a note about a booking somebody else made."
    },
    {
      "id": "says_how_sure_it_is",
      "status": "passed",
      "evidence": "Phase 64's vocabulary used literally rather than as decoration. Every detected leg is `inferred` \u2014 a regex matched an email and nothing checked it against an airline \u2014 and the brief says so in as many words. Saying 'you fly at 19:25' about an inferred booking is exactly the failure Phase 64 exists to prevent."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-78-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
