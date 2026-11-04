// swift-tools-version: 6.0
import PackageDescription

// Orion.app — the native menu-bar assistant.
//
// One dependency, and it is worth being precise about what that costs.
//
// This package was dependency-free on purpose: Orion is local-first and its face
// should be too, so nothing here can fail to resolve while offline. Sparkle is
// the single exception, added when updating the app by hand — rebuild, re-sign,
// copy into /Applications, re-grant whatever macOS decided to forget — stopped
// being a thing one person did occasionally and started being the reason
// improvements did not ship.
//
// The offline principle survives intact, because it was never about the build:
//   · Sparkle is linked at build time. Once resolved, `swift build` works
//     offline like everything else, and Package.resolved pins the exact commit.
//   · Nothing on the LAUNCH path touches it. The update check is deliberately
//     late and off the critical path — see AppDelegate — so a dead network or a
//     dead feed costs nothing at startup.
// What it must never become is a second dependency by habit. This one carries
// its weight; the next one has to argue for itself.
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
        .executable(name: "Orion", targets: ["Orion"]),
        .executable(name: "orion-relay-probe", targets: ["OrionRelayProbe"])
    ],
    dependencies: [
        // Pinned to a major version, not a commit: Sparkle's 2.x line is
        // stable and its security fixes are exactly the ones worth taking
        // automatically. Package.resolved holds the version actually in use.
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.6"),
        // Not a third-party dependency -- this project's own domain layer, by
        // path. It is here so the health privacy boundary reuses the derived
        // vocabulary Phase 32 already built (SleepState, PhysicalRecovery,
        // EnergyState, StressTrend) rather than declaring a second set of enums
        // with the same member names. Two vocabularies that both say "moderate"
        // and drift apart is the failure this codebase is written against.
        //
        // It is also the first real wire between the Mac app and MobileCore,
        // which until now compiled for a simulator and was consumed by nothing
        // but its own check harness.
        .package(path: "../OrionMobile")
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
        // Everything the session needs that touches the world: the state file,
        // the history journal, the cross-process lock and the command socket.
        // Separate from the app so the crash-safety and idempotency rules can be
        // tested directly, which an executable target makes awkward.
        //
        // FileLock lives here rather than in the app because two subsystems now
        // need it — HealthLog and SessionStore — and the lockfile NAME is a
        // cross-language contract. Two copies of that protocol is precisely how
        // it drifts into two locks that exclude nothing.
        .target(
            name: "SessionService",
            dependencies: ["SessionDomain", .product(name: "MobileCore", package: "OrionMobile")],
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        ),
        // The computer relay (2026-10-31): signed screen requests from the plugin, run here
        // under Orion.app's own Accessibility grant. Foundation + CryptoKit only, so the
        // security checks are testable without the app.
        .target(
            name: "ComputerRelay",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // Mouse button remapping (w18): contract types, lookup order, game classifier, shortcut parser.
        // Foundation only, so the rules are tested without IOKit or an event tap.
        .target(
            name: "MouseKit",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // The command palette's pure core (w18): fuzzy ranking, frecency, prefix modes, the calculator and the
        // keyboard-navigation state. Foundation only, so every rule is tested without AppKit.
        // Activity (w19): what he is doing right now. Pure classification, the contract encoder and the write rules;
        // the app-side writer (NSWorkspace, AppleScript, idle) lives in Sources/Orion/Activity.
        .target(
            name: "ActivityKit",
            dependencies: ["MouseKit"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "ActivityKitTests",
            dependencies: ["ActivityKit", "MouseKit"],
            path: "Tests/ActivityKitTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .target(
            name: "PaletteKit",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "PaletteKitTests",
            dependencies: ["PaletteKit"],
            path: "Tests/PaletteKitTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "MouseKitTests",
            dependencies: ["MouseKit"],
            path: "Tests/MouseKitTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // Runs the relay core from a terminal against any directory and bridge binary:
        // the integration proof, and a way to exercise the relay without installing the app.
        .executableTarget(
            name: "OrionRelayProbe",
            dependencies: ["ComputerRelay"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "Orion",
            dependencies: [
                "ActivityKit",
                "ComputerRelay",
                "MouseKit",
                "PaletteKit",
                "SessionDomain",
                "SessionService",
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "MobileCore", package: "OrionMobile"),
                .product(name: "ThinkingOrbsKit", package: "OrionMobile"),
                .product(name: "OrionViews", package: "OrionMobile")
            ],
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Speech"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("IOKit")
            ]
        ),
        // `path` is explicit because Tests/ is not only a SwiftPM directory —
        // it also holds the standalone harnesses (LayoutHarness, RaceHarness,
        // AudioMatrix) that are compiled by their own run-*.sh scripts against
        // the real app sources. Naming the path keeps SwiftPM's attention on
        // this one directory and off theirs.
        .testTarget(
            name: "TodayPlanAppTests",
            dependencies: ["Orion", "PaletteKit", "SessionService", "SessionDomain", .product(name: "MobileCore", package: "OrionMobile")],
            path: "Tests/TodayPlanAppTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "ComputerRelayTests",
            dependencies: ["ComputerRelay"],
            path: "Tests/ComputerRelayTests",
            exclude: ["Fixtures"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "SessionDomainTests",
            dependencies: ["SessionDomain"],
            path: "Tests/SessionDomainTests",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        ),
        .testTarget(
            name: "SessionServiceTests",
            dependencies: ["SessionService", "SessionDomain", .product(name: "MobileCore", package: "OrionMobile")],
            path: "Tests/SessionServiceTests",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        )
    ]
)
