import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation

//
//  PHASE 53/54. Reading what is on screen through the ACCESSIBILITY tree
//  first, because it is text: cheap to produce, cheap to send, and cheap to
//  redact before it ever leaves the machine. `screen_capture` (pixels) is the
//  fallback in ScreenCapture.swift, used only when AX genuinely cannot answer
//  — the manifest's own ordering, "prefer accessibility metadata over
//  screenshots".
//
//  The walker follows the measuring discipline `DocumentStateSensor.swift`
//  set: bounded (`AXUIElementSetMessagingTimeout`), and a value that will not
//  answer is `nil`, never guessed at.
//

enum ScreenObserveError: LocalizedError {
    case accessibilityNotTrusted
    case screenLocked
    case noFrontmostApp
    case noWindow
    case denied(String)

    var errorDescription: String? {
        switch self {
        case .accessibilityNotTrusted:
            return "Accessibility is not granted. System Settings > Privacy & Security > Accessibility, enable the app that runs OpenClaw (Terminal, iTerm, or the OpenClaw gateway process), then retry."
        case .screenLocked:
            return "The screen is locked or nobody is on console. Orion will not read screen content while nobody can see what it reads."
        case .noFrontmostApp:
            return "No frontmost application could be read."
        case .noWindow:
            return "The frontmost application has no readable window."
        case .denied(let reason):
            return "Refused: \(reason)"
        }
    }
}

struct AXElementNode: Encodable {
    let role: String
    let subrole: String?
    let label: String?
    let value: String?
    let x: Double?
    let y: Double?
    let width: Double?
    let height: Double?
    let children: [AXElementNode]
}

struct ScreenObservation: Encodable {
    let appName: String
    let bundleID: String
    let windowTitle: String?
    let element: AXElementNode?
    let nodeCount: Int
    let truncated: Bool

    enum CodingKeys: String, CodingKey {
        case appName = "app_name"
        case bundleID = "bundle_id"
        case windowTitle = "window_title"
        case element
        case nodeCount = "node_count"
        case truncated
    }
}

enum ScreenObserve {

    /// Bounded on every axis: depth, children per node, and total nodes
    /// across the whole tree. This runs against apps Orion does not control,
    /// and an unbounded walk against a pathological AX tree is a hang, not a
    /// slow answer.
    private static let maxDepth = 6
    private static let maxChildrenPerNode = 40
    private static let maxTotalNodes = 400
    private static let messagingTimeout: Float = 1.5

