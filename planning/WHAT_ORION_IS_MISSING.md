# What Orion is missing — a re-evaluation against the actual goal

Written 2026-07-30, after the voice/interface/trust work. Deliberately a step
back from the build.

---

## The question worth asking

Orion is now: a permission-gated Mac body, a tiered brain, a warm streaming
voice, a hologram that reacts to your actual waveform, a wake word, and a
menu-bar presence. That is a lot. It is also, still, **a very good command line
with a beautiful face**.

The gap between that and Jarvis is not more polish. Watch what Jarvis actually
does in the films and almost none of it is answering questions well:

- *"Sir, the reactor's at 400% capacity."* — he **speaks first**.
- *"Shall I begin the Mark VII protocols?"* — he knows what Tony was **already
  doing** and proposes the obvious next step.
- *"You've been up for 72 hours."* — he holds **continuity** across time.
- Tony says "that one" while pointing — Jarvis knows **what's on screen**.

Every one of those is a capability Orion does not have. Ranked by leverage:

---

## 1. Proactivity — the single biggest gap

**Orion has never once spoken first.** It is a request/response loop with a nice
front end. Jarvis is defined by the opposite.

This is now unusually cheap to build, because the interface work already
produced the hard part: `PanelController.summon()` brings the hologram to a
corner without stealing focus, and the wake path proves Orion can start a turn
it wasn't asked for. Proactivity is the same motion with a different trigger.

What it needs:

- **Event sources.** Calendar (meeting in 10 minutes), Mail (something from a
  named sender), the filesystem (a build finished), the gateway (a scheduled
  task produced something), system state (battery, disk, a long-running job).
  OpenClaw already has scheduling and channels; most of this is wiring.
- **A relevance policy — the actual hard part.** An assistant that interrupts
  badly gets muted within a day, permanently. The bar for speaking unprompted
  must be far higher than the bar for answering. Start with a *tiny* allowlist of
  event types the user explicitly opts into, a quiet-hours window, a hard rate
  limit (no more than N interruptions/hour), and a "not now / never again"
  response that actually persists. Ship it silent-by-default and let him turn
  categories on one at a time.
- **Graded urgency.** Most things are a glance: the hologram brightens in the
  corner, no speech. Some are a line of text. Very few are worth talking out
  loud. Right now Orion has exactly one volume.

**Effort:** moderate. **Payoff:** this is the thing that would make it feel alive.

---

## 2. Memory that actually retrieves

The audit found `orion/memory.py` searching with `content LIKE '%query%'`. That
is not memory, it is grep. Orion cannot answer "what did I decide about X last
week" and cannot accumulate a model of its user — which is most of what makes
Jarvis feel like *Tony's* Jarvis rather than a generic assistant.

The OpenJarvis evaluation (`OPENJARVIS_EVALUATION.md`) identified this as the one
clear capability gap where that project is genuinely ahead, and the fix needs no
new dependencies: **SQLite FTS5 + chunking + reciprocal-rank fusion** over the
existing store. Keep Orion's superior attribution model (category, source,
confidence, vault mirror) and put real ranked retrieval underneath it.

Two things worth getting right that most implementations don't:

- **Memory must be inspectable and editable.** He should be able to see what
  Orion believes about him and delete a line. Memory that can't be corrected
  becomes a liability the moment it learns something wrong.
- **Memory is untrusted input.** It is text that influenced the model, and by
  the project's own threat model that means it cannot carry authority. Retrieved
  memory must never satisfy the trust gate — a fact worth asserting in a test.

**Effort:** low-moderate. **Payoff:** high, and compounding.

---

## 3. Situational awareness — knowing what you're looking at

"Summarize this." "What's wrong with this function?" "Reply to her." All fail
today, because Orion has no idea what is on screen or what app is frontmost.

Cheap, ordered by ratio of value to intrusiveness:

- **Frontmost app + window title.** One `NSWorkspace` call. Turns "summarize
  this" into "summarize the document named X in Preview" before the request ever
  reaches the model.
- **Selected text**, via the Accessibility API already granted for push-to-talk.
  This alone covers a large share of real requests.
- **Screenshot on demand** — only when a request is visual, never ambient, and
  every capture ledgered. This one deserves a hard gate: a Mac assistant that can
  see the screen whenever it likes is a different risk category, and it should
  never be a silent capability.

**Effort:** low for the first two. **Payoff:** every request gets shorter, which
is what "it just knows" actually feels like from the inside.

---

## 4. Reach beyond the Mac

The PDF's word was *ubiquitous*, and right now Orion exists only when he is
sitting at this laptop. OpenClaw already ships messaging gateways for iMessage,
Telegram, WhatsApp and Slack — this is close to configuration, not construction.

Being able to text Orion from the gym and have it answer, or having it reach him
when a scheduled task finds something, is a large step toward the stated goal for
a small amount of work. **Caveat that matters:** a message from a phone is not
the same trust anchor as a keypress on the trusted machine. The new provenance
model has to be extended deliberately here rather than by accident — a remote
channel should get a *narrower* capability set, not the same one.

**Effort:** low. **Payoff:** high. Probably the best value-per-hour item here.

---

## 5. The capability ladder — still mostly unclimbed

Orion can create, read and list files. That's it. The plan from the earlier
handoff still stands: force-quit → system settings → allowlisted shell → app
install → credentials via the 1Password skill. `app_control` is now implemented
and just needs `enableAppControlActions: true`.

**Do the taint tracking first.** The OpenJarvis evaluation's top recommendation
is orthogonal to the gate rather than duplicative: the gate asks *may this run*,
taint asks *where may this data go*. It catches composition leaks — read an
email, then search the web — where every individual step was legitimately
approved. That distinction gets more valuable with every capability added, and
retrofitting it later is much harder than building it in now.

---

## 6. Specialist sub-agents

The second TikTok's framing was right: Jarvis as a **hub** — a reasoning core
plus specialist agents that each own their context and tools, not one monolith
holding everything. OpenClaw supports multiple agents natively.

A "mail" agent, a "calendar" agent, a "code" agent — each with a narrow tool set
and its own system prompt — is both better (smaller context, sharper behaviour,
cheaper per turn) and safer (a compromised mail agent cannot touch the
filesystem). This becomes worth doing around the time the tool count passes
roughly a dozen. Not yet, but it should shape decisions made before then.

---

## Deliberately not recommended

- **Anything that routes around `orion-control`.** The gate is the entire thesis
  of this project. A feature that bypasses it isn't a feature.
- **The OpenJarvis learning loop.** Trace-driven adaptation gives anything that
  can influence traces a persistent, hard-to-audit channel into future
  behaviour. That inverts Orion's "the model is untrusted" premise, which is the
  thing that makes it defensible.
- **More interface polish, for now.** The face is ahead of the substance. The
  next visible win should come from Orion knowing or doing something new, not
  from it looking better while doing the same things.

---

## If only one thing gets built next

**Proactivity, scoped down hard.** One event source — calendar — one interruption
style (hologram brightens in the corner, no speech), quiet hours, a hard rate
limit, and a "not now" that sticks.

Not because it is the biggest, but because it is the smallest change that alters
what Orion *is*. Everything above it in this document makes a good assistant
better. This is the one that makes it feel like something that is present in the
room, which is the actual goal and the thing no amount of latency work will ever
produce.
