import Foundation

/// Folds what the phone knows into `PhoneHome`. Pure: every clause comes from a field.
public enum PhoneHomeBuilder {
    public struct Input {
        public var now: Date
        public var calendar: Calendar
        public var name: String?
        /// The phone's glance (Calendar plus ORION's plan); nil when there is none yet.
        public var glance: OrionGlance?
        public var snapshot: LinkSnapshot?
        public var messages: [PhoneHomeMessage]
        /// Today's bottles as the phone's water store has them (taps not yet counted by the Mac).
        public var water: Int?
        /// The phone's own Screen Time lock, when it is on.
        public var phoneLockedUntil: Date?

        public init(now: Date, calendar: Calendar = .current, name: String?, glance: OrionGlance?, snapshot: LinkSnapshot?,
                    messages: [PhoneHomeMessage], water: Int? = nil, phoneLockedUntil: Date? = nil) {
            self.now = now; self.calendar = calendar; self.name = name; self.glance = glance; self.snapshot = snapshot
            self.messages = messages; self.water = water; self.phoneLockedUntil = phoneLockedUntil
        }
    }

    /// A snapshot older than this no longer speaks for the Mac's approvals (the glance uses the same window).
    public static let freshness: TimeInterval = 15 * 60
    /// A block is counted down ("IN 40 MIN") up to this many minutes ahead, as on the Mac.
    static let countdownMinutes = 180

    public static func build(_ input: Input) -> PhoneHome {
        let format = Format(calendar: input.calendar)
        let ask = self.ask(input, format: format)
        let approvals = self.approvals(input, format: format)
        let needs = (ask == nil ? 0 : 1) + approvals.count
        return PhoneHome(greeting: greeting(at: input.now, calendar: input.calendar, name: input.name),
                         subline: subline(needs: needs, now: input.now, format: format),
                         next: next(input, format: format), ask: ask, approvals: approvals,
                         doneEarly: doneEarly(input.snapshot?.earlyFinish, next: nextBlock(in: input.glance, at: input.now), format: format),
                         glance: glance(input, format: format))
    }

    public static func greeting(at date: Date, calendar: Calendar = .current, name: String?) -> String {
        let hello: String
        switch calendar.component(.hour, from: date) {
        case 5..<12: hello = "Good morning"
        case 12..<18: hello = "Good afternoon"
        case 18..<23: hello = "Good evening"
        default: hello = "Up late"
        }
        guard let name = name?.trimmingCharacters(in: .whitespaces), !name.isEmpty else { return "\(hello)." }
        return "\(hello), \(name)."
    }

    static func subline(needs: Int, now: Date, format: Format) -> String {
        if needs == 1 { return "ONE THING NEEDS YOU" }
        if needs > 1 { return "\(needs) THINGS NEED YOU" }
        return format.date(now).uppercased()
    }

    // MARK: What's next

    /// The one "next" every card reads: the next block to start that is not free time. Nil when there is none.
    public static func nextBlock(in glance: OrionGlance?, at now: Date) -> OrionGlance.Block? {
        glance?.upcoming(after: now, limit: 1).first
    }

    static func next(_ input: Input, format: Format) -> PhoneHome.Next? {
        guard let glance = input.glance else { return nil }
        let now = input.now
        if glance.isPastBedtime(now), let night = glance.night {
            return .init(kicker: ["PAST BEDTIME"], title: "Time to sleep.",
                         now: night.alarm.map { "Alarm at \(format.time($0))." }, after: night.reason)
        }
        let current = glance.current(at: now)
        let upcoming = glance.upcoming(after: now, limit: 2)
        if let next = nextBlock(in: glance, at: now) {
            let minutes = format.minutes(from: now, to: next.start)
            var kicker = [minutes <= countdownMinutes ? "IN \(format.duration(minutes))" : "AT \(format.time(next.start))",
                          format.shortName(next.title)]
            if let location = next.location?.trimmingCharacters(in: .whitespaces), !location.isEmpty { kicker.append(location) }
            let title = minutes < 1 ? "\(next.title) is starting now."
                : minutes <= 90 ? "\(next.title) starts in \(Plural.count(minutes, "minute"))." : "\(next.title) is at \(format.time(next.start))."
            let after = upcoming.dropFirst().first.map { "Then \($0.title) at \(format.time($0.start))." }
            return .init(kicker: kicker.map { $0.uppercased() }, title: title,
                         now: current.map { "Now: \($0.title), until \(format.time($0.end))." }, after: after)
        }
        if let current {
            return .init(kicker: ["NOW", format.shortName(current.title).uppercased()],
                         title: "You're in \(current.title) until \(format.time(current.end)).", now: nil,
                         after: "Nothing else after that today.")
        }
        let tomorrow = glance.tomorrow.first { $0.kind != "free" }
        return .init(kicker: ["WHAT'S NEXT"], title: "Nothing else on today.", now: nil,
                     after: tomorrow.map { "Tomorrow starts with \($0.title) at \(format.time($0.start))." })
    }

