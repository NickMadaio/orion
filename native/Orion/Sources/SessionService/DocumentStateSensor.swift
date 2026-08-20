//
//  Does this app have unsaved work? Asked of macOS, not guessed.
//
//  This is the signal the whole "close distractions by reasoning" feature stands
//  on, so how it is obtained matters more than usual — and finding it took
//  measuring rather than reading, because the obvious answer is wrong:
//
//    • `NSRunningApplication` has NOTHING about document state. No property, no
//      derived flag. That is the API everyone reaches for first and it cannot
//      answer this question at all.
//
//    • The accessibility attribute that sounds right, `AXEdited`, is NOT on the
//      window. Asking a window for it returns -25205 (attribute unsupported) on
//      every app on this Mac, including plain AppKit ones. A design that trusted
//      that would read "no unsaved work" for everything, forever.
//
//    • It IS on the window's CLOSE BUTTON. That is where AppKit publishes the
//      dot it draws in the red button, and it reads true and false correctly —
//      measured against a purpose-built AppKit process with one clean window and
//      one `isDocumentEdited = true` window:
//
//          window 'DirtyDoc' → AXCloseButton → AXEdited = 1
//          window 'CleanDoc' → AXCloseButton → AXEdited = 0
//
//  What this cannot do, stated plainly because the safety argument depends on
//  being honest about it:
//
//    • It needs Accessibility. Without it every app reads `.unknown`, which
//      blocks everything, which is the correct direction to fail in.
//    • Electron apps (VS Code, Slack, Discord) publish no accessibility windows
//      unless their own tree is forced on. They read `.unknown` and are never
//      closed. Measured: `Code` exposes 5 windows to CoreGraphics and 0 to
//      accessibility.
//    • An app that exposes zero windows is ambiguous — it may have none open, or
//      may not be answering. CoreGraphics is asked as a second opinion: no
//      windows in either is genuinely nothing open; windows in one and not the
//      other means the app is not talking, which is `.unknown`.
//

import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import SessionDomain

public protocol DocumentStateSensing: AnyObject {
    /// The state, and how many windows it was derived from.
    func documentState(pid: pid_t) -> (state: DocumentState, readableWindows: Int?)
}

public final class AccessibilityDocumentSensor: DocumentStateSensing {

    /// Bounded on purpose. This runs over every running app at session start,
    /// and an app that is wedged must cost a second, not a session start.
    private let timeout: Float

    public init(timeout: Float = 1.0) {
        self.timeout = timeout
    }

    /// True when macOS will answer accessibility questions at all.
    public static var isAvailable: Bool { AXIsProcessTrusted() }

    public func documentState(pid: pid_t) -> (state: DocumentState, readableWindows: Int?) {
        guard Self.isAvailable else { return (.unknown, nil) }

        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, timeout)

        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value)
        guard error == .success, let windows = value as? [AXUIElement] else {
            return (.unknown, nil)
        }

        guard !windows.isEmpty else {
            // Nothing exposed. Only "no windows" if CoreGraphics agrees; if it
            // sees windows this app has an accessibility tree it is not sharing.
            return Self.hasOnScreenWindows(pid: pid) ? (.unknown, 0) : (.clean, 0)
        }

        var sawUnreadable = false
        for window in windows {
            switch edited(window) {
            case .some(true): return (.edited, windows.count)
            case .some(false): continue
            case .none: sawUnreadable = true
            }
        }
        return (sawUnreadable ? .unknown : .clean, windows.count)
    }

    /// Nil means the window would not say — which is never rounded to false.
    private func edited(_ window: AXUIElement) -> Bool? {
        var button: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXCloseButtonAttribute as CFString,
                                            &button) == .success,
              let raw = button,
              CFGetTypeID(raw) == AXUIElementGetTypeID()
        else { return nil }

        // A window with no close button cannot report a dirty dot, but it also
        // cannot be a document window, so it is treated as unreadable rather
        // than clean. Panels and HUDs land here and cost nothing: an app is only
        // `.edited`/`.clean` on the strength of windows that DID answer.
        var edited: CFTypeRef?
        // swiftlint:disable:next force_cast
        let element = raw as! AXUIElement
        guard AXUIElementCopyAttributeValue(element, kAXEditedAttribute as CFString,
                                            &edited) == .success else { return nil }
        if let flag = edited as? Bool { return flag }
        if let number = edited as? NSNumber { return number.boolValue }
        return nil
    }

    /// Needs no permission: window owner and layer are public metadata. Window
    /// TITLES would need Screen Recording, and are never read here.
    static func hasOnScreenWindows(pid: pid_t) -> Bool {
        let listing = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
        ) as? [[String: Any]] ?? []
        return listing.contains { entry in
            (entry[kCGWindowOwnerPID as String] as? pid_t) == pid
                && (entry[kCGWindowLayer as String] as? Int) == 0
        }
    }
}
