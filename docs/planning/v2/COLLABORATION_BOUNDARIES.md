# ORION v2 collaboration boundaries

Recorded 2026-08-18. These boundaries protect the current shared dirty
worktree while Nick may have Claude working on the native Mac UI.

## Codex-owned lane

Codex may create or update these paths without coordinating individual files:

- `docs/planning/v2/**`
- `orion/core/**`, `orion/shared/**`, and other new manifest modules only after
  the preceding phase gate passes
- `scripts/orion_v2_*`
- `tests/test_v2_*` and `tests/test_phase0_*`

All v2 foundation changes stay additive until an integration gate explicitly
authorizes an adapter. New Core code must not import Swift/native code,
OpenClaw internals, model SDKs, or legacy runtime implementations.

## Claude or Nick-owned lane

Codex treats these currently dirty paths as read-only unless Nick explicitly
coordinates an integration change:

- `native/Orion/**`
- `native/OrionMacBridge/**`
- existing files under `plugin/orion-control/**`
- existing `scripts/orion-*` files that do not start with `orion_v2_`
- root `HANDOFF.md`, `HANDOFF.md`, and `HANDOFF.md`

This includes `AppState.swift`, `GatewayClient.swift`, SwiftUI views,
`SessionDomain`, and `SessionService`. SessionService remains the sole
focus-session state/history writer.

## Shared read-only surfaces

The legacy Python modules directly under `orion/*.py`, installed OpenClaw
state, `.env*`, Keychain, and `/Applications/Orion.app` may be inspected for
contracts and verification but are not edited by v2 foundation work.

## Integration protocol

1. Record the intended adapter and exact existing files in `docs/planning/v2`.
2. Confirm no other agent is editing those files.
3. Start with one adapter behind a default-off compatibility boundary.
4. Run legacy, v2 contract, native, plugin, and live-route regression gates.
5. Keep rollback possible without changing persisted user data.

Until that sequence is complete, the installed Orion app does not import or
execute new ORION Core code. This allows UI work and v2 foundation work to
proceed concurrently without silent behavioral coupling.
