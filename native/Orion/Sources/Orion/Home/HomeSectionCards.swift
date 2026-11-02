import Foundation

/*
 The cards Home borrows from Projects, Finances and Health (wave 12, U5). Same contract as HomeCards.swift: a fold
 over data the section already holds, no data → no card. Ranks slot them among the day's cards: a run that needs
 Nick sits with the overdue tasks; a renewal or a stalled run beside a later class; a spend headline last.
*/

extension HomeCardBuilder {
    /// A charge renewing within this many days is worth a card.
    static let renewalLeadDays = 3

    // MARK: Projects

    static func project(_ projects: [HomeProject], format: HomeFormat) -> HomeCard? {
        let current = projects.filter { $0.isCurrent(at: format.now) }
        func first(_ match: (HomeProject.Phase) -> Bool) -> HomeProject? { current.first { match($0.phase) } }
        let running = current.filter { $0.phase == .running }
        let others = running.count > 1 ? " \(HomeFormat.word(running.count - 1)) more running." : ""

        if let project = first({ if case .needsYou = $0 { return true }; return false }), case .needsYou(let ask) = project.phase {
            let age = project.since.map { format.ago(format.now.timeIntervalSince($0)) }
            return HomeCard(kind: .project, kicker: ["PROJECT", "NEEDS YOU"] + (age.map { [$0] } ?? []),
                            title: "“\(project.name)” is waiting on you.",
                            body: [ask, "\(project.progress) tasks accepted; the rest carry on without it."],
                            primary: HomeCardButton(title: "Open project", action: .openProject(id: project.id)),
                            details: nil, rank: 2)
        }
        if let project = first({ $0 == .stalled }) {
            let quiet = project.since.map { format.duration(Int(format.now.timeIntervalSince($0) / 60)) } ?? "A WHILE"
            return HomeCard(kind: .project, kicker: ["PROJECT AGENT", "STALLED", "QUIET \(quiet)"],
                            title: "“\(project.name)” stopped reporting.",
                            body: [project.activeTask.map { "It was on “\($0)” when the supervisor went quiet." }
                                   ?? "The run still says running, but nothing is driving it."],
                            primary: HomeCardButton(title: "Open project", action: .openProject(id: project.id)),
                            details: nil, rank: 3)
        }
        if let project = first({ $0 == .review }) {
            return HomeCard(kind: .project, kicker: ["PROJECT AGENT", "READY FOR REVIEW", project.progress],
                            title: "“\(project.name)” has finished its tasks.",
                            body: ["Every task is accepted. The final review is yours." + others],
                            primary: HomeCardButton(title: "Review it", action: .openProject(id: project.id)),
                            details: nil, rank: 3)
        }
        guard let project = running.first else { return nil }
        return HomeCard(kind: .project, kicker: ["PROJECT AGENT", "RUNNING", project.progress],
                        title: "“\(project.name)” is working.",
                        body: [(project.activeTask.map { "On “\($0)”." } ?? "Between tasks.") + others],
                        primary: HomeCardButton(title: "Watch it", action: .openProject(id: project.id)),
                        details: nil, rank: 5)
    }

    // MARK: Finance

    static func finance(_ finance: HomeFinance?, format: HomeFormat) -> HomeCard? {
        guard let finance, finance.isFresh(at: format.now) else { return nil }
        let money = { HomeFormat.money($0, currency: finance.currency) }
        let monthly = finance.recurring.count > 1
            ? "\(HomeFormat.word(finance.recurring.count)) recurring charges, \(money(finance.recurringTotal)) a month." : nil

        let renewals = finance.recurring.compactMap { item -> (HomeFinance.Recurring, Date, Int)? in
            guard let seen = item.lastSeen, let due = format.clock.calendar.date(byAdding: .month, value: 1, to: seen) else { return nil }
            let days = format.days(until: due)
            return (0...renewalLeadDays).contains(days) ? (item, due, days) : nil
        }.sorted { $0.2 < $1.2 }
        if let (item, due, days) = renewals.first {
            let when = days == 0 ? "today" : days == 1 ? "tomorrow" : "on \(format.weekday(due))"
            return HomeCard(kind: .finance, kicker: [days == 0 ? "RENEWS TODAY" : "RENEWS IN \(days) DAY\(days == 1 ? "" : "S")", "FINANCES"],
                            title: "\(item.name) renews \(when): \(money(item.amount)).",
                            body: [monthly ?? "Cancel it first if you're done with it."],
                            primary: HomeCardButton(title: "Open finances", action: .openFinance), details: nil,
                            rank: days == 0 ? 2 : 4)
        }
        guard finance.spentThisWeek > 0 else { return nil }
        let category = finance.topCategory.map { ", most of it on \(Money.prettyCategory($0).lowercased())" } ?? ""
        return HomeCard(kind: .finance, kicker: ["SPENDING", "THIS WEEK"],
                        title: "\(money(finance.spentThisWeek)) spent so far this week.",
                        body: ["\(money(finance.spentThisMonth)) this month\(category)."],
                        primary: HomeCardButton(title: "Open finances", action: .openFinance), details: nil, rank: 6)
    }

    // MARK: A short night, when no bedtime is planned

    static func shortNight(_ hours: Double, format: HomeFormat) -> HomeCard? {
        guard format.hour >= 19 || format.hour < 2 else { return nil }
        return HomeCard(kind: .sleep, kicker: ["SLEEP", String(format: "%.1fH LAST NIGHT", hours)],
                        title: "Short night last night. Make tonight an early one.",
                        body: ["No bedtime is set yet; I can plan one around tomorrow."],
                        primary: HomeCardButton(title: "Plan an early night", action: .ask(prefill: "Plan me an early night around tomorrow.")),
                        details: HomeCardButton(title: "details", action: .openHealth), rank: 3)
    }
}
