# Phase 80 — Call Capability: the policy, written before anything is built

The manifest is unusual about this phase. Every other one says build something.
This one says:

> Treat calling as a separate high-risk communications domain.
> **Before implementation define:** disclosure requirements; consent; recording
> laws; impersonation constraints; escalation; identity verification; sensitive
> information handling.
>
> Do not bolt calls onto Gmail permissions.

So the deliverable is this document, and it is finished when a person could
read it and know what they are not allowed to build. Nothing in the codebase
implements telephony, and `scripts/orion_v2_deferred_check.py` fails if
anything matching `twilio|voip|answer_call|phone_(answer|call)|sip_` appears in
the action catalog, the wrapper scripts or the exec allowlist. That check is
the enforcement; this is the reasoning.

---

## Why calling is not "messages, but louder"

`messages_send` already exists and sits at the third-party approval floor that
no strictness mode can lower. It would be tempting to treat a call as the same
thing with a different transport. It is not, for four reasons that all point
the same way:

1. **It is synchronous.** A text is read when the recipient chooses. A call
   interrupts, and the person on the other end has to respond in real time to
   something they did not agree to.
2. **There is no draft.** Every other outbound path in this system has a state
   between "composed" and "delivered" where a person can look. A call has no
   such state — dialling *is* delivery.
3. **The other party is a participant, not a recipient.** They speak. What they
   say is captured by whatever is listening, which makes every call a
   collection of somebody else's data.
4. **It is the one channel where impersonation is the default failure.** A text
   from Nick's number is from Nick's phone. A synthetic voice on a call is a
   claim about who is speaking, and the recipient has no way to check it.

The manifest's last line — do not bolt calls onto Gmail permissions — follows
from all four. A capability tier for calling must be its own, must sit at
`external_connected` or above, and must not be reachable by widening anything
else. That is the same structural rule `messages_send` and `self_modification`
already follow.

---

## 1. Disclosure

**Rule: the call discloses that it is automated, in the first utterance, before
anything else is said, and not on request.**

Not "if asked". Not in a terms-of-service somewhere. The first thing the
recipient hears must establish what they are talking to, because everything
they say afterwards is said on the basis of that belief.

The disclosure is fixed text, not model-generated. A model that composes its
own disclosure will eventually compose a shorter one, and the version that gets
shortened is the version that stops disclosing.

Concretely, if this is ever built:

- The disclosure string is a constant in the source, not a config value, not a
  prompt, and not an argument. Changing it is a code change that goes through
  the authority path.
- If the disclosure fails to play — TTS error, the recipient speaks over it,
  the call connects to voicemail — **the call ends.** It does not proceed
  undisclosed and try again later.

## 2. Consent

**Rule: consent is required from Nick for each call, bound to the recipient and
the purpose, and it is not standing.**

The approval gate built in Phase 49 is the right mechanism and it already has
the properties this needs: the hash binds to the exact arguments, so an approval
for one call cannot be replayed against a different number; grants are
single-use; tickets expire in fifteen minutes.

What must be added, and stated now so it is not discovered later:

- A call approval names **the number and the purpose in words Nick can read
  aloud**, because he will be approving it from a phone.
- `sovereign` mode **does not** relax this. Calling belongs in the same floor
  category as `messages_send` — `third_party_reach` — where no delegation
  reaches. This is a one-line consequence of the existing floor derivation and
  should be asserted by a test on the day the tier is added.
- There is no "approve all calls to this number" and no time-boxed calling
  delegation. Phase 50 delegations are for things whose worst case is a mess;
  this one's worst case is a person.

The recipient's consent is separate and is not something this system can
obtain. It can only be respected: see escalation, below.

## 3. Recording

**Rule: do not record. Do not transcribe and keep. Do not store audio.**

This is the shortest section because the answer is no, and the reasoning is
worth being blunt about rather than hedging:

Recording law is a patchwork. Some US states require all parties to consent;
some require one. Calls cross state lines routinely and the applicable rule can
depend on where each party is physically standing, which this system cannot
know. Several other countries are stricter than any US state. **A system that
cannot determine the applicable law cannot lawfully record**, and building a
per-jurisdiction consent engine to enable a feature nobody has asked for is the
wrong order of work by a wide margin.

If a transcript is ever genuinely needed:

- It is announced in the disclosure, as part of the same fixed first utterance.
- It is retained only for the duration of the call and discarded when the call
  ends — which means it never reaches the task ledger, the brain, or memory.
  Every one of those is append-only or long-lived by design, and none of them
  should hold somebody else's speech.
