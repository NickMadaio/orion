import Foundation

/// The rows the palette can offer, from the live facts. Order here is the default order.
enum PaletteCatalog {

    static func actions(_ ctx: PaletteContext) -> [PaletteItem] {
        func item(_ id: String, _ title: String, _ sub: String, _ symbol: String, _ action: PaletteAction, _ keys: String = "") -> PaletteItem {
            PaletteItem(id: "act-\(id)", title: title, subtitle: sub, keywords: keys, section: .actions, symbol: symbol, action: action)
        }
        var rows = [
            item("talk", "Talk to ORION", "starts listening", "waveform", .talk, "voice speak listen"),
            item("type", "Type to ORION", "the small overlay", "keyboard", .typeOverlay, "summon chat write"),
            item("todo", "Add to-do", "or start with +", "plus.circle", .setQuery("+"), "task reminder"),
            item("water", "Log water +1", "one bottle", "drop", .logWater, "hydration bottle drink"),
            item("food", "Log food…", "log food banana 105", "fork.knife", .setQuery("log food "), "meal eat calories kcal"),
        ]
        rows += sessionRows(ctx, item)
        rows += [
            item("game", "Game ready", "close what a game does not need", "gamecontroller", .gameReady, "gaming play prep"),
            item("unused", "Close unused apps", "shows the plan first", "xmark.app", .closeUnused, "quit clean memory ram"),
            item("mouse", "Mouse setup", "buttons and shortcuts", "computermouse", .mouseSetup, "buttons bindings"),
            item("mouse-toggle", ctx.mouseShortcutsOn ? "Mouse shortcuts off" : "Mouse shortcuts on",
                 "same as ⌃⌥M", "computermouse.fill", .toggleMouse, "mouse buttons disable enable pause"),
            item("mute", ctx.muted ? "Unmute the microphone" : "Mute", ctx.muted ? "ORION can hear you again" : "ORION stops listening",
                 ctx.muted ? "mic" : "mic.slash", .toggleMute, "microphone silence"),
            item("chat", "Open chat", "your conversations", "bubble.left.and.text.bubble.right", .openChat, "messages history"),
        ]
        return rows
    }

    private static func sessionRows(_ ctx: PaletteContext,
                                    _ item: (String, String, String, String, PaletteAction, String) -> PaletteItem) -> [PaletteItem] {
        guard let session = ctx.session else {
            var rows: [PaletteItem] = []
            if let minutes = ctx.nextFocusMinutes {
                rows.append(item("focus-next", "Start focus until the next thing", "\(minutes) minutes, ends five before", "scope",
                                 .startFocus(minutes: minutes), "session pomodoro study work"))
            }
            rows.append(item("focus", "Start focus", "50 minutes", "scope", .startFocus(minutes: 50), "session pomodoro study work"))
            rows.append(item("early", "Done early", "pull the rest of today forward", "flag.checkered", .finishEarly, "finished out schedule reschedule"))
            return rows
        }
        var rows = [session.paused
            ? item("resume", "Resume the session", "starts the clock", "play", .sessionOp(.resume), "focus continue")
            : item("pause", "Pause the session", "stops the clock", "pause", .sessionOp(.pause), "focus hold")]
        if session.onBreak { rows.append(item("skip", "End the break now", "straight to the next block", "forward.end", .sessionOp(.skipBreak), "skip")) }
        rows.append(item("finish", "Finish the session", "archived as a success", "flag.checkered", .sessionOp(.finish), "focus end done stop"))
        rows.append(item("release", "Stop enforcing", "ORION stops mentioning drift", "hand.raised.slash", .sessionOp(.release), "nag"))
        rows.append(item("early", "Done early", "pull the rest of today forward", "flag.checkered", .finishEarly, "finished out schedule reschedule"))
        return rows
    }

    static let tabs: [PaletteItem] = [
        ("home", "Home", "circle.hexagongrid", "orb dashboard"),
        ("tasks", "Today & tasks", "calendar", "plan schedule todo day calendar"),
        ("project", "Projects", "hammer", "qwen agent code"),
        ("knowledge", "Knowledge", "point.3.connected.trianglepath.dotted", "memory graph notes"),
        ("health", "Health", "heart", "sleep whoop water recovery"),
        ("finance", "Finances", "creditcard", "money budget spending"),
        ("brand", "Brand", "paintpalette", "design"),
        ("settings", "Settings", "gearshape", "preferences options"),
    ].map { raw, title, symbol, keys in
        PaletteItem(id: "tab-\(raw)", title: title, subtitle: "", keywords: keys, section: .goTo, symbol: symbol, action: .openTab(raw))
    }

    static func today(_ ctx: PaletteContext) -> [PaletteItem] {
        // Already in the shared order (`orion-tasks list`); only lift the overdue ones, keeping that order.
        (ctx.todos.filter(\.overdue) + ctx.todos.filter { !$0.overdue }).map { todo in
            PaletteItem(id: "todo-\(todo.title)", title: todo.title,
                        subtitle: todo.overdue ? "overdue · \(todo.due)" : (todo.due.isEmpty ? "to-do" : "due \(todo.due)"),
                        keywords: "todo done task", section: .today, symbol: todo.overdue ? "exclamationmark.circle" : "circle",
                        action: .todoDone(todo.title), badge: todo.overdue ? "overdue" : "", urgent: todo.overdue)
        }
    }

    static func apps(_ ctx: PaletteContext) -> [PaletteItem] {
        let runningNames = Set(ctx.running.map { $0.name.lowercased() })
        let installed = ctx.installed.filter { !runningNames.contains($0.name.lowercased()) }.map {
            PaletteItem(id: "app-\($0.path)", title: $0.name, subtitle: "open", section: .apps, symbol: "app", action: .openApp(path: $0.path))
        }
        let running = ctx.running.map {
            PaletteItem(id: "run-\($0.bundleID)", title: $0.name, subtitle: $0.frontmost ? "in front" : "switch to",
                        section: .running, symbol: "app.fill",
                        action: .switchApp(bundleID: $0.bundleID, name: $0.name, path: $0.path), badge: "running")
        }
        return running + installed
    }
}

/// The ⌘K menu for one row.
public struct PaletteSubAction: Equatable {
    public let title: String
    public let symbol: String
    public let action: PaletteAction
    public init(title: String, symbol: String, action: PaletteAction) { self.title = title; self.symbol = symbol; self.action = action }
}

public enum PaletteSubActions {
    public static func `for`(_ item: PaletteItem) -> [PaletteSubAction] {
        switch item.action {
        case .openApp(let path):
            return [.init(title: "Open", symbol: "arrow.up.forward.app", action: item.action),
                    .init(title: "Show in Finder", symbol: "folder", action: .revealInFinder(path: path))]
        case .switchApp(_, let name, let path):
            return [.init(title: "Switch to", symbol: "arrow.up.forward.app", action: item.action),
                    .init(title: "Quit \(name)", symbol: "power", action: .quitApp(name: name)),
                    .init(title: "Show in Finder", symbol: "folder", action: .revealInFinder(path: path))]
        case .todoDone(let title):
            return [.init(title: "Mark done", symbol: "checkmark.circle", action: .todoDone(title)),
                    .init(title: "Open Today & tasks", symbol: "calendar", action: .openTab("tasks")),
                    .init(title: "Ask ORION about it", symbol: "sparkle", action: .ask("what should I do about \"\(title)\"?"))]
        case .noop:
            return []
        default:
            return [.init(title: "Run", symbol: "return", action: item.action),
                    .init(title: "Ask ORION about this", symbol: "sparkle", action: .ask("how do I use \"\(item.title)\"?"))]
        }
    }
}
