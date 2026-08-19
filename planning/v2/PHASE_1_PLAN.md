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
