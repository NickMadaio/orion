# ORION v2 Phase 1 — additive module-boundary plan

Status: **planned, not started**. Phase 0 exit gates still control entry.

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
        planning/
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
orion/core/planning/ports.py
orion/shared/__init__.py
orion/shared/identifiers.py
orion/shared/result.py
orion/security/__init__.py
orion/security/decisions.py
orion/mac/__init__.py
orion/cloud/__init__.py
orion/mobile/__init__.py
tests/test_v2_import_boundaries.py
tests/test_v2_envelopes.py
tests/test_v2_core_ports.py
tests/test_v2_compatibility_contract.py
```

Empty packages are not a milestone. Each added port or envelope must have a
consumer-independent contract test. No existing `orion/*.py` file changes in
these slices, and no package initializer may import legacy runtime code for
convenience.

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
  --allowlist planning/v2/secret-scan-allowlist.json
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
