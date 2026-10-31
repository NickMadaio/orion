import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import Vision

//
//  2026-10-30. The ACCESSIBILITY half of control: press an element, set a
//  field's value, pick a menu item, list a menu, and read the window's pixels
//  as text (on-device Vision OCR, nothing leaves the Mac). Synthesized clicks
//  and keystrokes (ScreenControl.swift) land wherever the cursor or focus
//  happens to be; an AX action lands on the element it names or fails. The
//  plugin's computer loop prefers these and keeps coordinate clicks as the
//  fallback.
//
//  Same guards as ScreenControl: Accessibility trusted, screen unlocked,
//  frontmost app is the one the caller named, and nothing on the
//  sensitive-content denylist. On top of that, an element is addressed by the
//  child-index path the caller read from `screen_observe` AND the role (and
//  label, when it had one) it saw there: if the live element at that path is
//  not what was observed, the action is refused as stale rather than landing
//  on whatever moved into that slot.
//

enum ScreenActError: LocalizedError {
    case badPath(String)
    case stale(expected: String, found: String)
    case secureField
    case actionFailed(String, Int32)
    case menuNotFound(String)
    case menuDisabled(String)
    case ocrFailed

    var errorDescription: String? {
        switch self {
        case .badPath(let path):
            return "No element at path '\(path)' in the focused window."
        case .stale(let expected, let found):
            return "The element changed since it was observed: expected \(expected), found \(found). Refusing rather than acting on the wrong element."
        case .secureField:
            return "Refused: that is a secure (password) field."
        case .actionFailed(let action, let code):
            return "The app refused \(action) (AX error \(code))."
        case .menuNotFound(let path):
            return "No menu item '\(path)' in the frontmost app's menu bar."
        case .menuDisabled(let path):
            return "The menu item '\(path)' is disabled right now."
        case .ocrFailed:
            return "Text recognition failed on the window image."
        }
    }
}

enum ScreenAct {

    // Mirrors ScreenObserve's walker bound, so index i here is index i there.
    private static let maxChildrenPerNode = 40

    private static func string(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private static func element(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
              let raw = value, CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
        // swiftlint:disable:next force_cast
        return (raw as! AXUIElement)
    }

    private static func children(_ element: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
              let list = value as? [AXUIElement] else { return [] }
        return list
    }

    private static func label(_ element: AXUIElement) -> String? {
        string(element, kAXTitleAttribute as String) ?? string(element, kAXDescriptionAttribute as String)
    }

    private static func focusedWindow(_ app: AXUIElement) -> AXUIElement? {
        if let window = element(app, kAXFocusedWindowAttribute as String) { return window }
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
              let windows = value as? [AXUIElement] else { return nil }
        return windows.first
    }

    /// "" is the window itself, "0.3.1" its first child's fourth child's second child, and
    /// "focused" the app's focused element (for "type into whatever has focus").
    private static func resolve(pid: pid_t, path: String) throws -> AXUIElement {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 1.5)
        if path == "focused" {
            guard let focused = element(app, kAXFocusedUIElementAttribute as String) else { throw ScreenActError.badPath(path) }
            return focused
        }
        guard var current = focusedWindow(app) else { throw ScreenActError.badPath(path) }
        let parts = path.isEmpty ? [] : path.split(separator: ".").map { Int($0) }
        for part in parts {
            guard let index = part, index >= 0, index < maxChildrenPerNode else { throw ScreenActError.badPath(path) }
            let kids = children(current)
            guard index < kids.count else { throw ScreenActError.badPath(path) }
            current = kids[index]
        }
        return current
    }

    /// The observed role (and label, when there was one) must still be what is there.
    private static func checkIdentity(_ element: AXUIElement, role: String, label expected: String?) throws {
        let liveRole = string(element, kAXRoleAttribute as String) ?? "AXUnknown"
        let liveLabel = label(element)
        let roleOK = role.isEmpty || liveRole == role
        let labelOK = (expected ?? "").isEmpty || liveLabel == expected
        guard roleOK && labelOK else {
            throw ScreenActError.stale(expected: "\(role) '\(expected ?? "")'", found: "\(liveRole) '\(liveLabel ?? "")'")
        }
    }

    private static func target(_ payload: [String: String], expectedBundleID: String) throws -> (AXUIElement, String) {
        let front = try ScreenControl.guardFrontmost(expectedBundleID: expectedBundleID)
        let path = payload["path"] ?? ""
        let element = try resolve(pid: front.pid, path: path)
        if path != "focused" {
            try checkIdentity(element, role: payload["role"] ?? "", label: payload["label"])
        }
        return (element, front.name)
    }

