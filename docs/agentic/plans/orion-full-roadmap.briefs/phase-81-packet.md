# Phase 81: Future Location Context

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Future Location Context",
  "status": "in_progress",
  "entryRequiresPhase": "80",
  "entrySatisfied": true,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phase 80's neighbours are open on an iOS app and on an independent review, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-04 against the live location state and the whole repository. The design already satisfied most of this before the phase was read.",
  "requirements": [
    {
      "id": "requests_minimal_permission",
      "status": "passed",
      "evidence": "No permission is requested, because none is needed: there is no CoreLocation, no CLLocationManager and no GPS anywhere in native/ or scripts/. Location is a place NAME and an IANA zone that Nick sets through orion-timezone. The minimal permission for this feature turned out to be none at all."
    },
    {
      "id": "prefers_coarse_or_contextual_location",
      "status": "passed",
      "evidence": "It is not merely coarse, it is not coordinates. The live state is {home: America/New_York, place: 'Montvale, New Jersey'} plus an expectedMove. A city name cannot be sharpened into a street the way a rounded latitude can, which is the failure mode 'coarse' usually still has."
    },
    {
      "id": "never_uses_background_location",
      "status": "passed",
      "evidence": "There is no location API to use in the background. The value changes only when a person runs orion-timezone, and every change is written to location-audit.jsonl with the previous value, the device zone and the cron jobs affected."
    },
    {
      "id": "explains_why_it_is_needed",
      "status": "passed",
      "evidence": "The one consumer is timekeeping: quiet hours, the morning brief's day boundary, the cron timezone, and Phase 78's travel brief. docs/planning/v2/DATA_INVENTORY.json states purpose, retention and exposure for it under 'device and system information'."
    },
    {
      "id": "maintains_retention_limits",
      "status": "blocked",
      "evidence": "location.json is overwritten so it holds one value, which is right. location-audit.jsonl is append-only and unbounded \u2014 deliberate for an audit trail, and genuinely a retention gap for a location trail specifically. It is two entries today. orion-privacy purge state removes location.json but not the audit, on purpose: an audit you can clear in one command is one an attacker clears in one command.",
      "reason": "The location audit trail is unbounded. Deliberate as an audit; a real retention gap for location specifically."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-81-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
