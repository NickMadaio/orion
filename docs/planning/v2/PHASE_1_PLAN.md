# ORION v2 Phase 1 — additive module-boundary plan

Status: **complete — 2026-08-20**, against the exit criteria at the bottom of
this file. Phase 0 exit gates passed on 2026-08-19. All five test-gated slices
below are done, including the coordinated default-off live integration.

The manifest's own one-line exit gate ("Existing desktop ORION must run through
ORION Core") is *not* met and was closed as an acknowledged deviation; see
`PHASE_GATES.json` and `HANDOFF.md`.

## Slice 5 evidence — the live integration, 2026-08-20

- TypeScript contracts and adapter under
  `openclaw-plugins/orion-control/src/v2/`, a default-`false`
  `enableV2SystemStatusAdapter` flag, and the single wrapped `system_status`
  route in `src/index.ts`.
- The bridge **fails open**: a contract violation records `contractError`, warns
  through the host logger, and returns the legacy record untouched. It was
  originally fail-closed, which let it refuse a `system_status` call the legacy
  catalog accepts (`requiredArguments: []`). Two host-seam parity tests now
  cover the happy path and the widened-argument path.
- ORION Control 144/144, clean `--noEmit` compile, generated metadata validated,
  installed copy byte-identical to the tested build.
- Live: flag-off `orion-6c7fb0773e41c616`, flag-on `orion-26e75dcb764d3884`,
  rollback flag-off `orion-27f07824fc7291f8`. The flag-off and flag-on ledger
  rows are structurally identical with no envelope leakage.
- Rollback is the flag alone. Backups: `.builds/openclaw.json.pre-v2-flag-20260820`
  and `.builds/orion-control-installed-pre-failopen-20260820/`.

## Slices 1-4 evidence — 2026-08-19

- Added inert, collision-free `orion.core`, `orion.shared`, `orion.security`,
  and `orion.mac` package markers.
- Added an AST import firewall covering static and dynamic imports and a
  compatibility assertion that `orion.cloud` still resolves to legacy
  `orion/cloud.py`.
- Added strict schema-v1 proposal, decision, and execution envelopes with
  immutable JSON payloads and fail-closed decoding.
- Added bounded context, model, deterministic policy, authorization-bound tool
  broker, audit, clock, identifier, agent, planning, versioned memory, and
  authorization-bound job protocols. A denied or mismatched proposal cannot
  construct an `AuthorizedAction`, and nested record data is immutable JSON.
- Added canonical language-neutral JSON Schemas plus a strict read-only
  `system_status` compatibility adapter and drift/parity tests.
- Phase 1 contract tests pass 20/20, full Python passes 267/267, ORION Control
  passes 134/134 with a clean no-output TypeScript compile, and native domain/
  service passes 318/318. The redacting working-tree/history secret scan is
  clean and the live OpenClaw audit resolves three refs with no findings.
- A fresh authenticated normal-route smoke passed as task
  `orion-60be9767be2cd6ca`. This proves the unchanged installed path, not the
  still-deferred default-off v2 adapter.

No existing legacy, native, plugin, installed runtime, or UI file was changed
by these Phase 1 slices.

## Objective

Create the manifest's logical modules without moving or rewiring the working
Mac implementation. The first Phase 1 slice is contract-only and remains
dormant until a separately reviewed adapter proves behavioral parity.

```text
orion/
    core/
        runtime/
        agent/
        models/
        context/
        tools/
        permissions/
        memory/
        events/
        jobs/
        schemas/
        docs/planning/
    cloud/
    mac/
    mobile/
    shared/
    security/
```

Tests remain in the repository's existing `tests/` discovery root using the
`test_v2_*.py` prefix. This avoids a second test runner while preserving the
manifest's logical test boundary.

## Dependency rules

The dependency direction is fixed:

```text
shared <- core <- mac/cloud/mobile adapters
                 ^
                 security policy interfaces
```

- `orion.core` is platform-independent and standard-library-only initially.
- `orion.shared` contains versioned value objects and serialization contracts.
- `orion.security` implements deterministic policy primitives; features do not
  invent local permission logic.
- `orion.mac`, `orion.cloud`, and `orion.mobile` implement Core protocols.
- Core never imports native UI, OpenClaw, provider SDKs, Keychain, EventKit,
  HealthKit, filesystem executors, or network clients.
