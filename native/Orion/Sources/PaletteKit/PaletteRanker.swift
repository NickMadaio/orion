import Foundation

/// Turns the field's text into the ordered rows. Sections are grouped (best section first), the ask fallback is last.
public enum PaletteRanker {
    static let browseToday = 3, browseActions = 4, browseTabs = 2
    static let searchCap = 8
    private static let perSectionCap: [PaletteSection: Int] = [.today: 4, .actions: 5, .goTo: 3, .apps: 4, .running: 4]

    public static func results(input: PaletteInput, context: PaletteContext, frecency: Frecency, now: Date) -> [PaletteItem] {
        switch input {
        case .browse: return browse(context, frecency, now)
        case .ask(let text):
            return [askRow(text)]
        case .addTodo(let title):
            guard !title.isEmpty else {
                return [PaletteItem(id: "todo-prompt", title: "Add to-do", subtitle: "type it after the +", section: .actions,
                                    symbol: "plus.circle", action: .noop)]
            }
            return [PaletteItem(id: "todo-add", title: "Add to-do: \(title)", subtitle: "to your Orion list", section: .actions,
                                symbol: "checklist", action: .addTodo(title))]
        case .calc(let expression):
            guard let value = Calculator.evaluate(expression) else {
                return [PaletteItem(id: "calc", title: "…", subtitle: expression.isEmpty ? "type a sum" : "not a sum yet", section: .actions,
                                    symbol: "equal.circle", action: .noop)]
            }
            let text = Calculator.format(value)
            return [PaletteItem(id: "calc", title: text, subtitle: "\(expression) · ⏎ copies", section: .actions,
                                symbol: "equal.circle", action: .copy(text))]
        case .action(let name):
            let rows = rank(PaletteCatalog.actions(context), query: name, frecency: frecency, now: now, limit: 9)
            return rows
        case .search(let text):
            return search(text, context, frecency, now)
        }
    }

    // MARK: Browse

    private static func browse(_ ctx: PaletteContext, _ frecency: Frecency, _ now: Date) -> [PaletteItem] {
        func top(_ rows: [PaletteItem], _ count: Int) -> [PaletteItem] {
            let ordered = rows.enumerated().sorted { a, b in
                let fa = frecency.boost(for: a.element.id, query: "", now: now), fb = frecency.boost(for: b.element.id, query: "", now: now)
                return fa != fb ? fa > fb : a.offset < b.offset
            }
            return ordered.prefix(count).map(\.element)
        }
        return Array(PaletteCatalog.today(ctx).prefix(browseToday))
            + top(PaletteCatalog.actions(ctx), browseActions)
            + top(PaletteCatalog.tabs.filter { ["tab-tasks", "tab-health"].contains($0.id) || frecency.boost(for: $0.id, query: "", now: now) > 0 }, browseTabs)
    }

    // MARK: Search

    private static func search(_ raw: String, _ ctx: PaletteContext, _ frecency: Frecency, _ now: Date) -> [PaletteItem] {
        let lowered = raw.lowercased()
        let target = lowered.hasPrefix("open ") ? String(raw.dropFirst(5)).trimmingCharacters(in: .whitespaces) : raw
        let pool = PaletteCatalog.today(ctx) + PaletteCatalog.actions(ctx) + PaletteCatalog.tabs + PaletteCatalog.apps(ctx)
        var scored = score(pool, query: target, frecency: frecency, now: now)
        scored += synthetic(raw).map { (item: $0, score: 101, order: -1) }

        let grouped = Dictionary(grouping: scored, by: { $0.item.section })
        let sections = grouped.map { section, rows -> (section: PaletteSection, items: [PaletteItem], best: Double) in
            let sorted = rows.sorted { $0.score != $1.score ? $0.score > $1.score : $0.order < $1.order }
            return (section, sorted.prefix(perSectionCap[section] ?? 4).map(\.item), sorted.first?.score ?? 0)
        }.sorted { $0.best != $1.best ? $0.best > $1.best : $0.section.hashRank < $1.section.hashRank }

        // Hand the rows out round-robin, so a crowded section cannot push another one off the list.
        var taken = [Int](repeating: 0, count: sections.count), total = 0
        var progressed = true
        while total < searchCap, progressed {
            progressed = false
            for index in sections.indices where total < searchCap && taken[index] < sections[index].items.count {
                taken[index] += 1; total += 1; progressed = true
            }
        }
        let rows = sections.indices.flatMap { Array(sections[$0].items.prefix(taken[$0])) }
        // Running apps outrank an installed copy of the same name: the pool already removed duplicates.
        return rows + [askRow(raw)]
    }

