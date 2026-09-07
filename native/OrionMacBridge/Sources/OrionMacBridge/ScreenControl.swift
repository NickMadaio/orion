import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation

//
//  PHASE 53. The MUTATING half: click, type, key. Everything a person at the
//  keyboard could do, which is exactly why this file does the LEAST amount of
//  independent judgment of anything in this bridge -- the gate that matters
//  is the plugin's approval requirement and NEVER_DEMOTED_TIERS, not this
//  file. What this file adds is the checks a gate one process away cannot
//  make for itself:
//
//    - refuse while the screen is locked (nobody is sitting at the keyboard
//      to notice something wrong);
//    - refuse a denylisted app or window, same list `ScreenPrivacy` already
//      uses for observation -- typing into 1Password is not safer than
//      reading from it;
//    - refuse to act on an app OTHER than the one the caller named, so a
//      step planned against one frontmost app cannot silently land on
//      whatever became frontmost between planning and execution.
//

enum ScreenControlError: LocalizedError {
    case accessibilityNotTrusted
    case screenLocked
    case noFrontmostApp
    case appMismatch(expected: String, actual: String)
    case denied(String)
    case elementNotFound
    case unknownKey(String)

    var errorDescription: String? {
        switch self {
        case .accessibilityNotTrusted:
            return "Accessibility is not granted. System Settings > Privacy & Security > Accessibility, enable the app that runs OpenClaw, then retry."
        case .screenLocked:
            return "The screen is locked. Orion will not synthesize input while nobody can see what it does."
        case .noFrontmostApp:
            return "No frontmost application could be read."
        case .appMismatch(let expected, let actual):
            return "The frontmost app changed: expected bundle id '\(expected)', found '\(actual)'. Refusing rather than acting on the wrong app."
        case .denied(let reason):
            return "Refused: \(reason)"
        case .elementNotFound:
            return "No matching accessibility element was found to click."
        case .unknownKey(let key):
            return "Unrecognized key name '\(key)'."
        }
    }
}

enum ScreenControl {

    /// The checks every control action shares, before it does anything
    /// app-specific. `expectedBundleID` is required, never optional -- a
    /// caller that has not observed the screen has nothing to name, and
    /// naming nothing is not an allowed spelling of "click something".
    private static func guardFrontmost(expectedBundleID: String) throws -> (pid: pid_t, name: String, bundleID: String) {
        guard AXIsProcessTrusted() else { throw ScreenControlError.accessibilityNotTrusted }
        guard !ScreenPrivacy.isScreenLockedOrAsleep() else { throw ScreenControlError.screenLocked }
        guard let front = ScreenObserve.frontmostApp() else { throw ScreenControlError.noFrontmostApp }
        guard front.bundleID == expectedBundleID else {
            throw ScreenControlError.appMismatch(expected: expectedBundleID, actual: front.bundleID)
        }
        // Window title needs a fresh AX read -- do not trust one collected
        // earlier by the caller, which could be stale by the time this runs.
        let appElement = AXUIElementCreateApplication(front.pid)
        var windowTitle: String?
        var value: CFTypeRef?
        if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &value) == .success,
           let element = value, CFGetTypeID(element) == AXUIElementGetTypeID() {
            var titleValue: CFTypeRef?
            // swiftlint:disable:next force_cast
            if AXUIElementCopyAttributeValue((element as! AXUIElement), kAXTitleAttribute as CFString, &titleValue) == .success {
                windowTitle = titleValue as? String
            }
        }
        if ScreenPrivacy.isDenied(bundleID: front.bundleID, windowTitle: windowTitle) {
            throw ScreenControlError.denied(
                "\(front.name)\(windowTitle.map { " (\($0))" } ?? "") matches the sensitive-content denylist and cannot be controlled.",
            )
        }
        return front
    }

    // MARK: - Click

    struct ClickResult: Encodable {
        let clickedX: Double
        let clickedY: Double
        let appName: String
        enum CodingKeys: String, CodingKey {
            case clickedX = "clicked_x"
            case clickedY = "clicked_y"
            case appName = "app_name"
        }
    }

    static func click(expectedBundleID: String, x: Double, y: Double) throws -> ClickResult {
        let front = try guardFrontmost(expectedBundleID: expectedBundleID)
        let point = CGPoint(x: x, y: y)
        guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
              let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
            throw ScreenControlError.elementNotFound
        }
        down.post(tap: .cghidEventTap)
        usleep(30_000)
        up.post(tap: .cghidEventTap)
        return ClickResult(clickedX: x, clickedY: y, appName: front.name)
    }

    // MARK: - Type

    struct TypeResult: Encodable {
        let typedChars: Int
        let appName: String
        enum CodingKeys: String, CodingKey {
            case typedChars = "typed_chars"
            case appName = "app_name"
        }
    }

    /// Posted as Unicode text on a keyboard event, not resolved through a
    /// keycode table -- this is what lets it type any character a `String`
    /// can hold without a per-language keymap, the same approach
    /// `NSEvent`/`CGEvent` keyboard-Unicode input is designed for.
    static func type(expectedBundleID: String, text: String) throws -> TypeResult {
        let front = try guardFrontmost(expectedBundleID: expectedBundleID)
        for scalar in Array(text.utf16).chunked(into: 20) {
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
                throw ScreenControlError.elementNotFound
            }
            down.keyboardSetUnicodeString(stringLength: scalar.count, unicodeString: scalar)
            down.post(tap: .cghidEventTap)
            up.keyboardSetUnicodeString(stringLength: scalar.count, unicodeString: scalar)
            up.post(tap: .cghidEventTap)
            usleep(4_000)
        }
        return TypeResult(typedChars: text.count, appName: front.name)
    }

    // MARK: - Key

    struct KeyResult: Encodable {
        let key: String
        let appName: String
    }

    /// A small, closed table rather than a raw virtual-keycode passthrough.
    /// The catalog validates the argument against this same set of names, so
    /// "press whatever keycode 96 is on your keyboard" is not an expressible
    /// request -- only names a person would recognise are.
    static let keyCodes: [String: CGKeyCode] = [
        "return": 36, "tab": 48, "space": 49, "delete": 51, "escape": 53,
        "left": 123, "right": 124, "down": 125, "up": 126,
        "cmd+a": 0, "cmd+c": 8, "cmd+v": 9, "cmd+x": 7, "cmd+z": 6,
    ]

    static func key(expectedBundleID: String, name: String) throws -> KeyResult {
        let front = try guardFrontmost(expectedBundleID: expectedBundleID)
        guard let code = keyCodes[name] else { throw ScreenControlError.unknownKey(name) }
        let flags: CGEventFlags = name.hasPrefix("cmd+") ? .maskCommand : []
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
            throw ScreenControlError.elementNotFound
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        usleep(10_000)
        up.post(tap: .cghidEventTap)
        return KeyResult(key: name, appName: front.name)
    }
}

private extension Array {
    /// UniChar buffers for `keyboardSetUnicodeString`, split so no single
    /// event is asked to carry more than a bounded run of characters.
    func chunked(into size: Int) -> [[UniChar]] where Element == UniChar {
        guard size > 0 else { return [self] }
        var result: [[UniChar]] = []
        var index = 0
        while index < count {
            let end = Swift.min(index + size, count)
            result.append(Array(self[index..<end]))
            index = end
        }
        return result
    }
}