    // MARK: From ORION

    /// The ask is exactly the message a typed reply would answer (OutreachThread's rule), so Reply binds to it.
    static func ask(_ input: Input, format: Format) -> PhoneHome.Ask? {
        let lines = input.messages.flatMap { message -> [OutreachThread.Line] in
            if let ask = message.askID { return [.init(id: ask, sentAt: message.sentAt, fromORION: true)] }
            return message.mine.isEmpty ? [] : [.init(id: message.id, sentAt: message.sentAt, fromORION: false)]
        }
        guard let id = OutreachThread.replyTarget(thread: lines, now: input.now),
              let message = input.messages.last(where: { $0.askID == id }),
              let text = message.orion?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return .init(id: id, kicker: ["ORION ASKED", format.ago(input.now.timeIntervalSince(message.sentAt))], text: text,
                     options: AskOptions.from(text))
    }

    // MARK: Approvals

    static func approvals(_ input: Input, format: Format) -> [PhoneHome.Approval] {
        guard let snapshot = input.snapshot, input.now.timeIntervalSince(snapshot.generatedAt) < freshness else { return [] }
        return snapshot.approvals.filter { $0.expiresAt > input.now }.map { approval in
            let context = approval.context.trimmingCharacters(in: .whitespacesAndNewlines)
            let minutes = format.minutes(from: input.now, to: approval.expiresAt)
            return .init(id: approval.id, kicker: ["NEEDS APPROVAL", "EXPIRES IN \(format.duration(max(1, minutes)))"],
                         title: context.isEmpty ? approval.summary : context,
                         detail: context.isEmpty ? nil : approval.summary)
        }
    }

    // MARK: Done early

    static func doneEarly(_ context: EarlyFinishContext?, next: OrionGlance.Block? = nil, format: Format) -> PhoneHome.DoneEarlyCard {
        let hint = DoneEarly.accessibilityHint(for: context)
        let place = next?.location?.trimmingCharacters(in: .whitespaces)
        let nextLine = next.map { "Next up: \($0.title) at \(format.time($0.start))" + (place?.isEmpty == false ? ", \(place!)." : ".") }
        switch context?.kind {
        case "block":
            let title = context?.title ?? "this block"
            return .init(kicker: ["DONE EARLY", title.uppercased()], title: "Done with \(title) early?", hint: hint, nextLine: nextLine)
        case "after-class":
            let title = context?.classTitle ?? "class"
            return .init(kicker: ["DONE EARLY", title.uppercased()], title: "Out of \(title) early?", hint: hint, nextLine: nextLine)
        default:
            return .init(kicker: ["DONE EARLY"], title: "Finished something early?", hint: hint, nextLine: nextLine)
        }
    }

    // MARK: Glance

    static func glance(_ input: Input, format: Format) -> [PhoneHome.GlanceItem] {
        [water(input), sleep(input, format: format), focus(input, format: format)].compactMap { $0 }
    }

    private static func water(_ input: Input) -> PhoneHome.GlanceItem? {
        let base = input.snapshot?.tracking.map { ($0.waterBottles, $0.waterGoal) }
            ?? input.glance?.tracking.map { ($0.water, $0.waterGoal) }
        guard let (count, goal) = base else { return nil }
        return .init(kind: .water, label: "WATER", value: "\(max(count, input.water ?? 0))/\(goal)")
    }

    private static func sleep(_ input: Input, format: Format) -> PhoneHome.GlanceItem? {
        let today = format.dayKey(input.now)
        if let hours = input.snapshot?.health?.last(where: { $0.date == today })?.sleepHours, hours.isFinite, hours > 0 {
            return .init(kind: .sleep, label: "SLEEP", value: String(format: "%.1fh", hours))
        }
        if let bed = input.glance?.night?.bed, bed > input.now {
            return .init(kind: .sleep, label: "SLEEP", value: "bed \(format.time(bed))")
        }
        return nil
    }

    private static func focus(_ input: Input, format: Format) -> PhoneHome.GlanceItem? {
        if let until = input.phoneLockedUntil, until > input.now {
            return .init(kind: .focus, label: "FOCUS", value: "apps locked till \(format.time(until))")
        }
        guard let glance = input.glance else { return nil }
        if let checkin = glance.checkin, checkin.phase == "active" { return .init(kind: .focus, label: "FOCUS", value: checkin.what) }
        guard let current = glance.current(at: input.now) else { return .init(kind: .focus, label: "FOCUS", value: "free now") }
        let deep = ["orion", "study"].contains(current.kind)
        return .init(kind: .focus, label: "FOCUS", value: deep ? current.title : "in \(format.shortName(current.title))")
    }
}
