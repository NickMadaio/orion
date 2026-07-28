// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OrionCompanion",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "OrionCompanion", targets: ["OrionCompanion"])],
    targets: [.executableTarget(name: "OrionCompanion", linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("WebKit"), .linkedFramework("ServiceManagement"), .linkedFramework("EventKit"), .linkedFramework("UserNotifications"), .linkedFramework("ApplicationServices")])]
)
