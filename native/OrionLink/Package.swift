// swift-tools-version: 6.0
import PackageDescription

// OrionLink — the Mac side of the phone link (2026-09-28).
//
// LinkCore is the testable part: reading ORION's own state files into the
// shared `LinkSnapshot`, and running a phone command through orion-remote.
// The CloudKit and menu-bar shell is the OrionLink app in OrionLink.xcodeproj,
// which links this package. Foundation only here, so `swift test` covers it.
let package = Package(
    name: "OrionLink",
    platforms: [.macOS(.v14)],
    products: [.library(name: "LinkCore", targets: ["LinkCore"])],
    dependencies: [.package(path: "../OrionMobile")],
    targets: [
        .target(name: "LinkCore", dependencies: [.product(name: "MobileCore", package: "OrionMobile")],
                swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "LinkCoreTests", dependencies: ["LinkCore"], swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
