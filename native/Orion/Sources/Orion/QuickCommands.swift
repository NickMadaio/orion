//
//  What the ⌥Tab menu offers (7 Oct 2026). Pure: the session, the glance and
//  the typed text in, a ranked list out. Every command here is AUTO or NOTIFY;
//  the controller filters again on `mayAppearInConsole` before showing any.
//

import Foundation
import SessionDomain
import MobileCore

enum QuickCommands {

    // MARK: Empty field — what is worth doing right now

    static func everyday(session: QuickSession?, glance: QuickGlance?, muted: Bool) -> [ConsoleCommand] {
        sessionCommands(session: session, glance: glance) + orionCommands(muted: muted) + goTo
    }

    // MARK: Typed — commands first, then apps, then "ask ORION"

    static func forQuery(_ typed: String, session: QuickSession?, glance: QuickGlance?,
                         muted: Bool, apps: [(name: String, url: URL)]) -> [ConsoleCommand] {
        let lowered = typed.lowercased()
        var rows: [ConsoleCommand] = []

        if let minutes = focusMinutes(in: lowered), session == nil {
            rows.append(focus(minutes: minutes, title: "Focus for \(duration(minutes))"))
        }
        if let title = todoTitle(in: typed) {
            rows.append(ConsoleCommand(id: "todo", title: "Add to-do: \(title)", hint: "to your Orion list",
                                       symbol: "checklist", section: .typed, tier: .auto, kind: .addTodo(title)))
        }

        let target = lowered.hasPrefix("open ") ? String(lowered.dropFirst(5)) : lowered
        let words = target.split(separator: " ").map(String.init)
        let catalog = sessionCommands(session: session, glance: glance) + orionCommands(muted: muted) + goTo
        rows += catalog.filter { command in
            let haystack = "\(command.title) \(command.keywords) \(command.id)".lowercased()
            return !words.isEmpty && words.allSatisfy { haystack.contains($0) }
        }

        if target.count >= 2 {
            let found = apps.filter { $0.name.lowercased().hasPrefix(target) }
                .sorted { $0.name.count < $1.name.count }.prefix(3)
            rows += found.map { app in
                ConsoleCommand(id: "app-\(app.name)", title: "Open \(app.name)", hint: "app",
                               symbol: "arrow.up.forward.app", section: .typed, tier: .auto, kind: .openApp(app.url))
            }
        }

        rows.append(ConsoleCommand(id: "ask", title: "Ask ORION: \(typed)", hint: "⌘↩ from anywhere in the list",
                                   symbol: "sparkle", section: .typed, tier: .auto, kind: .ask(typed)))
        return rows
    }

    // MARK: Sections

    static func sessionCommands(session: QuickSession?, glance: QuickGlance?) -> [ConsoleCommand] {
        guard let session else {
            var rows: [ConsoleCommand] = []
            if let next = glance?.next, (15...600).contains(next.inMinutes - 5) {
                rows.append(focus(minutes: next.inMinutes - 5, title: "Focus until \(next.title)",
                                  hint: "\(duration(next.inMinutes - 5)), ends 5 minutes before \(next.at)"))
            }
            rows.append(focus(minutes: 50, title: "Focus for 50 minutes"))
            rows.append(focus(minutes: 150, title: "Focus for 2½ hours"))
            return rows
        }
        var rows: [ConsoleCommand] = []
        if session.paused {
            rows.append(ConsoleCommand(id: "resume", title: "Resume the session", hint: "starts the clock again",
                                       symbol: "play", section: .session, tier: .auto, kind: .session(.resume)))
        } else {
            rows.append(ConsoleCommand(id: "pause", title: "Pause the session", hint: "stops the clock",
                                       symbol: "pause", section: .session, tier: .auto, kind: .session(.pause)))
        }
        if session.onBreak {
            rows.append(ConsoleCommand(id: "skip", title: "End the break now", hint: "straight to the next block",
                                       symbol: "forward.end", section: .session, tier: .auto,
                                       kind: .session(.skipRest), keywords: "skip break"))
        }
        rows.append(ConsoleCommand(id: "finish", title: "Finish the session", hint: "archived as a success",
                                   symbol: "flag.checkered", section: .session, tier: .notify,
                                   kind: .session(.finishEarly), keywords: "end done stop"))
        rows.append(ConsoleCommand(id: "release", title: "Stop enforcing", hint: "ORION stops mentioning drift",
                                   symbol: "hand.raised.slash", section: .session, tier: .auto,
                                   kind: .releaseEnforcement, keywords: "release nag"))
        return rows
    }

