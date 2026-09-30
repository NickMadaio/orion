# Phase 73: Backups and Recovery

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Backups and Recovery",
  "status": "in_progress",
  "entryRequiresPhase": "72",
  "entrySatisfied": true,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phases 65 and 66 are open on the app bundle's designated requirement, which is deliberately parked until Nick is at the keyboard, and neither is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "scripts/orion-backup and scripts/orion_v2_backup_check.sh (12 checks against a fixture).",
  "requirements": [
    {
      "id": "creates_encrypted_backups_of_essential_state",
      "status": "passed",
      "evidence": "AES-256-CBC with PBKDF2 at 600,000 iterations. `-pbkdf2` is not optional and the check asserts it: openssl's default key derivation is a single MD5 pass, which would make the passphrase the weakest part of the whole thing. The passphrase comes from the login Keychain and the script REFUSES rather than prompting, generating one, or falling back to no encryption \u2014 creating a passphrase would mean this program choosing and holding a credential."
    },
    {
      "id": "does_not_back_up_secrets_in_plaintext",
      "status": "passed",
      "evidence": "Stronger than the requirement: no secret is backed up AT ALL. A backup is a second copy, and a second copy of a credential is a second thing that can leak, somewhere nobody is watching, for as long as the backup exists. Every one is recoverable by rotating it at the issuer, so the archive carries a SECRETS.md rotation checklist instead. Excluded twice \u2014 removed from the staging copy AND excluded at archive time \u2014 because this is the one mistake here that would be silent and permanent. The check asserts no .env, no key file, and that the token string appears nowhere in a restored tree."
    },
    {
      "id": "tests_restoration",
      "status": "passed",
      "evidence": "`--verify` does a real RESTORE, not a checksum: 'the file is intact' and 'the backup works' are different claims and only the second is worth anything at 2am. The fixture check additionally proves a wrong passphrase restores nothing and a truncated archive is refused rather than partially restored \u2014 half a restore looks like a success until you look. THE CHECK FOUND A REAL BUG: the first version piped `tar | passphrase | openssl -pass stdin`, putting the passphrase IN the pipe, so tar's output was discarded and openssl encrypted nothing but the passphrase. It produced a plausible 12K archive containing no data. The passphrase now goes over fd 3."
    },
    {
      "id": "maintains_schema_compatible_restoration",
      "status": "passed",
      "evidence": "Every archive carries a MANIFEST.json with a schema version, what it contains and what it excludes, and `--verify` fails on an unknown schema so a future restore knows what it is holding. `--restore` writes into a DIRECTORY and never over the live system: a restore that overwrote ~/.openclaw in place would be irreversible at exactly the moment somebody is least sure what they are doing."
    },
    {
      "id": "tests_the_four_named_recovery_scenarios",
      "status": "blocked",
      "evidence": "Two of four are covered. DATABASE LOSS and SERVER REDEPLOYMENT are covered by the restore path and by there being no database or server. CREDENTIAL ROTATION is a documented checklist rather than a tested procedure, and DEVICE LOSS cannot be tested without losing the device. The end-to-end run also still needs Nick's Keychain item, which this program will not create \u2014 one command, and it is his.",
      "reason": "Credential rotation and device loss are documented, not exercised; and the end-to-end run needs a Keychain passphrase only Nick can create."
    }
  ],
  "nextPhaseAllowed": false,
  "postReviewCorrections": [
    {
      "on": "2026-09-04",
      "review": "Phases 49-80, oblivious",
      "note": "The claim 'no secret is backed up AT ALL' was FALSE. exec-approvals.json is staged and contains socket.token, 32 characters; both exclusion layers matched filenames only, and the archive MANIFEST asserted the opposite. The check could not have caught it \u2014 it planted a .env in its own sandbox and never touched the real sources() list. FIXED: a content pass now redacts credential-shaped VALUES from every staged JSON while keeping the structure a restore needs, the MANIFEST no longer asserts its own correctness, and the check exercises the real source list and the real redaction code extracted from the script rather than reimplemented. Mutation-tested: disabling redaction fails by name."
    }
  ]
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-73-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