    static func frontmostApp() -> (pid: pid_t, name: String, bundleID: String)? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              let bundleID = app.bundleIdentifier else { return nil }
        return (app.processIdentifier, app.localizedName ?? bundleID, bundleID)
    }

    private static func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
            return nil
        }
        return value as? String
    }

    private static func pointAttribute(_ element: AXUIElement, _ attribute: String) -> CGPoint? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
              let axValue = value, CFGetTypeID(axValue) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        // swiftlint:disable:next force_cast
        guard AXValueGetValue(axValue as! AXValue, .cgPoint, &point) else { return nil }
        return point
    }

    private static func sizeAttribute(_ element: AXUIElement, _ attribute: String) -> CGSize? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
              let axValue = value, CFGetTypeID(axValue) == AXValueGetTypeID() else { return nil }
        var size = CGSize.zero
        // swiftlint:disable:next force_cast
        guard AXValueGetValue(axValue as! AXValue, .cgSize, &size) else { return nil }
        return size
    }

    private static func children(_ element: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
              let list = value as? [AXUIElement] else { return [] }
        return list
    }

    /// One node, and its children up to the bounds above. `count` is shared
    /// across the whole recursion so the total-node ceiling is enforced tree
    /// -wide, not per branch.
    private static func walk(_ element: AXUIElement, depth: Int, count: inout Int) -> AXElementNode? {
        guard count < maxTotalNodes else { return nil }
        count += 1

        let role = stringAttribute(element, kAXRoleAttribute as String) ?? "AXUnknown"
        let subrole = stringAttribute(element, kAXSubroleAttribute as String)
        let label = stringAttribute(element, kAXTitleAttribute as String)
            ?? stringAttribute(element, kAXDescriptionAttribute as String)

        // The one rule that matters most in this file: a secure field's
        // value is never asked for. Not read-then-discarded -- never
        // requested at all, so there is no code path where the literal
        // characters exist in this process's memory as a String.
        let value: String?
        if ScreenPrivacy.isSecureRole(role: role, subrole: subrole) {
            value = ScreenPrivacy.redactedFieldValue
        } else {
            value = stringAttribute(element, kAXValueAttribute as String)
        }

        let position = pointAttribute(element, kAXPositionAttribute as String)
        let size = sizeAttribute(element, kAXSizeAttribute as String)

        var childNodes: [AXElementNode] = []
        if depth < maxDepth {
            for child in children(element).prefix(maxChildrenPerNode) {
                guard count < maxTotalNodes else { break }
                if let node = walk(child, depth: depth + 1, count: &count) {
                    childNodes.append(node)
                }
            }
        }

        return AXElementNode(
            role: role,
            subrole: subrole,
            label: label,
            value: value,
            x: position.map { Double($0.x) },
            y: position.map { Double($0.y) },
            width: size.map { Double($0.width) },
            height: size.map { Double($0.height) },
            children: childNodes,
        )
    }

    /// The focused window's title, resolved WITHOUT Screen Recording: this is
    /// public accessibility metadata, the same category
    /// `DocumentStateSensor.hasOnScreenWindows` already reads without a
    /// prompt -- window titles are the one exception noted there as needing
    /// a stronger permission when read through CoreGraphics, which is why
    /// this reads them through AX instead.
    private static func focusedWindow(_ app: AXUIElement) -> AXUIElement? {
        var value: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &value) == .success,
           let element = value, CFGetTypeID(element) == AXUIElementGetTypeID() {
            // swiftlint:disable:next force_cast
            return (element as! AXUIElement)
        }
        var windowsValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsValue) == .success,
              let windows = windowsValue as? [AXUIElement], let first = windows.first else {
            return nil
        }
        return first
    }

    static func observe() throws -> ScreenObservation {
        guard AXIsProcessTrusted() else { throw ScreenObserveError.accessibilityNotTrusted }
        guard !ScreenPrivacy.isScreenLockedOrAsleep() else { throw ScreenObserveError.screenLocked }
        guard let front = frontmostApp() else { throw ScreenObserveError.noFrontmostApp }

        let appElement = AXUIElementCreateApplication(front.pid)
        AXUIElementSetMessagingTimeout(appElement, messagingTimeout)

        guard let window = focusedWindow(appElement) else {
            // No window is still a legitimate, non-sensitive answer (e.g. a
            // menu-bar-only app) -- report it rather than throwing, exactly
            // the way `AccessibilityDocumentSensor` treats zero windows.
            if ScreenPrivacy.isDenied(bundleID: front.bundleID, windowTitle: nil) {
                throw ScreenObserveError.denied("\(front.name) is on the denylist and cannot be observed.")
            }
            return ScreenObservation(
                appName: front.name, bundleID: front.bundleID, windowTitle: nil,
                element: nil, nodeCount: 0, truncated: false,
            )
        }

        let windowTitle = stringAttribute(window, kAXTitleAttribute as String)

        // WHOLE-WINDOW refusal happens BEFORE any element is walked. This is
        // the line that makes "refuses observation entirely" true: a denied
        // window produces no tree at all, redacted or otherwise.
        if ScreenPrivacy.isDenied(bundleID: front.bundleID, windowTitle: windowTitle) {
            throw ScreenObserveError.denied(
                "\(front.name)\(windowTitle.map { " (\($0))" } ?? "") matches the sensitive-content denylist and cannot be observed.",
            )
        }

        var count = 0
        let root = walk(window, depth: 0, count: &count)
        return ScreenObservation(
            appName: front.name,
            bundleID: front.bundleID,
            windowTitle: windowTitle,
            element: root,
            nodeCount: count,
            truncated: count >= maxTotalNodes,
        )
    }
}