- A model response can propose data only. It cannot directly execute an
  adapter or manufacture authorization.

## Test-gated slices

1. **Package skeleton and import firewall**
   - Add module markers and an automated dependency-boundary test.
   - Prove legacy imports and the installed route remain unchanged.
2. **Versioned shared envelopes**
   - Define identifiers, request metadata, result/error envelopes, and strict
     JSON decoding with unknown-field rejection where security-sensitive.
3. **Core ports**
   - Define protocols for model routing, context construction, tool brokering,
     policy decisions, audit sinks, clocks, and persistence.
   - Provide no concrete Mac/cloud execution.
4. **Compatibility adapter design**
   - Map the existing OpenClaw TaskGraph and SessionService command boundaries
     to Core ports in documentation and tests.
   - Do not edit the live adapters yet.
5. **One default-off read-only integration**
   - Coordinate exact shared files with Nick/Claude first.
   - Route only `system_status` through Core, preserving existing output,
     provenance, verification, and rollback.

## Exact additive file plan

The first four slices may create only these new paths after Phase 0 opens:

```text
orion/core/__init__.py
orion/core/runtime/ports.py
orion/core/agent/ports.py
orion/core/models/ports.py
orion/core/context/ports.py
orion/core/tools/ports.py
orion/core/permissions/ports.py
orion/core/memory/ports.py
orion/core/events/ports.py
orion/core/jobs/ports.py
orion/core/schemas/envelopes.py
orion/core/schemas/proposal.schema.json
orion/core/schemas/decision.schema.json
orion/core/schemas/execution-result.schema.json
orion/core/docs/planning/ports.py
orion/shared/__init__.py
orion/shared/identifiers.py
orion/shared/json_values.py
orion/shared/result.py
orion/security/__init__.py
orion/security/decisions.py
orion/mac/__init__.py
orion/mac/system_status_adapter.py
orion/cloud/__init__.py
orion/mobile/__init__.py
tests/test_v2_import_boundaries.py
tests/test_v2_envelopes.py
tests/test_v2_core_ports.py
tests/test_v2_compatibility_contract.py
tests/test_v2_schema_registry.py
```

Live inspection found a compatibility collision that the manifest-level layout
did not expose: the legacy runtime already owns `orion/cloud.py`. Creating an
`orion/cloud/` package would change how `import orion.cloud` resolves. That
package marker is therefore deferred until a reviewed compatibility adapter or
rename plan exists. The first slice creates only the collision-free
`orion/core`, `orion/shared`, and `orion/security` markers plus its import
firewall test.

Empty packages are not a milestone. Each added port or envelope must have a
consumer-independent contract test. No existing `orion/*.py` file changes in
these slices, and no package initializer may import legacy runtime code for
convenience.

`orion/security/decisions.py` is intentionally deferred to Phase 5 rather than
adding a second, premature permission implementation. The Phase 1 centralized
policy protocol is `orion/core/permissions/ports.py`; features receive its
closed decision envelope and cannot pass a raw proposal to a broker. Empty
`mobile` and collision-prone `cloud` package markers are likewise not counted
as Phase 1 progress.

## Initial contract vocabulary

Phase 1 defines representation and interfaces, not the later concrete router,
context firewall, policy algorithm, broker, event bus, or job engine.

The shared proposal envelope must carry only:

```text
schema_version
proposal_id
correlation_id
source
capability
arguments
created_at
provenance
sensitivity
```

The decision envelope must carry:

```text
schema_version
decision_id
proposal_id
outcome = ALLOW | DENY | REQUIRE_APPROVAL
policy_version
reason_codes
decided_at
expires_at
```

The execution result must carry:

```text
schema_version
execution_id
proposal_id
status
observed_outcome
audit_reference
started_at
finished_at
```

Security-sensitive decoding rejects unknown fields, missing fields, malformed
identifiers, naive datetimes, non-finite numbers, and unsupported schema
versions. Arguments remain opaque data until the Phase 4 capability schema
validates them; Phase 1 must not treat a generic dictionary as authorization.
No envelope contains credentials, provider configuration, executable objects,
callbacks, or ambient process state.

## Core port boundaries

Ports are structural protocols with no platform behavior:

