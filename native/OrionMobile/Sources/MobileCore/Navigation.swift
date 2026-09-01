import Foundation

/// The five tabs the manifest names, and the rule that ORION sits in the middle.
///
/// "Keep ORION interaction central" is a layout instruction and a product one.
/// Centre position and default selection are both expressed here so the SwiftUI
/// layer cannot quietly demote it to a fourth tab because the mock looked
/// better that way.
public enum Tab: String, CaseIterable, Sendable {
    case today = "Today"
    case plan = "Plan"
    case orion = "ORION"
    case health = "Health"
    case control = "Control"
}

/// Surfaces that exist on the Mac and must not be transplanted.
///
/// "Do not replicate the desktop interface" is easy to agree with and easy to
/// erode one useful-looking screen at a time, so the list is written down and
/// checked rather than remembered.
public enum DesktopOnlySurface: String, CaseIterable, Sendable {
    case menuBar = "menu bar"
    case orb = "orb"
    case workshop = "workshop"
    case focusClips = "focus clips"
    case voiceTuning = "voice tuning"
    case pluginConsole = "plugin console"
}

public struct Navigation: Sendable, Equatable {
    public private(set) var selected: Tab

    /// ORION is the default, not Today.
    ///
    /// Today is the dashboard and would be the conventional landing tab. The
    /// manifest says interaction is central, and opening on a dashboard makes an
    /// assistant something you check rather than something you talk to.
    public static let defaultTab: Tab = .orion

    public init(selected: Tab = Navigation.defaultTab) {
        self.selected = selected
    }

    public static var tabs: [Tab] { Tab.allCases }

    /// The middle of five. Centre is a position, and this is the arithmetic.
    public static var centreIndex: Int { tabs.count / 2 }

    public static var centreTab: Tab { tabs[centreIndex] }

    public mutating func select(_ tab: Tab) {
        selected = tab
    }

    /// Returning to the ORION tab from anywhere, which the app does on a
    /// notification tap and after a capture.
    public mutating func returnToConversation() {
        selected = .orion
    }
}
