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
        // The pure session domain: models, reducer, reconcile(now:), clocks.
        // No AppKit, no SwiftUI, no file I/O, no network — which is what makes
        // it testable against DST, sleep and a dragged system clock. Kept a
        // separate target rather than a folder so that constraint is enforced
        // by the compiler instead of by good intentions.
        .target(
            name: "SessionDomain",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        ),
        .executableTarget(
            name: "Orion",
            dependencies: ["SessionDomain"],
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
        ),
        // `path` is explicit because Tests/ is not only a SwiftPM directory —
        // it also holds the standalone harnesses (LayoutHarness, RaceHarness,
        // AudioMatrix) that are compiled by their own run-*.sh scripts against
        // the real app sources. Naming the path keeps SwiftPM's attention on
        // this one directory and off theirs.
        .testTarget(
            name: "SessionDomainTests",
            dependencies: ["SessionDomain"],
            path: "Tests/SessionDomainTests",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        )
    ]
)
