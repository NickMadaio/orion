import Foundation

public enum PaletteSection: String, CaseIterable, Equatable {
    case today, actions, goTo, apps, running, ask

    /// The small mono kicker over a section.
    public var kicker: String {
        switch self {
        case .today: return "TODAY"
        case .actions: return "ORION"
        case .goTo: return "GO TO"
        case .apps: return "APPS"
        case .running: return "RUNNING"
        case .ask: return "ASK"
        }
    }
}

public enum PaletteSessionOp: Equatable { case pause, resume, finish, skipBreak, release }

/// Everything a row can do. Plain values, so the ranking and the keyboard rules are testable without the app.
public enum PaletteAction: Equatable {
    case ask(String)
    case talk, typeOverlay, openChat
    case setQuery(String)
    case addTodo(String)
    case logWater
    case logFood(what: String, kcal: Int)
    case startFocus(minutes: Int)
    case sessionOp(PaletteSessionOp)
    case finishEarly
    case gameReady
    case closeUnused
    case mouseSetup, toggleMouse, toggleMute
    case openTab(String)
    case openApp(path: String)
    case switchApp(bundleID: String, name: String, path: String)
    case quitApp(name: String)
    case revealInFinder(path: String)
    case todoDone(String)
    case copy(String)
    case noop
}

public struct PaletteItem: Identifiable, Equatable {
    public let id: String
    public let title: String
    public var subtitle: String = ""
    public var keywords: String = ""
    public let section: PaletteSection
    public let symbol: String
    public let action: PaletteAction
    /// A small right-hand note on the row ("running", "overdue").
    public var badge: String = ""
    /// Overdue to-dos and the like: the row is drawn in the warm hue.
    public var urgent = false

    public init(id: String, title: String, subtitle: String = "", keywords: String = "", section: PaletteSection,
                symbol: String, action: PaletteAction, badge: String = "", urgent: Bool = false) {
        self.id = id; self.title = title; self.subtitle = subtitle; self.keywords = keywords; self.section = section
        self.symbol = symbol; self.action = action; self.badge = badge; self.urgent = urgent
    }
}

// MARK: Context

public struct PaletteSession: Equatable {
    public let paused: Bool
    public let onBreak: Bool
    public init(paused: Bool, onBreak: Bool) { self.paused = paused; self.onBreak = onBreak }
}

public struct PaletteTodo: Equatable {
    public let title: String
    public let overdue: Bool
    public let due: String
    public init(title: String, overdue: Bool, due: String) { self.title = title; self.overdue = overdue; self.due = due }
}

public struct PaletteInstalledApp: Equatable {
    public let name: String
    public let path: String
    public init(name: String, path: String) { self.name = name; self.path = path }
}

public struct PaletteRunningApp: Equatable {
    public let name: String
    public let bundleID: String
    public let path: String
    public let frontmost: Bool
    public init(name: String, bundleID: String, path: String, frontmost: Bool) {
        self.name = name; self.bundleID = bundleID; self.path = path; self.frontmost = frontmost
    }
}

/// The live facts the catalog is built from.
public struct PaletteContext: Equatable {
    public var session: PaletteSession?
    public var muted: Bool
    public var mouseShortcutsOn: Bool
    /// Minutes until five before the next event, when that is a sensible focus length.
    public var nextFocusMinutes: Int?
    public var todos: [PaletteTodo]
    public var installed: [PaletteInstalledApp]
    public var running: [PaletteRunningApp]

    public init(session: PaletteSession?, muted: Bool, mouseShortcutsOn: Bool, nextFocusMinutes: Int?,
                todos: [PaletteTodo], installed: [PaletteInstalledApp], running: [PaletteRunningApp]) {
        self.session = session; self.muted = muted; self.mouseShortcutsOn = mouseShortcutsOn
        self.nextFocusMinutes = nextFocusMinutes; self.todos = todos; self.installed = installed; self.running = running
    }
}
