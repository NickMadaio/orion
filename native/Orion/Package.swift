// swift-tools-version: 6.0
import PackageDescription

// Orion.app — the native menu-bar assistant.
//
// Deliberately dependency-free: Apple frameworks only. Orion is local-first and
// its face should be too, so nothing here can fail to resolve while offline.
//
// The target opts back into the Swift 5 language mode. The audio taps, the
// AppKit callbacks and the socket reader all hop to the main thread by hand,
// which is the right model for this app but is not something Swift 6 strict
// concurrency can prove. If a future toolchain rejects `.swiftLanguageMode`,
// the older spelling is `.swiftLanguageVersion(.v5)`.
let package = Package(
    name: "Orion",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Orion", targets: ["Orion"])
    ],
    targets: [
        .executableTarget(
            name: "Orion",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Speech"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("CoreGraphics")
            ]
        )
    ]
)