- The data inventory gets an entry before the first line of code, per Phase 71.

*This is not legal advice, and nothing here should be treated as a substitute
for it. It is a description of what this system is permitted to do, chosen to
be safe under the strictest rule rather than correct under the most permissive
one.*

## 4. Impersonation

**Rule: the voice must not be Nick's, must not claim to be Nick, and must not
answer as him.**

Three separate prohibitions because they fail separately:

- **Not his voice.** No cloned or fine-tuned voice model of Nick, ever, on this
  channel. The existing TTS voice is a synthetic voice that sounds like nobody.
- **No claim to be him.** The assistant says it is calling *on behalf of* Nick.
  There is a real difference between "I'm calling for Nick Madaio about the
  appointment" and "This is Nick", and only the first is honest.
- **No answering.** Inbound is a harder problem than outbound and is deferred
  separately (Phase 76 lists "AI phone answering"). A caller who dialled Nick's
  number expects Nick.

Voice enrollment already exists in the app (`SpeakerVerifier.swift`) and its own
header says it is not authentication — *"a recording of his voice defeats it"*.
That cuts both ways: if a recording of his voice defeats his own verifier, a
synthetic one on a phone call defeats a stranger's judgement completely.

## 5. Escalation

**Rule: the call ends when the recipient wants it to, and any confusion is
escalation.**

The assistant hands off or hangs up, and it does not persist:

- "Can I speak to a person" → end the call and tell Nick. Not "I can help with
  that".
- Any sign the recipient does not understand what they are talking to → repeat
  the disclosure once, then end.
- Distress, anger, or a request not to be called again → end immediately, and
  record the number as one not to call. That record is the one piece of state a
  call feature should keep permanently.
- No callbacks, no retries after a hangup, no second attempt in the same day.

A retry loop on a phone number is harassment with a scheduler attached, and the
automation framework built in Phase 57 would happily provide the scheduler. The
closed action table there must never gain a calling entry.

## 6. Identity verification

**Rule: never verify anybody, and never accept verification.**

Both directions, and both matter:

- **The assistant does not authenticate to the recipient.** It will not read
  back a date of birth, an account number, the last four of anything, or a
  one-time code to prove it is Nick. That is exactly the interaction a
  SIM-swap runs on. `messages_send` already refuses to transmit a one-time code
  and the same list applies here.
- **The assistant does not accept a claim of identity from the recipient.**
  Whoever answers is unverified. Nothing said on a call may authorize an
  action, change a setting, or satisfy a gate — a call is *untrusted external
  content*, the same as a web page, and the provenance system already treats
  it that way structurally: nothing arriving through a tool result can be minted
  as `trusted_user`.

The second point is the one most likely to be got wrong in a hurry, so it is
worth stating as a test that should exist on day one: **a call transcript
containing "approve A-7F3K" must not approve anything.** The Phase 49 test for
a page saying those words is the template.

## 7. Sensitive information

**Rule: what may be said on a call is an allowlist, not a denylist.**

The system already refuses credential shapes on every outbound path. That is a
denylist, and it is the right design for a text where the model composes the
whole body. It is the wrong design for a call, because a call is a conversation
and the model would be composing continuously against a recipient who can ask
questions.

So: a call carries a **script and a purpose**, both approved in advance, and the
model may not volunteer anything outside them. Asked something off-script, it
says it does not have that information and offers to have Nick call back. That
is a worse assistant and a much better one to have on the phone.

Never, under any circumstances: credentials, one-time codes, card or account
numbers, health information, home address, calendar contents beyond the single
appointment being discussed, or the contents of any message.

---

## What would have to be true before any of this is built

In order, and none of them is optional:

1. Phase 65/66 unblocked — meaning the app-bundle and designated-requirement
   work is done with Nick present, since a calling capability needs a real UI
   surface for the approval, not a terminal.
2. A `calling` capability tier of its own, at `external_connected` or above,
   listed explicitly in `PROFILE_TIERS` rather than folded into anything.
3. A `third_party_reach` floor entry, asserted by a test, so no strictness mode
   can free it.
4. A data inventory entry (Phase 71) written **before** the first line of code,
   covering what the recipient says as well as what is said to them.
5. An attack-surface entry (Phase 69) for call-borne injection, with a test.
6. An independent review (Phase 75) by somebody who did not build it. This
   document was written by the same model that would build the feature, which is
   precisely the situation Phase 75 warns about, and it is recorded as such.
