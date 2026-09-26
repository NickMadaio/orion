# Phase 65: App Intents and System Integration — Implementation Packet

## Baseline
- **Inspected source paths**: `native/OrionMobile/Sources/MobileCore/SecurityControls.swift`, `docs/planning/v2/MANIFEST_PHASES.json`.
- **Limits**: No iOS app target modifications allowed unattended due to designated-requirement/TCC risks. Native Swift checks not registered in local worker; evidence relies on source inspection and existing test counts where applicable.
- **Worktree baseline**: Commit 9855d99 (2026-09-26).

## Requirement matrix

| ID | Status | Evidence / Source Symbol | Notes |
|----|--------|--------------------------|-------|
| `do_not_build_before_underlying_actions_are_stable` | Built | Manifest evidence states Phase 57 landed and strictness ladder stabilized. No new code required for this negative requirement. | Honoured by phase ordering. |
| `adds_ask_add_start_focus_whats_my_day_run_automation_and_lock` | Not yet proven | `lockOrion()` exists in `SecurityControls.swift`. `startFocusSession`, `whatsMyDay`, `runApprovedAutomation`, `askOrion` have zero source matches. | Blocked by bundle identity risk (TCC/Keychain) if Xcode targets are modified unattended. |
| `exposes_through_siri_shortcuts_widgets_and_control_center` | Not yet proven | No AppIntent, WidgetKit, or ActivityKit symbols found in `native/`. | Blocked by bundle identity risk; requires Nick at keyboard for Xcode project changes. |

## Architecture and interfaces
- **Producer**: Swift AppIntents framework (iOS/macOS) — not yet implemented in source.
- **Consumer**: ORION native client (`native/OrionMobile/Sources/MobileCore`).
- **Seam**: Proposed seam between AppIntent handlers and existing action execution layer (`SessionService` or `plugin/orion-control`). Currently no seam exists; intents would need to bridge to existing Swift domain models.
- **State ownership**: TCC grants and Keychain items bound to bundle designated requirement; must not change unattended.
- **Errors**: Bundle ID mismatch, TCC denial, missing intent handler registration.

## Smallest next slice
- **Blocker**: Adding AppIntents targets changes the app bundle's designated requirement, risking all TCC grants and Keychain items. This requires Nick at the keyboard.
- **Proposed contract**: None yet; blocked by identity constraint until reconnaissance confirms if a non-bundle-changing seam exists (e.g., via existing extension target or separate binary).
- **Reconnaissance needed**: Verify if `native/Orion.xcodeproj` already contains an AppIntents target that can be extended without changing the main app bundle ID.

## Test scenarios
- **Positive case**: User invokes "Ask ORION" via Siri; intent resolves to `SessionService.ask()`; response returned. (Not yet implemented)
- **Failure case**: Intent invoked but underlying action service unavailable; expected outcome: graceful error message, no crash, durable state unchanged.
- **Injectable seam**: Mock `AppIntent` handler returning failure; verify consumer handles error without retrying unsafe actions.
- **Existing suite**: `native/OrionMobile/Sources/MobileCoreCheck/main.swift` contains tests for `SecurityControls` including `lockOrion()`. Command not registered locally, proposed for reviewer-run validation.

## Gates and handoff
- **Entry gate**: Phase 64 complete (entrySatisfied: true per brief).
- **Remaining hands-on proof**: Nick must approve any Xcode project changes that affect the bundle ID or designated requirement.
- **Rollback**: Revert Xcode project changes; restore previous bundle signature if TCC grants are lost.
- **Reviewer handoff**: Verify cited symbols exist at baseline; confirm proposed scopes do not expand authority beyond local-first constraints.
