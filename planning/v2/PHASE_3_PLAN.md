# ORION v2 Phase 3 — the Context Firewall

Status: **planned — 2026-08-23**. Phase 2 closed the same day.

## What this phase is actually about

The manifest asks for a centralized `ContextBuilder` that classifies data by
domain and gives each inference only what it needs. Read the requirement list
closely and it splits in two:

- **Least-context** — give an inference the minimum. **Largely exists.** Selective
  recall (2026-08-16) only searches history on a continuity cue, `contextPruning`
  in cache-ttl mode drops stale tool output, and `memorySearch` returns one best
  result by default rather than everything it can find.
- **Domain isolation** — do not let health context reach an email task. **Does not
  exist at all.** Nothing labels a piece of context with a domain, so nothing can
  possibly enforce a rule about domains. This is the phase's real work.

Trust labelling is a third case, already strong: `authorizeTaskGraph` rebuilds
every input field by field so model-supplied content becomes
`untrusted_external`, and `HarnessProvenance` mints `trusted_user` only from a
real user turn the harness saw. What is missing there is *granularity* — three
trust levels where the manifest asks for six provenance categories.

## Requirement derivation

| Manifest requirement | Today | Phase 3 must add |
|---|---|---|
| Centralized `ContextBuilder` | context assembled ad hoc by OpenClaw's own pruning/recall | one Core builder that every bundle passes through |
| Classify by 12 domains | nothing labels domain | the taxonomy, on every context entry |
| Minimum necessary context per inference | selective recall + pruning + one-result default | keep; make the *decision* inspectable rather than implicit |
| Health context must not reach email tasks | unenforceable — no domains | default-deny cross-domain matrix |
| Email content must not reach health tasks | unenforceable | same matrix, both directions |
| Filesystem contents must not reach unrelated cloud tasks | unenforceable | same matrix |
| **Never expose credentials** | no credential is placed in context today, but nothing forbids it | `credentials` domain that cannot enter any bundle, with no allowance and no override |
| Label external data with provenance | `untrusted_external` exists | six categories, not three levels |
| Track source of each item | `ContextEntry.source` exists (Phase 1) | keep |
| Track sensitivity | `ContextEntry.sensitivity` exists (Phase 1) | keep |
| Track confidence | absent | required field, bounded 0.0–1.0 |
| Track whether info came from user, ORION, or external | conflated into trust | the provenance category answers it directly |
| Treat 9 named sources as untrusted | web content is marked untrusted; the rest is not systematic | a source→category map covering all nine |

## Design

### Domains

The manifest's twelve, unchanged:

```
general  conversation  calendar  email  health  computer
files    projects      contacts  travel  security  credentials
```

`credentials` is in the list but is not a domain context can be built from. It
exists so that "never expose credentials" is a rule the type system can state,
rather than a sentence in a document. Nothing may place an item in it, and no
allowance can admit it to a bundle.

### Provenance categories

The manifest's six:

```
user_asserted      the user said it
user_confirmed     the user was asked and agreed
system_generated   ORION's own machinery produced it
orion_inferred     ORION concluded it; may be wrong
external_untrusted came from outside; never authoritative
device_observed    a sensor or the OS reported it
```

These are *orthogonal* to the existing three trust levels, not a replacement.
Trust answers "may this authorize an action" and stays with the plugin. Provenance
answers "where did this come from and how much should it be believed", which is
what a context firewall needs.

### The isolation matrix

Default deny. A bundle built for a task in domain X admits items from X, from
`general`, and from nothing else unless an allowance names it.

Initial allowances, each with a reason:

| Task domain | May also see | Why |
|---|---|---|
| calendar | contacts, travel | an event has attendees and a location |
| email | contacts | a message has a sender |
| travel | calendar, contacts | a trip has dates and companions |
| projects | files | a project is mostly its files |
| computer | files | a device task acts on files |
| health | *(nothing)* | the manifest names health twice; it stays sealed |
| security | *(nothing)* | a security decision must not be argued from elsewhere |

`health` and `security` are deliberately sealed to their own domain plus
`general`. The manifest calls out health in both directions, and a security
decision that can be influenced by an email is not a security decision.

### Least-context, made inspectable

The builder records what it *excluded* and why. Today least-context is real but
invisible — you cannot audit a decision nobody wrote down. A bundle carries its
exclusions so a later phase's audit system has something to record.

## Test-gated slices

1. **Taxonomy and provenance.** Domains, categories, the untrusted-source map,
   and a schema. No behaviour.
2. **Labelled context entries.** Extend the Phase 1 `ContextEntry` with domain,
   provenance and confidence. No production consumers exist yet, so this is
   additive in practice.
3. **The isolation matrix.** Default-deny policy with named allowances, and the
   `credentials` rule that nothing can override.
4. **`ContextBuilder`.** Assemble a bundle for a task domain, enforce the matrix,
   respect the Phase 1 size budgets, and record exclusions.
5. **Untrusted source classification.** All nine manifest sources map to
   `external_untrusted`, and an unknown source defaults to untrusted rather than
   to anything friendlier.

## Exit criteria

- Every context entry carries domain, provenance, sensitivity, confidence, source.
- A bundle for an email task cannot contain a health item; the reverse also holds.
- No bundle can contain a `credentials` item under any allowance.
- An unrecognised source is classified `external_untrusted`, not `general`.
- Exclusions are recorded, so a least-context decision is auditable.
- Suites green; nothing live changes, since no adapter is rewired in this phase.

## What this phase does NOT do

No live rewiring. OpenClaw keeps assembling context for agent turns exactly as it
does today. Phase 3 defines the firewall and proves it; making the live route
pass through it is a coordinated integration slice like Phase 2's, and belongs
after the tool contracts (Phase 4) exist to say which domain each capability
belongs to.

Stating that plainly matters: a firewall nothing passes through protects nothing,
and this plan must not be read later as evidence that it does.