    static func orionCommands(muted: Bool) -> [ConsoleCommand] {
        [
            ConsoleCommand(id: "listen", title: "Talk to ORION", hint: "starts listening; Esc when you're done",
                           symbol: "waveform", section: .orion, tier: .auto, kind: .listen, keywords: "voice speak"),
            ConsoleCommand(id: "chat", title: "Open chat", hint: "your conversations with ORION",
                           symbol: "bubble.left.and.text.bubble.right", section: .orion, tier: .auto, kind: .openChat,
                           keywords: "messages history"),
            ConsoleCommand(id: "early", title: DoneEarly.label, hint: "finish what's on now and pull the rest of your day forward",
                           symbol: DoneEarly.symbol, section: .orion, tier: .auto, kind: .finishEarly,
                           keywords: "done finished out early schedule reschedule"),
            ConsoleCommand(id: "mute", title: muted ? "Unmute the microphone" : "Mute the microphone",
                           hint: muted ? "ORION can hear you again" : "ORION stops listening for you",
                           symbol: muted ? "mic" : "mic.slash", section: .orion, tier: .auto, kind: .toggleMute),
        ]
    }

    static let goTo: [ConsoleCommand] = [
        (DashboardTab.tasks, "Today & tasks", "calendar", "plan schedule todo day"),
        (.project, "Projects", "hammer", "qwen agent code"),
        (.health, "Health", "heart", "sleep whoop water"),
        (.finance, "Finances", "creditcard", "money budget"),
        (.home, "Home", "circle.hexagongrid", "orb"),
        (.settings, "Settings", "gearshape", "preferences"),
    ].map { tab, title, symbol, keywords in
        ConsoleCommand(id: "tab-\(tab.rawValue)", title: title, hint: "", symbol: symbol, section: .goTo,
                       tier: .auto, kind: .openTab(tab), keywords: keywords)
    }

    // MARK: Parsing

    /// "focus 90", "work for 2h", "study 45 min" → minutes (10...600).
    static func focusMinutes(in lowered: String) -> Int? {
        let pattern = #"^(?:focus|work|study|pomodoro)\s*(?:for\s+)?(\d{1,3})\s*(m|min|mins|minutes|h|hr|hrs|hour|hours)?$"#
        guard let match = lowered.range(of: pattern, options: .regularExpression) else { return nil }
        let text = String(lowered[match])
        guard let number = Int(text.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()) else { return nil }
        let minutes = text.range(of: #"\d\s*h"#, options: .regularExpression) != nil ? number * 60 : number
        return (10...600).contains(minutes) ? minutes : nil
    }

    /// "todo call mum", "add buy milk", "remind me to email Sam" → the title.
    static func todoTitle(in typed: String) -> String? {
        let pattern = #"^(?i)(?:todo|to-do|add|remind me to)\s+(.+)$"#
        guard typed.range(of: pattern, options: .regularExpression) != nil else { return nil }
        let title = typed.replacingOccurrences(of: #"^(?i)(?:todo|to-do|add|remind me to)\s+"#, with: "",
                                               options: .regularExpression).trimmingCharacters(in: .whitespaces)
        return title.isEmpty ? nil : title
    }

    /// The same blocks `orion-session start --minutes` works out: about
    /// 50-minute blocks with 10-minute breaks, ending when he said.
    static func focusPlan(minutes total: Int) -> SessionPlan {
        let rest = total >= 70 ? 10 : 0
        let blocks = max(1, Int((Double(total + rest) / Double(50 + rest)).rounded()))
        let restMinutes = blocks > 1 ? rest : 0
        let focus = (total - restMinutes * (blocks - 1)) / blocks
        return SessionPlanBuilder.alternating(session: SessionID(from: UUID()), focusBlocks: blocks,
                                              focus: TimeInterval(focus * 60), rest: TimeInterval(restMinutes * 60),
                                              clips: [], task: "Focus")
    }

    static func duration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) minutes" }
        let hours = minutes / 60, rest = minutes % 60
        return rest == 0 ? "\(hours) hour\(hours == 1 ? "" : "s")" : "\(hours)h \(rest)m"
    }

    private static func focus(minutes: Int, title: String, hint: String? = nil) -> ConsoleCommand {
        ConsoleCommand(id: "focus-\(minutes)", title: title,
                       hint: hint ?? (minutes >= 70 ? "blocks of about 50 with 10-minute breaks" : "one block"),
                       symbol: "scope", section: .session, tier: .auto,
                       kind: .session(.start(plan: focusPlan(minutes: minutes))), keywords: "start session pomodoro")
    }
}
