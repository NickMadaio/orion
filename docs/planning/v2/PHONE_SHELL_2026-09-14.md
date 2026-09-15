# Orion phone shell

Updated 2026-09-14 22:22 BST. **Simulator shell: 100%. Connected phone: not yet implemented.**

There is now a real SwiftUI application target at
[native/OrionMobile/OrionMobile.xcodeproj](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/OrionMobile.xcodeproj),
with Today, Plan, ORION, Health and Control tabs. It launches disconnected and
offers an explicitly labeled sample day. Both sample screens use the existing
MobileCore TodayPlanScheduler; no second scheduling engine was introduced.

## Open and work through it

1. Open the Xcode project above, select **OrionPhone**, choose an iPhone Simulator and Run.
2. On Today, select **Explore a sample day**, then open Plan for its timeline.
3. Read [OrionMobileApp.swift](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/App/OrionMobileApp.swift).
4. Follow its scheduler call into [TodayPlanScheduler.swift](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/Sources/MobileCore/TodayPlanScheduler.swift).
5. Read the [UI test](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/AppUITests/PhoneShellTests.swift) and [launch/check instructions](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/README.md).

## Proof

The real app was built, installed and run on iPhone 17 Pro Simulator (iOS 26.5).
One XCTest UI scenario passed through disconnected launch, opt-in sample, Plan
navigation, Control, termination with sample still loaded, relaunch without
sample, reopening and dismissal. Screenshots were exported from the successful
test result and inspected. Existing MobileCore: 693 checks, zero failures; iOS
library compilation passes. Independent source review has no remaining finding.
Source/history secret scan is clean.

The first build failed because the app attempted an inactive simulator
architecture while the package built only the active one; Debug now uses
ONLY_ACTIVE_ARCH. The first UI check expected the wrong priority-ordered task;
the final check matches the scheduler and visible screen. Review also corrected
stale package comments and strengthened the relaunch scenario.

## What this does not prove

No Mac pairing, real Today feed, authentication, network request, durable service,
chat, notification, health read, phone install or remote action is present.
Samples are temporary and use a fixed example day. This satisfies the first
Simulator-shell milestone in the delivery plan, associated with Phases 16/19
and REC-USABLE-CLIENT; it closes no numbered phase or recovery gate.
The Mac remains build232 with its saved plan unchanged.

Next: implement one authenticated read-only Today route, owner-scoped durable
storage, stale/offline display and reconnection before any remote command.
Provider choice and recurring cost remain unselected.

## Verification and rollback

Run `scripts/orion_v2_phone_check.sh` from the repo root. It uses a per-command
Xcode override and an available iPhone Simulator. Test result:
`.builds/phone-shell-check/Logs/Test/Test-OrionPhone-2026.09.14_22-20-10-+0100.xcresult`.
Logs and screenshot exports: `.builds/phone-shell-2026-09-14/`.
Remove only `com.nickmadaio.orion.phone` from the Simulator to undo its install;
no Mac app or external records were modified. Source is checkpointed locally;
no remote push. The unrelated learning-proposals file is excluded.

![Sample Today](/Users/nickmadaio/Documents/Codex/2026-09-07/af/outputs/orion-phone-today.png)
