//
//  Which apps may even be CONSIDERED for closing. Pure, and deliberately not
//  the interesting half of the problem.
//
//  Nick refused twice to maintain a list of quittable apps: "just give him
//  access to close anything that A. won't have issues with saving, and B. isn't
//  being used for my task", and "it should be an open ended question he reasons,
//  not a multiple choice." Fair — a list you have to keep up to date is a list
//  that is wrong by next month.
//
//  But reasoning is a thing that can be wrong, and the cost of being wrong here
//  is somebody's unsaved work. So the shape is:
//
//      THIS FILE decides what may be considered.  A MODEL decides which of
//      those to close.  Nothing the model says can put back something this
//      file removed.
//
//  The asymmetry is the whole design. The model can only ever narrow the set it
//  is handed; every path to `terminate()` runs through `screen` first, and then
//  through it AGAIN at the moment of quitting, because minutes pass between
//  deciding and acting and a document can be dirtied in between.
//
//  The failure Nick will not forgive is losing work. The failure he will forgive
//  is leaving an app open. Every ambiguous case therefore resolves to "leave it
//  open" — including, and especially, "the signal could not be read".
//

import Foundation

// MARK: - What macOS would tell us about an app's documents

/// Deliberately three-valued. "We could not tell" is not "it is clean", and
/// collapsing the two is exactly how an editor with an hour of unsaved work
/// gets closed.
public enum DocumentState: String, Equatable, Sendable, Codable {
    /// Every window this app exposes says its document is saved.
    case clean
    /// At least one window says it has unsaved changes.
    case edited
    /// The app publishes no readable window state — Electron apps, apps that
    /// do not answer accessibility, or accessibility not being granted at all.
    case unknown
}

// MARK: - What is known about one running app

/// The facts, gathered without asking the app anything destructive. Everything
/// optional is optional because macOS genuinely may not say, and a nil here is
/// never rounded to a convenient default.
public struct AppFacts: Equatable, Sendable {
    public let bundleID: String
    public let name: String

    /// The app Nick is looking at right now.
    public let isFrontmost: Bool
    public let isHidden: Bool

    /// Not `.regular`: agents, daemons, menu-bar-only helpers. Nothing here is a
    /// distraction he switched to, and several of them hold the desktop together.
    public let isBackgroundOnly: Bool

    /// Lives somewhere only the system installs into. `/System/Applications` is
    /// NOT that place — Messages and Music live there and are the archetypal
    /// distraction — so this means system *machinery*, not "shipped by Apple".
    public let isSystemComponent: Bool

    public let documents: DocumentState

    /// How many windows could actually be read, for the audit line. Nil when the
    /// window list itself could not be obtained.
    public let readableWindows: Int?

    /// Since Orion started watching. Nil means it has not been switched to at
    /// all in that time, which is the strongest "not part of this task" signal
    /// available without reading anybody's screen.
    public let secondsSinceLastActive: TimeInterval?

    public let secondsSinceLaunch: TimeInterval?

    /// The app's own Info.plist declares document types it can EDIT. A weaker
    /// signal than `documents`, and used only to describe the app to the model.
    public let editsDocuments: Bool

    public init(bundleID: String, name: String, isFrontmost: Bool, isHidden: Bool,
                isBackgroundOnly: Bool, isSystemComponent: Bool,
                documents: DocumentState, readableWindows: Int?,
                secondsSinceLastActive: TimeInterval?, secondsSinceLaunch: TimeInterval?,
                editsDocuments: Bool) {
        self.bundleID = bundleID
        self.name = name
        self.isFrontmost = isFrontmost
        self.isHidden = isHidden
        self.isBackgroundOnly = isBackgroundOnly
        self.isSystemComponent = isSystemComponent
        self.documents = documents
        self.readableWindows = readableWindows
        self.secondsSinceLastActive = secondsSinceLastActive
        self.secondsSinceLaunch = secondsSinceLaunch
        self.editsDocuments = editsDocuments
    }
}

// MARK: - The verdict

public enum QuitScreening: Equatable, Sendable {
    case eligible
    /// Refused, with the sentence that goes in the log. Nick has to be able to
    /// read back why something survived as easily as why something closed.
    case blocked(String)

    public var isEligible: Bool { self == .eligible }

    public var reason: String? {
        if case .blocked(let why) = self { return why }
        return nil
    }
}