    static func press(payload: [String: String], expectedBundleID: String) throws -> [String: String] {
        let (element, appName) = try target(payload, expectedBundleID: expectedBundleID)
        let action = payload["ax_action"] ?? (kAXPressAction as String)
        // Only the actions a person's single click or scroll gesture stands for.
        let allowed: Set<String> = [kAXPressAction as String, kAXRaiseAction as String, kAXPickAction as String,
                                    "AXScrollDownByPage", "AXScrollUpByPage", kAXConfirmAction as String]
        guard allowed.contains(action) else { throw BridgeError.invalidRequest("ax_action '\(action)' is not allowed.") }
        let code = AXUIElementPerformAction(element, action as CFString)
        guard code == .success else { throw ScreenActError.actionFailed(action, code.rawValue) }
        return ["app_name": appName, "pressed": action]
    }

    static func setValue(payload: [String: String], expectedBundleID: String) throws -> [String: String] {
        let (element, appName) = try target(payload, expectedBundleID: expectedBundleID)
        let role = string(element, kAXRoleAttribute as String)
        let subrole = string(element, kAXSubroleAttribute as String)
        guard !ScreenPrivacy.isSecureRole(role: role, subrole: subrole) else { throw ScreenActError.secureField }
        let value = payload["value"] ?? ""
        _ = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        let code = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString)
        guard code == .success else { throw ScreenActError.actionFailed("set value", code.rawValue) }
        return ["app_name": appName, "set_chars": String(value.count)]
    }

    private static func menuBar(pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 1.5)
        return element(app, kAXMenuBarAttribute as String)
    }

    private static func normalise(_ title: String) -> String {
        title.lowercased().replacingOccurrences(of: "…", with: "").replacingOccurrences(of: "...", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    /// The AXMenu under a menu bar item or a submenu item.
    private static func submenu(of item: AXUIElement) -> AXUIElement? {
        children(item).first { string($0, kAXRoleAttribute as String) == (kAXMenuRole as String) }
    }

    private static func find(_ title: String, in container: AXUIElement) -> AXUIElement? {
        let wanted = normalise(title)
        return children(container).first { label($0).map(normalise) == wanted }
    }

    /// "File>New" presses File → New. Titles match case-insensitively, ignoring a trailing ellipsis.
    static func menu(payload: [String: String], expectedBundleID: String) throws -> [String: String] {
        let front = try ScreenControl.guardFrontmost(expectedBundleID: expectedBundleID)
        let path = payload["menu_path"] ?? ""
        let parts = path.split(separator: ">").map { String($0).trimmingCharacters(in: .whitespaces) }
        guard parts.count >= 2, var container = menuBar(pid: front.pid) else { throw ScreenActError.menuNotFound(path) }
        var item: AXUIElement?
        for (index, part) in parts.enumerated() {
            guard let found = find(part, in: container) else { throw ScreenActError.menuNotFound(path) }
            item = found
            if index < parts.count - 1 {
                guard let next = submenu(of: found) else { throw ScreenActError.menuNotFound(path) }
                container = next
            }
        }
        guard let target = item else { throw ScreenActError.menuNotFound(path) }
        var enabled: CFTypeRef?
        if AXUIElementCopyAttributeValue(target, kAXEnabledAttribute as CFString, &enabled) == .success,
           (enabled as? Bool) == false {
            throw ScreenActError.menuDisabled(path)
        }
        let code = AXUIElementPerformAction(target, kAXPressAction as CFString)
        guard code == .success else { throw ScreenActError.actionFailed("menu \(path)", code.rawValue) }
        return ["app_name": front.name, "menu_path": path]
    }

    /// The item titles of one top-level menu ("Window"), so a caller can match "the econ window" fuzzily.
    static func menuItems(payload: [String: String], expectedBundleID: String) throws -> [String: String] {
        let front = try ScreenControl.guardFrontmost(expectedBundleID: expectedBundleID)
        let name = payload["menu"] ?? ""
        guard let bar = menuBar(pid: front.pid), let top = find(name, in: bar), let menu = submenu(of: top) else {
            throw ScreenActError.menuNotFound(name)
        }
        let titles = children(menu).compactMap { label($0) }.filter { !$0.isEmpty }.prefix(80)
        let data = try JSONEncoder().encode(Array(titles))
        return ["app_name": front.name, "items_json": String(data: data, encoding: .utf8) ?? "[]"]
    }

    /// Window pixels → text lines, on device. Same refusals as screen_capture; no file is written.
    static func ocr() throws -> [String: String] {
        let (image, front, windowTitle) = try ScreenCapture.captureImage()
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        do {
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        } catch {
            throw ScreenActError.ocrFailed
        }
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.prefix(300)
        let data = try JSONEncoder().encode(Array(lines))
        return [
            "app_name": front.name,
            "bundle_id": front.bundleID,
            "window_title": windowTitle ?? "",
            "lines_json": String(data: data, encoding: .utf8) ?? "[]",
        ]
    }
}
