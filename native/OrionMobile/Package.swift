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
// Still missing, and not for want of a toolchain: the SwiftUI layer, an app
// target, a Keychain adapter and push registration. That is work nobody has
// done, which is a weaker excuse than the one this comment used to make.
//
// XCTest and swift-testing both ship with Xcode, so neither is available.
// MobileCoreCheck is an executable that asserts and exits non-zero on failure;
// it was proven to fail before it was trusted.
let package = Package(
    name: "OrionMobile",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "MobileCore", targets: ["MobileCore"]),
    ],
    targets: [
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