// MARK: - The floor

public enum DistractionFloor {

    /// Never, whatever anything says.
    ///
    /// Three kinds of thing are in here and it is worth keeping them
    /// distinguishable, because the argument for each is different:
    ///
    ///   • Orion, Finder, loginwindow, SecurityAgent — closing these does not
    ///     make a session better, it makes the machine worse. Orion is here
    ///     because an assistant that can quit itself cannot be asked to stop.
    ///   • Password managers — locking somebody out of their own credentials
    ///     mid-session is not enforcement.
    ///   • Terminals, editors and recorders — the ones where "quit" does not
    ///     mean "close a window", it means killing a build, a long-running
    ///     command, or a recording that exists nowhere else yet. A save prompt
    ///     does not protect any of that.
    ///
    /// This is a list, and Nick refused to maintain a list. He is not being
    /// asked to: it is not a list of what MAY be closed, it is engineering
    /// judgement about what may never be, and it does not need to be complete
    /// to be correct — everything not on it still has to survive screening.
    public static let neverQuit: Set<String> = [
        // Orion, and the machine
        "com.nickmadaio.orion.app",
        "com.apple.finder",
        "com.apple.loginwindow",
        "com.apple.SecurityAgent",
        "com.apple.systempreferences",
        "com.apple.systemsettings",
        "com.apple.installer",
        "com.apple.DiskUtility",
        // Credentials
        "com.1password.1password",
        "com.1password.1password7",
        "com.agilebits.onepassword7",
        "com.bitwarden.desktop",
        "com.lastpass.LastPass",
        "org.keepassxc.keepassxc",
        "com.apple.Passwords",
        // Things whose "unsaved work" is a running process, not a document
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "dev.warp.Warp-Stable",
        "com.mitchellh.ghostty",
        "net.kovidgoyal.kitty",
        "com.github.wez.wezterm",
        "io.alacritty",
        "com.apple.dt.Xcode",
        "com.microsoft.VSCode",
        "com.microsoft.VSCodeInsiders",
        "com.todesktop.230313mzl4w4u92",   // Cursor
        "com.jetbrains.intellij",
        // Recordings and live calls: quitting these destroys something that
        // exists nowhere else, and no save sheet appears to stop it
        "com.apple.QuickTimePlayerX",
        "com.obsproject.obs-studio",
        "us.zoom.xos",
        "com.microsoft.teams2",
        "com.microsoft.teams"
    ]

    /// An app switched to this recently is part of what he is doing, whatever a
    /// model thinks of the app in the abstract. Two minutes: long enough to
    /// cover "I just tabbed away to start the session", short enough that it
    /// does not protect everything.
    public static let recentUseGrace: TimeInterval = 120

    /// The one gate. Everything that can quit an app calls this first.
    public static func screen(_ facts: AppFacts) -> QuitScreening {
        guard !facts.bundleID.trimmingCharacters(in: .whitespaces).isEmpty else {
            return .blocked("it has no bundle identifier, so Orion cannot be sure what it is")
        }
        if neverQuit.contains(facts.bundleID) {
            return .blocked("it is on the never-quit list")
        }
        if facts.isSystemComponent {
            return .blocked("it is part of macOS itself")
        }
        if facts.isBackgroundOnly {
            return .blocked("it is a background process, not something you switched to")
        }
        switch facts.documents {
        case .edited:
            return .blocked("it has unsaved changes")
        case .unknown:
            return .blocked("Orion could not read whether it has unsaved work")
        case .clean:
            break
        }
        if facts.isFrontmost {
            return .blocked("it is the app you are using right now")
        }
        if let since = facts.secondsSinceLastActive, since < recentUseGrace {
            return .blocked("you were in it \(Int(since))s ago")
        }
        return .eligible
    }

    /// Split, keeping the reason for every refusal. Nothing is dropped silently:
    /// the caller logs the blocked ones too, so the audit trail says why an app
    /// survived as well as why one did not.
    public static func partition(_ apps: [AppFacts]) -> (eligible: [AppFacts],
                                                         blocked: [(AppFacts, String)]) {
        var eligible: [AppFacts] = []
        var blocked: [(AppFacts, String)] = []
        for app in apps {
            switch screen(app) {
            case .eligible: eligible.append(app)
            case .blocked(let why): blocked.append((app, why))
            }
        }
        return (eligible, blocked)
    }
}