- model port: accepts a bounded context bundle and returns a proposal;
- context port: derives a least-context bundle from an authenticated request;
- policy port: returns a decision and reason codes for a proposal;
- tool broker port: accepts only an authorization-bound action, never raw model
  text;
- audit sink: appends a redacted structured event and returns its reference;
- clock and identifier ports: remove wall-clock and randomness assumptions from
  tests;
- persistence ports: store versioned domain records, not UI or SDK objects.

Later phases supply implementations. Phase 1 supplies no provider SDK adapter,
no subprocess runner, no filesystem access, no network client, and no policy
rule that grants authority.

## Compatibility mapping

| Existing boundary | Phase 1 contract | Ownership during Phase 1 |
|---|---|---|
| OpenClaw model/tool proposal | proposal envelope | adapter reads existing TaskGraph shape; Core does not import plugin code |
| ORION Control validator and permission profile | policy port result | existing enforcement remains authoritative until Phase 5 parity |
| ORION Control fixed executors | tool broker result | existing executor remains unchanged and receives no wider input |
| task/permission/repair ledgers | audit reference | existing ledgers remain durable evidence until Phase 6 migration |
| SessionService typed command socket | Mac adapter port | SessionService remains sole writer; no duplicate session persistence |
| native `GatewayClient` | runtime request/result adapter | native client remains unchanged until the coordinated integration slice |
| legacy Python tool loop | compatibility fixture only | no production rewiring in initial slices |

The compatibility tests use sanitized fixtures derived from these shapes. They
must not import installed OpenClaw state, read live credentials, or start a
gateway.

## Import firewall

An AST-based boundary test walks `orion/core`, `orion/shared`, and
`orion/security`. It fails on imports or dynamic-import strings referencing:

```text
AppKit, SwiftUI, Foundation, EventKit, HealthKit, Security
openclaw, anthropic, ollama, deepgram, elevenlabs
subprocess, osascript, AppleScript
orion.server, orion.mac_bridge, orion.tools
```

Standard-library modules that can perform ambient I/O are not automatically
safe merely because they import successfully. Concrete file, socket, process,
environment, Keychain, and network access belongs behind adapter ports and is
forbidden in Core implementations.

## Default-off integration contract

The fifth slice is the first one allowed to name existing implementation files.
Before it begins, record the exact plugin/native files and confirm no concurrent
editor owns them. The integration must:

1. add a default-off feature flag with no persisted-data migration;
2. translate only the read-only `system_status` action into and out of Core
   envelopes;
3. keep current ORION Control validation, permission, execution, provenance,
   and ledger verification authoritative;
4. produce equivalent user-visible output with the flag off and on;
5. revert by disabling the flag, without uninstalling or rewriting state.

Any attempt to route a second capability, change an approval tier, or edit a
native UI surface is a separate reviewed slice.

## Required checks per slice

```text
uv run python -m unittest discover -s tests -q
uv run python scripts/orion_v2_phase_gate.py --phase 0 --require-open
uv run python scripts/orion_v2_authority_snapshot.py --check
uv run python scripts/orion_v2_secret_inventory.py --check
uv run python scripts/orion_v2_secret_scan.py --root . --history \
  --allowlist docs/planning/v2/secret-scan-allowlist.json
```

The integration slice additionally requires the ORION Control suite/build,
native domain suite/build, standard doctor, and authenticated durable-ledger
smoke. Run timing-sensitive suites separately from the full-history scan.

## Phase 1 evidence

Phase 1 is complete only when:

- boundary tests prove Core has no UI, macOS, cloud, provider, or executor
  imports;
- the existing full Python, ORION Control, and native suites pass;
- the normal installed agent route passes the authenticated `system_status`
  ledger smoke through the Core adapter;
- the adapter can be disabled without data migration or behavior loss;
- the planning record identifies the exact integration commit and rollback.

No empty directory tree or import-only package is sufficient evidence that the
desktop app runs through ORION Core.

**All five were met on 2026-08-20** — see the evidence table in `HANDOFF.md`.
Read the last one carefully before opening Phase 2: what was demonstrated is
that one read-only capability can be observed through the v2 envelopes at zero
cost, not that the desktop app runs through Core. The two are not the same
claim, and only the first one is proven.
