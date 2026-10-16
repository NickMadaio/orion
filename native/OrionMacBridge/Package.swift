// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OrionMacBridge",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "orion-mac-bridge", targets: ["OrionMacBridge"])],
    targets: [
        .executableTarget(name: "OrionMacBridge"),
        .testTarget(name: "OrionMacBridgeTests", dependencies: ["OrionMacBridge"]),
    ]
)
