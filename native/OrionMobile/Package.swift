// swift-tools-version: 6.0
import PackageDescription

// OrionMobile — the iPhone app's brain, and nothing that needs a screen.
//
// The platform line names BOTH macOS and iOS. It said macOS alone, with a
// paragraph here explaining that "there is no Xcode on this machine, so there is
// no iOS SDK". That was true when it was written and stopped being true on
// 2026-08-25: Xcode 26.6 is installed, the global `xcode-select` deliberately
// still points at Command Line Tools, and `scripts/orion_v2_mobile_check.sh`
// builds this package for the iOS simulator on every run using a per-command
// DEVELOPER_DIR. The comment outlived the fact by three days and sat four lines
// above `.iOS(.v17)`, contradicting it.
//
// MobileCore imports no platform framework at all -- the same discipline
// native/Orion applies to SessionDomain, and for the same reason. That is now
// enforced two ways: the iOS build fails on a platform-EXCLUSIVE import like
// AppKit, and MobileCoreCheck scans every source (recursively) and fails on any
// import other than Foundation, which is what catches SwiftUI, Security and
// UserNotifications -- frameworks that exist on both platforms and so compile
// perfectly happily.
//
// The SwiftUI Simulator shell lives in App/ and OrionMobile.xcodeproj. It links
// this package and keeps example data explicitly separate from a live account.
// A platform device-key adapter lives in the app; production pairing, token
// storage and push registration remain unimplemented. MobileCoreCheck is a portable executable by choice; XCTest UI
// tests for the phone shell live in AppUITests/ and run with Xcode.
let package = Package(
    name: "OrionMobile",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "MobileCore", targets: ["MobileCore"]),
        // Jakub Antalik's thinking orbs (MIT, vendored from Libraries.dev at
        // c1e1926; LICENSE beside the sources). The SwiftUI orb ORION's
        // hologram is built around, on the phone and the Mac.
        .library(name: "ThinkingOrbsKit", targets: ["ThinkingOrbsKit"]),
        // Self-contained SwiftUI screens shared by the Mac and the phone. Kept
        // out of native/Orion so the local agent can build them (that tree is
        // refused to it: signing, Sparkle and LOCK live there).
        .library(name: "OrionViews", targets: ["OrionViews"]),
    ],
    targets: [
        .executableTarget(name: "TodayPlanExport", dependencies: ["MobileCore"]),
        .testTarget(name: "TodayReadTests", dependencies: ["MobileCore"]),
        // One test file per task from the local agent's plans (each task owns its file).
        .testTarget(name: "AgentTasksTests", dependencies: ["MobileCore", "OrionViews"]),
        .target(name: "OrionViews", dependencies: ["MobileCore", "ThinkingOrbsKit"],
                swiftSettings: [.swiftLanguageMode(.v5)]),
        .target(name: "ThinkingOrbsKit", exclude: ["LICENSE"]),
        .target(
            name: "MobileCore",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "MobileCoreCheck",
            dependencies: ["MobileCore"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
