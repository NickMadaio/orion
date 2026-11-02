import Foundation

/*
 Each tab's header subline (wave 13): one true sentence about the page right now, in the Home voice. Pure, so the
 wording is tested and a missing reading is left out rather than shown as a dash or a zero. PageHeader uppercases.
*/

private func plural(_ count: Int, _ one: String, _ many: String? = nil) -> String {
    "\(count) \(count == 1 ? one : (many ?? one + "s"))"
}

enum ProjectHeadline {
    static func line(total: Int, running: Int, review: Int, needsYou: Int) -> String {
        guard total > 0 else { return "no projects yet" }
        let reviewPart = review > 0 ? "\(review) \(review == 1 ? "needs" : "need") review" : nil
        let youPart = needsYou > 0 ? "\(needsYou) \(needsYou == 1 ? "needs" : "need") you" : nil
        if running > 0 { return PageSummary.line(["\(running) running", reviewPart, youPart]) }
        let lead = plural(total, "project")
        if reviewPart == nil && youPart == nil { return "\(lead) · none running" }
        return PageSummary.line([lead, reviewPart, youPart])
    }
}

enum HealthHeadline {
    static func line(recovery: Int?, sleepHours: Double?, strain: Double?) -> String {
        let sleep = sleepHours.flatMap { $0.isFinite ? String(format: "sleep %.1fh", $0) : nil }
        let strainPart = strain.flatMap { $0.isFinite ? String(format: "strain %.1f", $0) : nil }
        let text = PageSummary.line([recovery.map { "recovery \($0)" }, sleep, strainPart])
        return text.isEmpty ? "no readings yet" : text
    }
}

enum FinanceHeadline {
    static func line(netWorth: Double?, spentThisMonth: Double, recurringMonthly: Double, currency: String, month: String) -> String {
        guard let netWorth else { return "no accounts linked" }
        let spent = spentThisMonth > 0 ? "\(Money.format(spentThisMonth, currency: currency)) spent in \(month)" : "nothing spent in \(month)"
        let recurring = recurringMonthly > 0 ? "\(Money.format(recurringMonthly, currency: currency))/mo recurring" : nil
        return PageSummary.line(["net \(Money.format(netWorth, currency: currency))", spent, recurring])
    }
}

enum PlanHeadline {
    static func line(open: Int, overdue: Int, total: Int, hoursLeft: Int) -> String {
        guard total > 0 else { return "nothing on the list" }
        let left = "\(max(0, hoursLeft))h awake left"
        if open == 0 { return PageSummary.line([total == 1 ? "done" : "all \(total) done", left]) }
        return PageSummary.line(["\(open) open", overdue > 0 ? "\(overdue) overdue" : nil, left])
    }
}

enum SettingsHeadline {
    static func line(granted: Int, permissions: Int, connected: Int) -> String {
        "\(granted) of \(permissions) permissions · \(connected) connected"
    }
}

enum BrandHeadline {
    static func line(readable: Int, total: Int, live: Int) -> String {
        "\(readable) of \(total) readable · " + (live > 0 ? "\(live) live" : "nothing live")
    }
}

enum KnowledgeHeadline {
    static func line(nodes: Int, edges: Int) -> String {
        guard nodes > 0 else { return "nothing learned yet" }
        return "\(plural(nodes, "thing")) · \(plural(edges, "connection"))"
    }
}
