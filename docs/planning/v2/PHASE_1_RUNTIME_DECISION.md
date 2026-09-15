# ORION v2 Phase 1 — runtime and contract placement decision

Status: **reference contracts active; live adapter deferred for coordination**.

## Decision

The active product route is Swift Orion -> OpenClaw -> the TypeScript ORION
Control validator/controller/executors. The modules directly under `orion/*.py`
are a legacy compatibility runtime. ORION v2 Core must not make every live turn
cross into a second Python process merely because the manifest uses the logical
path `orion/core`.

Phase 1 therefore treats the JSON Schemas in `orion/core/schemas` as the
language-neutral contract. The Python dataclasses are executable reference
validators and compatibility fixtures, not a new production orchestrator.
TypeScript and Swift adapters must preserve the same closed fields, schema
version, identifiers, timestamps, and enum vocabularies.

## Active integration seam

The first live slice remains only `system_status` and must be default-off. It
will preserve these existing authorities:

1. OpenClaw host provenance authenticates the real user turn.
2. `authorizeTaskGraph` discards caller-supplied trust.
3. the ORION Control catalog and validator decide whether the action is allowed;
4. the existing ambient executor performs the read;
5. the existing controller verifies and appends the durable ledger row.

The v2 adapter may translate request/result envelopes around those steps. It
must not replace them, call Python, add another model turn, accept a second
capability, or change visible output.

## Exact coordinated files

Do not edit these while the shared plugin worktree is dirty or another agent
owns it:

- `plugin/orion-control/src/index.ts` — default-off config flag and
  envelope translation at the single authorized-graph route;
- `plugin/orion-control/openclaw.plugin.json` — declare that flag;
- new TypeScript contract/adapter files under `src/v2/`;
- focused TypeScript parity tests plus the existing full plugin suite.

No native Swift file is required for the first slice because GatewayClient's
request and visible result stay unchanged. Rollback is setting the flag false.

## Entry proof already available

`orion/mac/system_status_adapter.py` and
`tests/test_v2_compatibility_contract.py` prove the strict mapping with
sanitized fixtures. The canonical-schema tests fail if the Python reference
vocabularies drift from the language-neutral schemas.
