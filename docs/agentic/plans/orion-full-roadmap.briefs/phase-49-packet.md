# Phase 49: Remote Approval System

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Remote Approval System",
  "status": "in_progress",
  "entryRequiresPhase": "48",
  "entrySatisfied": false,
  "openedOn": "2026-09-02",
  "openedAgainst": "Entered with entrySatisfied false. The phase before it is open on requirements that are not code -- mobile cancellation needs a phone surface, and Phase 46's two other gaps change the capability surface and execution semantics respectively. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "plugin/orion-control/src/{approvals,strictness}.ts and the gate in validator.ts, covered by src/gate.test.ts and src/index.test.ts (170 tests) and by scripts/orion_v2_strictness_check.sh (27 checks) against the live machine.",
  "requirements": [
    {
      "id": "creates_a_canonical_job_representation_and_hashes_it",
      "status": "passed",
      "evidence": "permissions.ts builds a canonical string with sorted keys and digests it with sha256, and the plugin returns that canonicalHash on an approval-required rejection. Observed live on 2026-09-02: 74c7acc61ad69234ad1b1e9e47081f19cd37522fadaae14f12f29a83a1c24d0d, bound to the exact arguments."
    },
    {
      "id": "shows_a_human_readable_approval_on_iphone",
      "status": "blocked",
      "reason": "There is no iPhone app. The approval surface is the terminal and Discord.",
      "evidence": "Still no iPhone app. What exists now is the human-readable half without the phone: a ticket carries a rendered one-line summary ('messages_send \u2014 recipient: Mum, body: \u2026') rather than a JSON dump, and `orion-approve` with no arguments lists what is waiting with what it would do. Terminal and Discord, not iOS."
    },
    {
      "id": "requires_face_id_where_appropriate",
      "status": "blocked",
      "reason": "Depends on the phone surface.",
      "evidence": "grep for LAContext returns nothing."
    },
    {
      "id": "signs_approval_with_a_device_authorization_key",
      "status": "blocked",
      "reason": "No SecureEnclave key exists. Filesystem placement plus a nonce is the substitute, and it is weaker.",
      "evidence": "Not done, and the substitute is named rather than implied: a grant is authenticated by WHERE it is (a directory nothing in Orion's tool surface can write) and by a nonce only the minting process knew, not by a signature. On a single-user Mac with no privilege boundary that is the honest ceiling without a Secure Enclave key, which needs the phone."
    },
    {
      "id": "includes_target_device_capability_arguments_hash_expiration_and_nonce",
      "status": "passed",
      "evidence": "CLOSED 2026-09-02 for the Mac half. An `ApprovalTicket` carries the capability (action), the arguments hash (canonicalActionHash over action, arguments and working context), an expiry (15 minutes), a 128-bit nonce from the CSPRNG that the grant must echo, and `deviceId` from hostname() -- `readTickets` drops a ticket minted on another Mac, because the approval directory is syncable. The Swift RemoteJob half from Phase 45 is unchanged."
    },
    {
      "id": "mac_verifies_signatures_independently",
      "status": "blocked",
      "reason": "Depends on signing, which depends on the phone.",
      "evidence": "Nothing is signed, so nothing verifies a signature. The Mac does now verify independently in the weaker sense that matters today: it re-derives the canonical hash from the submitted bytes and matches it against a grant it reads off disk, rather than trusting a value in the request."
    },
    {
      "id": "keeps_a_human_in_the_loop_for_every_approval",
      "status": "passed",
      "evidence": "CLOSED 2026-09-02. The gate no longer reads the hash off the step. `validator.ts` consults `options.approvalGrants`, which the plugin entry fills from a grant directory, and the step's own `approvalHash` is ignored for authorization. A grant is written only by `orion-approve` or by `orion-remote` acting on a non-local sender; both refuse the `local` identity an exec call presents. The boundary is four claims -- absent from the exec allowlist, in FORBIDDEN_SCRIPTS, outside every mutable root, and the config paths in FORBIDDEN_CONFIG -- and orion_v2_strictness_check.sh re-checks all four against the live machine. Mutation-tested: restoring the old acceptance fails four named assertions, and removing the local refusal fails one. VOICE ADDED 2026-09-03. A third channel, and the one that made the other two usable hands-free: if Nick's own authenticated turn says \"approve A-7F3K\", that is a person saying yes. Read from `trusted_user` instruction inputs only -- minted by authorizeTaskGraph from OpenClaw host provenance, never by the model -- so an email or a page saying the same words changes nothing. The first design was speaker verification and was abandoned because SpeakerVerifier.swift forbids it in its own header (\"IT IS NOT AUTHENTICATION... nothing security-relevant should ever be conditioned on it\") and because it fails open. Mutation-tested: deleting the trust filter lets an injected instruction approve, and the test names it."
    },
    {
      "id": "authorization_checks_are_satisfiable_by_the_name_a_person_would_type",
      "status": "passed",
      "evidence": "CLOSED 2026-09-02. Two halves. (a) Approval ids are `A-7F3K`: four characters from an alphabet with no 0/O/1/I/L, and `normalizeTicketId` accepts the id lower-case, upper-case, or without the `A-` prefix. (b) `argumentNotFromUser` now also matches a filename on its stem, so Nick saying \"fix executors\" satisfies the origin check for `executors.ts`; before, `normalizeForOrigin` stripped the dot from both sides and demanded the token `executorsts`. The widening only ever lets more through, and the test pairs two authority-classed files so the negative case is not vacuous."
    },
    {
      "id": "never_presents_an_approval_identifier_the_system_did_not_mint",
      "status": "passed",
      "evidence": "AMENDED IN 2026-09-02 and repaired the same day, on the transport side. Orion truncated the plugin's 64-character canonicalHash to 13 characters, wore an ap- prefix on it, and when refused rationalised the mismatch as truncation and resent the full hash still prefixed. Real ids are ap- plus exactly 8 hex and only orion-notify mints them; remote.json's pending map was empty throughout. The channel brief now states he cannot create one, names the format, and requires him to say he has no pending approval rather than invent one."
    }
  ],
  "limitations": [
    "The two halves of approval do not know about each other: the plugin has canonical hashing with no human, and the Swift RemoteJob domain has expiry, nonce and target device with no plugin. Phase 49 is largely the work of joining them.",
    "Everything involving the phone is blocked behind a phone application that does not exist."
  ],
  "nextPhaseAllowed": false,
  "postReviewCorrections": [
    {
      "on": "2026-09-04",
      "review": "Phases 49-80, oblivious",
      "note": "Two corrections. (a) The evidence said restoring the old hash acceptance fails FOUR named assertions; it fails three. Precision is this file's premise and the number was wrong. (b) The claim that a spoken approval reads only Nick's own words was too strong: `trusted_user` is minted from any role:user line in the transcript, and the Swift app and the remote bridge both inject context that way \u2014 496 such turns across 482 session files. The transport's own briefing contains the literal words 'yes, approve A-7F3K', and was held back only because the first occurrence of the id sat in a non-affirmative clause. FIXED: machine-authored blocks are stripped before the turn is read, and every occurrence is examined rather than the first. Both halves mutation-tested; each fails a named test alone."
    }
  ]
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-49-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
