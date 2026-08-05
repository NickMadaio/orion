import AppKit
import Foundation

/*
 How Orion is summoned, and how it leaves.

 Four preferences: whether it listens for its name, how forgiving that listening
 is, which corner it arrives in, and how long it lingers once a turn is over.

 Plain `UserDefaults`, same as the voice provider choice — these are preferences,
 not secrets, and `defaults read com.nickmadaio.orion.app` is how `orion-doctor`
 reads them back.
 */

/// Where the hologram panel appears when something summons it.
enum SummonCorner: String, CaseIterable, Identifiable {
    case topRight
    case topLeft
    case bottomRight
    case bottomLeft
    case center

    var id: String { rawValue }

    var label: String {
        switch self {
        case .topRight: return "Top right"
        case .topLeft: return "Top left"
        case .bottomRight: return "Bottom right"
        case .bottomLeft: return "Bottom left"
        case .center: return "Centre of the screen"
        }
    }

    /// Bottom-left origin for a panel of `size` inside `visible`.
    ///
    /// `visible` is always `NSScreen.visibleFrame`, which is already inset for
    /// the menu bar and the Dock — so a panel placed here can never land under
    /// either of them, on any screen arrangement.
    /// The panel is a 300pt square that only ever draws the disc inscribed in
    /// it, so there is already ~20pt of transparent padding between the frame
    /// edge and any lit pixel. A 22pt margin on top of that put the orb closer
    /// to the middle of the screen than to the corner. 4pt lets it sit in the
    /// corner the way it looks like it should, still clear of the menu bar and
    /// the Dock because `visibleFrame` is already inset for both.
    func origin(for size: NSSize, in visible: NSRect, margin: CGFloat = 4) -> NSPoint {
        let left = visible.minX + margin
        let right = visible.maxX - size.width - margin
        let bottom = visible.minY + margin
        let top = visible.maxY - size.height - margin
        switch self {
        case .topRight: return NSPoint(x: right, y: top)
        case .topLeft: return NSPoint(x: left, y: top)
        case .bottomRight: return NSPoint(x: right, y: bottom)
        case .bottomLeft: return NSPoint(x: left, y: bottom)
        case .center:
            return NSPoint(x: visible.midX - size.width / 2,
                           y: visible.midY - size.height / 2)
        }
    }
}

/// How far a heard word may stray from "Orion" and still count.
///
/// The number is a fraction of the wake word's own length, so it means the same
/// thing regardless of which spelling the recogniser reached for. Against a
/// five-letter target: `strict` allows no substitutions at all, `balanced`
/// allows one, `eager` allows two.
enum WakeSensitivity: String, CaseIterable, Identifiable {
    case strict
    case balanced
    case eager

    var id: String { rawValue }

    var label: String {
        switch self {
        case .strict: return "Strict — only a clear “Orion”"
        case .balanced: return "Balanced"
        case .eager: return "Eager — wakes more, misfires more"
        }
    }

    var tolerance: Double {
        switch self {
        case .strict: return 0.12
        case .balanced: return 0.26
        case .eager: return 0.42
        }
    }
}

enum SummonSettings {

    static let wakeEnabledKey = "OrionWakeWordEnabled"
    static let wakeSensitivityKey = "OrionWakeSensitivity"
    static let cornerKey = "OrionSummonCorner"
    static let autoDismissKey = "OrionAutoDismissSeconds"
    static let brightnessKey = "OrionHologramBrightness"
    static let orbSizeKey = "OrionOrbSize"

    /// Edge length of the square the orb is drawn in.
    ///
    /// Stored rather than fixed for the same reason as `brightness`: how big it
    /// should be depends on the screen it is on and how much of it Nick wants
    /// to give up, and neither is knowable from here. It was a hardcoded 300,
    /// and the restore path actively wrote that value back over any other, so
    /// the panel could not be resized even by editing its saved frame.
    ///
    /// The drawn disc is inscribed in this square, and the panel's hit region
    /// is derived from the same bounds, so the two cannot disagree at any size.
    static let orbSizeRange: ClosedRange<Double> = 160...560
    static let defaultOrbSize: Double = 300

    static var orbSize: Double {
        get {
            let stored = UserDefaults.standard.double(forKey: orbSizeKey)
            guard stored > 0 else { return defaultOrbSize }
            return min(orbSizeRange.upperBound,
                       max(orbSizeRange.lowerBound, stored))
        }
        set {
            UserDefaults.standard.set(
                min(orbSizeRange.upperBound,
                    max(orbSizeRange.lowerBound, newValue)),
                forKey: orbSizeKey
            )
        }
    }

    /// How strongly the projection reads against whatever is behind it.
    ///
    /// A stored setting rather than a constant because "bright enough" is not a
    /// fact about the code, it is a fact about the desktop it happens to be
    /// sitting on — a dark editor and a white document want different numbers,
    /// and the only way to find the right one is to move the slider while
    /// looking at it. It was a compile-time constant, which meant every attempt
    /// to tune it cost a rebuild and a re-grant of Accessibility.
    ///
    /// 1.0 is the original tuning. Default is well above it because the honest
    /// answer to "is it bright enough" has been no twice.
    static var brightness: Double {
        get {
            let stored = UserDefaults.standard.double(forKey: brightnessKey)
            return stored > 0 ? stored : 2.6
        }
        set {
            UserDefaults.standard.set(
                min(4.0, max(0.6, newValue)), forKey: brightnessKey
            )
        }
    }

    /// Off by default, deliberately. An always-on microphone is a decision the
    /// user makes, not one the app makes for them.
    static var wakeEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: wakeEnabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: wakeEnabledKey) }
    }

    static var wakeSensitivity: WakeSensitivity {
        get {
            guard
                let raw = UserDefaults.standard.string(forKey: wakeSensitivityKey),
                let value = WakeSensitivity(rawValue: raw)
            else { return .balanced }
            return value
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: wakeSensitivityKey) }
    }

    static var corner: SummonCorner {
        get {
            guard
                let raw = UserDefaults.standard.string(forKey: cornerKey),
                let value = SummonCorner(rawValue: raw)
            else { return .topRight }
            return value
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: cornerKey) }
    }

    /// Seconds of quiet after a finished turn before the panel withdraws.
    /// Zero means "stay until I dismiss you".
    static let autoDismissChoices: [Double] = [0, 5, 8, 15, 30]
    static let defaultAutoDismiss: Double = 8

    static var autoDismissSeconds: Double {
        get {
            // `double(forKey:)` returns 0 for an absent key, which is a real
            // choice here ("never hide"), so absence has to be checked first.
            guard UserDefaults.standard.object(forKey: autoDismissKey) != nil else {
                return defaultAutoDismiss
            }
            return UserDefaults.standard.double(forKey: autoDismissKey)
        }
        set { UserDefaults.standard.set(newValue, forKey: autoDismissKey) }
    }

    static func autoDismissLabel(_ seconds: Double) -> String {
        seconds <= 0 ? "Never — stay until dismissed" : "\(Int(seconds)) seconds"
    }
}
