# ORION v2 Phase 4 — Formalize Tool Contracts

Status: **planned — 2026-08-23**. Phase 3 closed the same day.

## The constraint that shapes this phase

The manifest asks for structured capability names — `calendar.events.read`,
`files.list`, `system.volume.set`. ORION has 59 actions today with flat names
like `desktop_file_write_explicit`.

**Renaming them is not on the table.** Those names appear in the model's tool
description, in 1000+ historical ledger rows, in approval hashes that gate
`needs_approval` re-calls, and in the workshop/self-tuning surfaces. A rename
would break every one of those for a cosmetic gain.

So Phase 4 is **additive**, in the same shape as Phase 2: ORION owns a registry
that declares the structure the manifest asks for and maps it onto the live
action names, while the executor keeps working unchanged. The registry is the
contract; `catalog.ts` remains the implementation.

## What already exists

`ActionDefinition` in `openclaw-plugins/orion-control/src/catalog.ts` already
declares, for all 59 actions:

| Manifest requirement | catalog.ts today |
|---|---|
| unique capability name | flat name, e.g. `desktop_file_write_explicit` |
| input schema | `requiredArguments: string[]` — **names only, no types** |
| output schema | **absent** |
| side effects | partly: `execution` policy + `reversible` |
| risk classification | `risk: low \| medium \| high \| critical` |
| resource scope | partly: roots inside the execution policy |
| approval requirements | `approvalRequired: boolean` |
| audit requirements | implicit — everything is ledgered |
| platform availability | **absent** |

Plus an optional per-action `validateArguments` hook, used where a name list was
not enough.

## The gaps, and what closes each

1. **No structured names.** The registry declares a dotted capability name for
   each action, derived and then reviewed, without touching the live name.
2. **No argument types.** `requiredArguments` says a name is required, not that
   it is a string under 4096 bytes. The registry carries a real JSON Schema per
   action.
3. **No output schema.** Nothing declares what an action returns, which is why
   the Phase 2 bridge had to hand-write `system_status`'s output shape.
4. **No platform availability.** Every action is implicitly macOS-only. That is
   true today and false the moment the manifest's mobile phases start.
5. **No domain.** **This is what Phase 3's firewall is waiting on.** Until a
   capability says it belongs to `health` or `email`, the context matrix cannot
   be applied to a real request.
6. **Unknown arguments are not rejected.** `system_status` declares
   `requiredArguments: []` and the validator ignores extra keys — the exact
   parity break found on 2026-08-20 that forced the v2 bridge to fail open.

## Design

### The registry

`planning/v2/capability-registry.json`, validated by
`orion/core/schemas/capability.schema.json`, with a Python reference validator in
`orion/core/tools/registry.py`. One entry per live action:

```jsonc
{
  "action": "system_status",              // the live name, unchanged
  "capability": "device.status.read",     // the manifest's structured name
  "domain": "computer",                   // what Phase 3 needs
  "risk": "low",
  "approval_required": false,
  "reversible": true,
  "side_effects": ["reads_device_state"],
  "resource_scope": "none",
  "platforms": ["macos"],
  "arguments": { /* JSON Schema, additionalProperties: false */ },
  "returns":   { /* JSON Schema */ },
  "audit": "task_ledger"
}
```

### Generated, not hand-written

59 entries hand-typed would be wrong somewhere and would drift the first time
`catalog.ts` changed. A generator reads `catalog.ts` and derives everything it
can — risk, approval, reversibility, tier, required argument names — and a
reviewed overlay supplies only what cannot be derived: the dotted name, the
domain, argument types, and the return shape.

A drift check then proves registry and catalog still agree, exactly as
`orion_v2_model_contract_check.py` does for models. That check is what stops this
becoming a document that was true once.

### Unknown-argument rejection: default-off, like Phase 2

Rejecting unknown arguments is a **live behaviour change**. A call carrying an
extra key succeeds today and would start failing. That is more correct and it is
still a change to a working system, so it ships the way the v2 bridge shipped:
behind a default-`false` flag, with parity proven flag-off, then flag-on, then
rolled back.

When it is on, the Phase 2 bridge's fail-open behaviour should be revisited —
the reason it had to fail open was precisely that the legacy path accepted
arguments the contract refused.

## Test-gated slices

1. **Capability schema and reference validator.** Vocabularies, strict decoding,
   a registry that must cover every live action exactly once.
2. **Generator and reviewed overlay.** Derive from `catalog.ts`; supply names,
   domains and schemas by hand where they cannot be derived.
3. **Drift check.** Registry vs catalog: every action present, no extras, risk
   and approval agreeing.
4. **Domain coverage.** Every capability names a Phase 3 domain, and the pairing
   is sane — no file action claiming `health`.
5. **Strict arguments, default-off.** Unknown-field rejection behind a flag,
   with flag-off parity proven first.

## Exit criteria

- Every live action appears exactly once in the registry, and nothing appears
  that is not a live action.
- Every entry declares all nine manifest fields.
- Every capability names a domain, so Phase 3's firewall can be applied.
- The drift check passes and fails loudly when `catalog.ts` changes.
- No action permits arbitrary command execution.
- Unknown-argument rejection exists, is proven at parity flag-off, and is off by
  default.
- Suites green.

## What this phase does NOT do

It does not rename a single live action, and it does not turn on strict argument
validation. Both are deliberate: the first would break working prompts and
historical evidence, the second is Nick's to enable once he has seen it behave.
