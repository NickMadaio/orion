# Permission elevation — proposal (2026-08-04)

Nick's complaint, verbatim: *"He is TOO useless because every turn I take there's
a new permission error."* And the goal behind it: *"If he isn't self improving
and self sustaining then there is no point of having him."*

Both are fair. This is what is actually causing it, and what I propose to do.

## First: most of it was a bug, not a policy

Before designing anything, the obvious question — how much of that friction was
the security model doing its job, and how much was it malfunctioning?

Mostly malfunctioning. The specific failure Orion described himself:

> It blocked me from touching a file I'd created in the same session just
> because the filename came from my own output.

That is `target_from_untrusted_content` in `validator.ts`, and here is the chain:

1. `after_tool_call` records the result of **every** tool not on
   `OWN_BOOKKEEPING_TOOLS` as untrusted comparison corpus.
2. `orion_task_run` is not on that list. Its result names every path the run
   touched.
3. So the moment Orion creates `notes.txt`, the string `notes.txt` is inside
   "content Orion read".
4. The next turn — "now add a line to it" — names no file. The taint check finds
   the path in untrusted content, fails to find it in the user's words, refuses.

Every file Orion created poisoned itself for the rest of the session. The
comment above `OWN_BOOKKEEPING_TOOLS` anticipates this exact failure and calls it
"self-poisoning from his own audit trail" — then lists `orion_task_status` and
omits `orion_task_run`, the tool that actually performs the write.

**Fixed** in this pass, via a session-scoped self-authored-artifact registry:
a path becomes editable-without-renaming only by having been the verified target
of a step that already passed the full gate. An injected `create exfil.txt` is
refused at creation, so it never enters the registry and can never be excused
later. Regression test included, and confirmed to fail without the fix.

The reason this matters for the rest of this document: **do not redesign the
permission model around friction that was a bug.** Live with the fixed version
for a few days first. My estimate is that it removes the majority of the
per-turn errors, and what remains is a much smaller and more honest list.

## Second: the spoken password

The proposal was: Orion asks for a confirmation password, Nick says it, a
separate program verifies it, Orion gets broad permissions.

I do not think this should be built, and the strongest argument is already in
this repo. `SpeakerVerifier.swift`, rule 3:

> **IT IS NOT AUTHENTICATION.** It filters the television and the room. A
> recording of his voice defeats it, and nothing security-relevant should ever
> be conditioned on it.

That was the right call and it applies with more force here. Beyond the replay
problem, a spoken password has a deeper issue: it authenticates **the speaker**,
but the thing that actually needs checking is **the plan**. Orion is the
component that decides when to ask, what to do with the grant, and how long to
hold it. If a hostile file or page has steered his plan, the password ceremony
completes perfectly and the corrupted plan executes with full permissions. The
gate opens on identity and the risk lives in intent.

It also inverts the property the current model gets right. Today, trust is
minted only from host provenance and is bound to *what the user's own words
asked for*. A password grant is unbound: it says "yes, generally", which is the
one thing an injection needs.

## What I propose instead: propose → confirm → scoped grant

Nick's own framing was already most of the way there — *"let him have permission
only after he proposes his plan to me, and then I give him verbal
confirmation."* Keep exactly that, and drop only the password.

1. **Orion proposes.** He submits the task graph with
   `intent: "propose"`. Nothing executes. He gets back a plain-language summary
   of every step, the tiers each needs, and a `proposalId` bound to the graph's
   canonical hash.
2. **Nick confirms in his own words.** "Yes, do that." The confirmation arrives
   through the same host provenance channel that already exists — no new trust
   source, no new attack surface.
3. **The grant is scoped to that hash.** Approving unlocks *those steps with
   those arguments*, once. Not a tier, not a window, not a session. If the plan
   changes, the hash changes and the approval is void.

This gives Nick the thing he wanted — stop being asked six times per task, say
yes once — without ever creating an "Orion can do whatever" state. The approval
mechanism is already half-built: `approvalRequired` + `canonicalActionHash` in
`validator.ts` does exactly this binding for individual destructive actions.
Extending it from one step to a whole graph is a small change to code that has
tests.

### Standing grants, for the genuinely repetitive things

Scoped approval still asks once per task. For work Nick does constantly, add a
standing grant: an action + argument-shape pattern he has approved permanently,
recorded in the permission state file, revocable, and listed by
`orion_permission_status`. "Never ask me about writing inside the scratch
workspace again" should be sayable once.

This is where the real friction reduction lives, and it is safe in a way a
blanket unlock is not, because each grant still names *what*.

## Self-propagation: what he can already change about himself

Shipped in this pass, as the deliberately small version:

- `voice_tuning_read` / `voice_tuning_set` (`self_tuning` tier) let Orion adjust
  his own voice timing — including the endpointing that was cutting Nick off
  mid-sentence, and the watchdog that ends a wedged speaking phase.
- Closed key list, constant domain, range-checked values, verified by read-back,
  each change recording its own inverse.

The general form of this — "a tool that edits config" — is really "write any key
into any preference domain", which includes every other app on the machine. The
table in `TUNABLE_SETTINGS` is how it stays useful without being that.

### Adding tools to his own toolbox

This was the other half of the ask, and it is a genuinely harder problem, so I
want to flag the shape rather than pretend it is a config change.

A new tool is new *code*, running with the gateway's authority. The security
model here rests on the action catalog being a fixed, reviewed set with declared
risk, tier, reversibility, and a verifier. A tool Orion writes at runtime has
none of those unless he also declares them — and a model declaring its own
action's risk level is the same category of mistake as a model declaring its own
`trusted_user`, which this codebase already removed once, deliberately.

The version I would build: Orion **drafts** a catalog entry and executor,
writes it to a staging directory, and explains what it does and why. It does not
load. Nick reviews the diff and runs the existing build/deploy path. That is
still an enormous speedup over describing a tool in prose and waiting — he does
the work, Nick keeps the merge button. Genuine self-extension, with a human on
the one step that cannot be safely automated.

## Suggested order

1. Live with the taint fix. Find out what friction is actually left.
2. Standing grants — highest friction relief per unit of risk.
3. Graph-level propose/confirm.
4. Tool drafting into staging.

Steps 2 and 3 are what turn "a new permission error every turn" into "he asked
me once and got on with it", which was the actual request.