    private static func askRow(_ text: String) -> PaletteItem {
        PaletteItem(id: "ask", title: text.isEmpty ? "Ask ORION" : "Ask ORION: \(text)", subtitle: "⏎ sends it, the answer shows here",
                    section: .ask, symbol: "sparkle", action: .ask(text))
    }

    /// "focus 90" and "log food banana 105" are not catalog rows, they are what was typed.
    static func synthetic(_ typed: String) -> [PaletteItem] {
        var rows: [PaletteItem] = []
        if let minutes = focusMinutes(typed.lowercased()) {
            rows.append(PaletteItem(id: "focus-\(minutes)", title: "Focus for \(minutes) minutes", subtitle: "starts a session",
                                    section: .actions, symbol: "scope", action: .startFocus(minutes: minutes)))
        }
        if let (what, kcal) = food(typed) {
            rows.append(PaletteItem(id: "food-\(what)-\(kcal)", title: "Log \(what), \(kcal) kcal", subtitle: "to today's food log",
                                    section: .actions, symbol: "fork.knife", action: .logFood(what: what, kcal: kcal)))
        }
        return rows
    }

    static func focusMinutes(_ lowered: String) -> Int? {
        let pattern = #"^(?:focus|work|study|pomodoro)\s*(?:for\s+)?(\d{1,3})\s*(m|min|mins|minutes|h|hr|hrs|hour|hours)?$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: lowered, range: NSRange(lowered.startIndex..., in: lowered)),
              let number = Range(match.range(at: 1), in: lowered).flatMap({ Int(lowered[$0]) }) else { return nil }
        let unit = Range(match.range(at: 2), in: lowered).map { String(lowered[$0]) } ?? ""
        let minutes = unit.hasPrefix("h") ? number * 60 : number
        return (10...600).contains(minutes) ? minutes : nil
    }

    static func food(_ typed: String) -> (String, Int)? {
        let pattern = #"^(?:log\s+)?food\s+(.+?)\s+(\d{2,4})\s*(?:kcal|cal)?$"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: typed, range: NSRange(typed.startIndex..., in: typed)),
              let what = Range(match.range(at: 1), in: typed).map({ String(typed[$0]) }),
              let kcal = Range(match.range(at: 2), in: typed).flatMap({ Int(typed[$0]) }) else { return nil }
        return (what, kcal)
    }

    // MARK: Scoring

    private typealias Scored = (item: PaletteItem, score: Double, order: Int)

    private static func score(_ pool: [PaletteItem], query: String, frecency: Frecency, now: Date) -> [Scored] {
        pool.enumerated().compactMap { index, item in
            guard let match = Fuzzy.score(query: query, title: item.title, keywords: item.keywords) else { return nil }
            let boost = frecency.boost(for: item.id, query: query, now: now)
            let rank = item.section == .running ? 6.0 : 0
            return (item, match + boost + rank, index)
        }
    }

    private static func rank(_ pool: [PaletteItem], query: String, frecency: Frecency, now: Date, limit: Int) -> [PaletteItem] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            return Array(pool.enumerated().sorted { a, b in
                let fa = frecency.boost(for: a.element.id, query: "", now: now), fb = frecency.boost(for: b.element.id, query: "", now: now)
                return fa != fb ? fa > fb : a.offset < b.offset
            }.prefix(limit).map(\.element))
        }
        return score(pool, query: trimmed, frecency: frecency, now: now)
            .sorted { $0.score != $1.score ? $0.score > $1.score : $0.order < $1.order }.prefix(limit).map(\.item)
    }
}

private extension PaletteSection {
    /// A stable tie-break between sections with the same best score.
    var hashRank: Int { Self.allCases.firstIndex(of: self) ?? 0 }
}
