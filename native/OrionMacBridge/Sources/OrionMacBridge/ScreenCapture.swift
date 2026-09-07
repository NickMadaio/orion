import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

//
//  PHASE 53/54. The FALLBACK observation path -- real pixels, used only when
//  `screen_observe`'s accessibility tree cannot answer the question. Needs
//  Screen Recording, which is a stronger, pixel-carrying grant than
//  Accessibility, so this checks for it explicitly and says exactly what is
//  missing rather than returning a blank or empty image.
//
//  Captures the FRONTMOST WINDOW ONLY, never the full desktop: a full-screen
//  grab risks catching an unrelated window Nick has open (a banking tab
//  behind the one Orion was asked about) that the denylist below never gets
//  a chance to evaluate because it was never asked about that window at all.
//

enum ScreenCaptureError: LocalizedError {
    case screenRecordingNotGranted
    case screenLocked
    case noFrontmostApp
    case noWindow
    case denied(String)
    case captureFailed

    var errorDescription: String? {
        switch self {
        case .screenRecordingNotGranted:
            return "Screen Recording is not granted. System Settings > Privacy & Security > Screen Recording, enable the app that runs OpenClaw (Terminal, iTerm, or the OpenClaw gateway process), then relaunch it -- macOS requires a relaunch after granting Screen Recording, not just a retry."
        case .screenLocked:
            return "The screen is locked or nobody is on console. Orion will not capture screen content while nobody can see what it captures."
        case .noFrontmostApp:
            return "No frontmost application could be read."
        case .noWindow:
            return "The frontmost application has no on-screen window to capture."
        case .denied(let reason):
            return "Refused: \(reason)"
        case .captureFailed:
            return "The screenshot could not be produced."
        }
    }
}

struct ScreenCaptureResult: Encodable {
    let path: String
    let width: Int
    let height: Int
    let appName: String
    let bundleID: String
    let windowTitle: String?

    enum CodingKeys: String, CodingKey {
        case path, width, height
        case appName = "app_name"
        case bundleID = "bundle_id"
        case windowTitle = "window_title"
    }
}

enum ScreenCapture {

    /// Where captures land. Its own directory under Orion's controlled root,
    /// not Desktop and not /tmp -- /tmp does not survive a reboot and Desktop
    /// is a place Nick looks, which a silent screenshot store should not be.
    static func captureRoot() -> URL {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw/orion-controlled/screen-captures", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    static func isGranted() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    /// Best-effort: this itself may show the system prompt once. It never
    /// silently substitutes a screenshot for permission -- if this returns
    /// false, `capture()` still throws rather than trying anyway.
    @discardableResult
    static func requestAccess() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    private static func frontmostWindowID(pid: pid_t) -> (id: CGWindowID, bounds: CGRect)? {
        let listing = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID,
        ) as? [[String: Any]] ?? []
        for entry in listing {
            guard (entry[kCGWindowOwnerPID as String] as? pid_t) == pid,
                  (entry[kCGWindowLayer as String] as? Int) == 0,
                  let number = entry[kCGWindowNumber as String] as? CGWindowID else { continue }
            // `kCGWindowBounds` is a CFDictionary of NSNumbers, not a
            // `[String: CGFloat]` -- casting it directly as one fails at
            // runtime and was measured doing exactly that (screen_capture
            // reported "no on-screen window" against a real, visible Notes
            // window). `CGRectMakeWithDictionaryRepresentation` is the
            // documented way to decode it.
            var bounds = CGRect.zero
            if let boundsDict = entry[kCGWindowBounds as String] as? NSDictionary {
                CGRectMakeWithDictionaryRepresentation(boundsDict as CFDictionary, &bounds)
            }
            return (number, bounds)
        }
        return nil
    }

    static func capture() throws -> ScreenCaptureResult {
        guard isGranted() else { throw ScreenCaptureError.screenRecordingNotGranted }
        guard !ScreenPrivacy.isScreenLockedOrAsleep() else { throw ScreenCaptureError.screenLocked }
        guard let front = ScreenObserve.frontmostApp() else { throw ScreenCaptureError.noFrontmostApp }
        guard let window = frontmostWindowID(pid: front.pid) else { throw ScreenCaptureError.noWindow }

        // Window title needs Accessibility to read honestly (see
        // ScreenObserve.swift); when it is unavailable here, the denylist
        // still runs on the bundle id alone -- narrower coverage, never
        // wider permission.
        let windowTitle: String? = AXIsProcessTrusted()
            ? {
                let appElement = AXUIElementCreateApplication(front.pid)
                var value: CFTypeRef?
                guard AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &value) == .success,
                      let element = value, CFGetTypeID(element) == AXUIElementGetTypeID() else { return nil }
                var titleValue: CFTypeRef?
                // swiftlint:disable:next force_cast
                guard AXUIElementCopyAttributeValue((element as! AXUIElement), kAXTitleAttribute as CFString, &titleValue) == .success else {
                    return nil
                }
                return titleValue as? String
            }()
            : nil

        if ScreenPrivacy.isDenied(bundleID: front.bundleID, windowTitle: windowTitle) {
            throw ScreenCaptureError.denied(
                "\(front.name)\(windowTitle.map { " (\($0))" } ?? "") matches the sensitive-content denylist and cannot be captured.",
            )
        }

        guard let image = CGWindowListCreateImage(
            .null, .optionIncludingWindow, window.id, [.boundsIgnoreFraming, .bestResolution],
        ) else {
            throw ScreenCaptureError.captureFailed
        }

        let filename = "\(UUID().uuidString).png"
        let fileURL = captureRoot().appendingPathComponent(filename)
        guard let destination = CGImageDestinationCreateWithURL(
            fileURL as CFURL, UTType.png.identifier as CFString, 1, nil,
        ) else {
            throw ScreenCaptureError.captureFailed
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw ScreenCaptureError.captureFailed }

        return ScreenCaptureResult(
            path: fileURL.path,
            width: image.width,
            height: image.height,
            appName: front.name,
            bundleID: front.bundleID,
            windowTitle: windowTitle,
        )
    }
}
