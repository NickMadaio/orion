import AlarmKit
import SwiftUI
import UserNotifications
import MobileCore

/*
 Bedtime and waking up, on the phone (2026-09-29).

 Nick: "right now i should be asleep, and i should be being pestered by orion to
 go to bed. From when i sleep, to alarms waking me up, to my entire schedule, it
 should all be easily doable." And it has to work with the Mac off, so all of it
 lives here:

 - Tonight's bedtime comes from tomorrow's first calendar event (his classes):
   wake = first event − getting-ready time; bed = the earlier of his target
   bedtime and wake − sleep need.
 - Nudges are local notifications: wind down, bedtime, then firmer at +15, +30,
   +45, +60 and +90. Each says how much sleep is still available, because that
   number is the argument. "Going to bed" ends them; "15 more min" moves the
   next one.
 - They are ordinary alerts on purpose. Sleep Focus silences them, so a phone
   that is asleep is not woken up by the thing telling it to sleep; a phone in
   his hand at 1 AM gets every one.
 - The wake-up is a real alarm (AlarmKit): it rings through silent mode and has
   a snooze, like Clock's.
 - "Going to bed" and the first open after the alarm are logged to the Mac's
   health log as history, so his real sleep times can be learned.
*/
struct RoutineSettings: Codable, Equatable {
    /// Minutes after midnight; values below noon mean after midnight (0 = 00:00).
    var bedtimeMinute = 0
    var sleepMinutes = 480
    /// From waking to the first event: shower, breakfast, travel.
    var readyMinutes = 75
    var windDownMinutes = 30
    var wakeAlarm = true
    /// The usual wake time; earlier only when the first class needs it.
    var freeDayWakeMinute = 540
    var nudges = true

    static let key = "orion.routine.settings.v1"
    static func load() -> RoutineSettings {
        guard let data = UserDefaults.standard.data(forKey: key),
              let value = try? JSONDecoder().decode(RoutineSettings.self, from: data) else { return RoutineSettings() }
        return value
    }
    func save() { UserDefaults.standard.set(try? JSONEncoder().encode(self), forKey: Self.key) }
}

/// One night: when to be in bed and when to get up, and why.
struct NightPlan: Equatable {
    let bed: Date
    let wake: Date
    let reason: String?        // "CS2100 at 09:00"
    let firstEvent: Date?
    /// Why the alarm is later than usual, when it is ("You were up until 03:10…").
    var shifted: String? = nil
    /// A plan running through bedtime (a night out): no bedtime nudges before it ends.
    var nightOut: String? = nil

    /// The night `now` belongs to: before 6 AM it is still last night.
    /// - lateFixed: tonight's plans that run through bedtime (title, end), e.g. a club until 02:00.
    /// - lastAwake: the latest moment he was seen awake after bedtime (app open, "Going to bed", arriving home).
    static func make(now: Date, settings: RoutineSettings, firstEvent: (Date) -> (title: String, start: Date)?,
                     wakeRequest: Date? = nil, lateFixed: (title: String, end: Date)? = nil, lastAwake: Date? = nil,
                     calendar: Calendar = .current) -> NightPlan {
        let today = calendar.startOfDay(for: now)
        let nightStart = calendar.component(.hour, from: now) < 6 ? calendar.date(byAdding: .day, value: -1, to: today)! : today
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: nightStart)!
        let event = firstEvent(tomorrow)
        // The usual wake time, or earlier when the first class needs it. A 13:30
        // class must not mean sleeping until 12:15 (found by the scenario runs):
        // the routine stays the routine.
        let usual = tomorrow.addingTimeInterval(Double(settings.freeDayWakeMinute * 60))
        let automatic = min(usual, event.map { $0.start.addingTimeInterval(-Double(settings.readyMinutes * 60)) } ?? usual)
        // "Wake me up at 7:30" (asked through ORION) wins for the morning it falls on.
        let requested = wakeRequest.flatMap { calendar.isDate($0, inSameDayAs: automatic) && $0 > now ? $0 : nil }
        let wake = requested ?? automatic
        let targetDay = settings.bedtimeMinute < 12 * 60 ? tomorrow : nightStart
        let target = targetDay.addingTimeInterval(Double(settings.bedtimeMinute * 60))
        let needed = wake.addingTimeInterval(-Double(settings.sleepMinutes * 60))
        let reason = event.map { "\($0.title) at \(Self.clock($0.start))" }
        var bed = min(target, needed)
        var nightOut: String?
        // A night out: bedtime is after it ends plus the trip home, not in the middle of it.
        if let late = lateFixed, late.end > bed {
            bed = late.end.addingTimeInterval(30 * 60)
            nightOut = late.title
        }
        // Up late (or out late): let him sleep, as far as the first class allows,
        // without asking — he will be asleep, not answering. Never earlier than planned.
        var finalWake = wake
        var shifted: String?
        let awakeUntil = [lastAwake.map { $0.addingTimeInterval(15 * 60) }, nightOut != nil ? bed : nil].compactMap { $0 }.max()
        if requested == nil, let awakeUntil, awakeUntil > wake.addingTimeInterval(-Double(settings.sleepMinutes * 60)) {
            let latest = event.map { $0.start.addingTimeInterval(-Double(settings.readyMinutes * 60)) }
                ?? usual.addingTimeInterval(3 * 3600)
            let wanted = awakeUntil.addingTimeInterval(Double(settings.sleepMinutes * 60))
            let moved = min(max(wake, wanted), latest)
            if moved > wake.addingTimeInterval(10 * 60) {
                shifted = "You were up until \(Self.clock(awakeUntil.addingTimeInterval(-15 * 60))), so I moved your alarm from \(Self.clock(wake)) to \(Self.clock(moved))\(reason.map { " — \($0) is still in time" } ?? "")."
                finalWake = moved
            }
        }
        return NightPlan(bed: bed, wake: finalWake, reason: reason, firstEvent: event?.start, shifted: shifted, nightOut: nightOut)
    }

    func sleepLeft(at moment: Date) -> TimeInterval { max(0, wake.timeIntervalSince(max(moment, bed))) }
    func isPastBedtime(_ moment: Date) -> Bool { moment >= bed && moment < wake }

    static func clock(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.dateFormat = "HH:mm"; return formatter.string(from: date)
    }
    static func duration(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds / 60)
        return "\(minutes / 60)h \(String(format: "%02d", minutes % 60))m"
    }
}

@MainActor
final class NightRoutine: ObservableObject {
    static let shared = NightRoutine()

    @Published var settings = RoutineSettings.load() { didSet { settings.save() } }
    @Published private(set) var plan: NightPlan?
    @Published private(set) var alarmState = "Not set"
    @Published private(set) var inBed = false
    /// The latest time he was seen awake after bedtime; moves the alarm later.
    private var lastAwake: Date? {
        get { let t = UserDefaults.standard.double(forKey: "orion.routine.lastAwake"); return t > 0 ? Date(timeIntervalSince1970: t) : nil }
        set { UserDefaults.standard.set(newValue?.timeIntervalSince1970 ?? 0, forKey: "orion.routine.lastAwake") }
    }

    /// Seen awake (app open, a background location update, a notification answered).
    /// Only counts after bedtime; the alarm is recomputed right away.
    func noteAwake(at moment: Date = Date(), planner: PlannerStore) async {
        guard let plan, plan.isPastBedtime(moment) else { return }
        if (lastAwake ?? .distantPast) < moment { lastAwake = moment }
        await refresh(planner: planner, now: moment)
    }

    /// Set by the app once the link is up; entries wait in `queued` until then.
    var log: ((LinkLog) -> Void)? { didSet { flush() } }
    private let center = UNUserNotificationCenter.current()
    private static let prefix = "orion.night."
    private static let alarmKey = "orion.routine.alarmID"
    private static let queueKey = "orion.routine.queued"
    private static let bedKey = "orion.routine.bedAt"
    private static let upKey = "orion.routine.upLoggedFor"
    static let shiftKey = "orion.routine.alarmShift"

    /// This morning's note, if the alarm was moved last night (shown until noon).
    var morningNote: String? {
        let at = UserDefaults.standard.double(forKey: Self.shiftKey + ".at")
        guard at > 0, Date().timeIntervalSince1970 - at < 5 * 3600, Date().timeIntervalSince1970 >= at - 600 else { return nil }
        return UserDefaults.standard.string(forKey: Self.shiftKey)
    }

    static let category = "orion.night"
    static let bedAction = "orion.night.bed"
    static let snoozeAction = "orion.night.snooze"

    private init() {
        let bed = UNNotificationAction(identifier: Self.bedAction, title: "Going to bed", options: [])
        let snooze = UNNotificationAction(identifier: Self.snoozeAction, title: "15 more min", options: [])
        center.setNotificationCategories([UNNotificationCategory(identifier: Self.category, actions: [bed, snooze],
                                                                 intentIdentifiers: [], options: [])])
    }

    // MARK: - Planning tonight

    /// Recompute tonight and (re)schedule its nudges and the alarm. Cheap; call on every foreground.
    private var lastWakeRequest: Date?

    func refresh(planner: PlannerStore, wakeRequest: Date? = nil, now: Date = Date()) async {
        if let wakeRequest { lastWakeRequest = wakeRequest }
        // Forget a stale "last awake" from a previous night.
        if let seen = lastAwake, now.timeIntervalSince(seen) > 16 * 3600 { lastAwake = nil }
        let plan = NightPlan.make(now: now, settings: settings, firstEvent: { planner.firstTimedEvent(on: $0) },
                                  wakeRequest: wakeRequest ?? lastWakeRequest, lateFixed: planner.lateFixedEvent(around: now),
                                  lastAwake: lastAwake)
        self.plan = plan
        inBed = UserDefaults.standard.double(forKey: Self.bedKey) > plan.bed.addingTimeInterval(-10 * 3600).timeIntervalSince1970
        logWakeIfNeeded(plan: plan, now: now)
        await scheduleNudges(plan, now: now)
        await scheduleAlarm(plan, now: now)
        // Look for signs he's still up after bedtime, even if he never opens ORION.
        BackgroundRefresh.scheduleNightCheck(bed: plan.bed, wake: plan.wake, now: now)
    }

    private func scheduleNudges(_ plan: NightPlan, now: Date) async {
        let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
        center.removePendingNotificationRequests(withIdentifiers: pending)
        guard settings.nudges, !inBed else { return }
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        // Out tonight: no "wind down" while he's at the club; start at the new bedtime.
        var moments: [(Date, Int)] = plan.nightOut == nil
            ? [(plan.bed.addingTimeInterval(-Double(settings.windDownMinutes * 60)), 0), (plan.bed, 1)]
            : [(plan.bed, 1)]
        moments += [15, 30, 45, 60, 90].enumerated().map { (plan.bed.addingTimeInterval(Double($0.element * 60)), $0.offset + 2) }
        // Already past bedtime (it's 3 AM): start from now instead of the past.
        if now >= plan.bed { moments = [5, 15, 25, 40, 60].map { (now.addingTimeInterval(Double($0 * 60)), 3) } }
        for (moment, level) in moments where moment > now && moment < plan.wake {
            let content = UNMutableNotificationContent()
            content.title = level == 0 ? "Wind down" : "ORION"
            content.body = Self.message(level: level, at: moment, plan: plan)
            content.sound = level >= 2 ? .default : .default
            content.categoryIdentifier = Self.category
            content.interruptionLevel = .active   // Sleep Focus silences these; that is the point.
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: moment)
            let request = UNNotificationRequest(identifier: Self.prefix + String(Int(moment.timeIntervalSince1970)),
                                                content: content, trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false))
            try? await center.add(request)
        }
    }

    /// Plain and specific; the sleep still available is the argument.
    static func message(level: Int, at moment: Date, plan: NightPlan) -> String {
        let left = NightPlan.duration(plan.sleepLeft(at: moment))
        let why = plan.reason.map { " \($0) tomorrow." } ?? ""
        switch level {
        case 0: return "Bed at \(NightPlan.clock(plan.bed)).\(why) Start wrapping up."
        case 1: return "It's \(NightPlan.clock(moment)) — bedtime. Sleep now and you get \(left)."
        case 2: return "Still up. \(left) of sleep left if you go now.\(why)"
        case 3: return "It's \(NightPlan.clock(moment)). Every 15 minutes now comes out of tomorrow. Phone down — \(left) left."
        case 4: return "You said you wanted to be asleep by \(NightPlan.clock(plan.bed)). It's \(NightPlan.clock(moment)). Put the phone on the charger and go."
        default: return "\(NightPlan.clock(moment)). \(left) left before your alarm. I'll plan tomorrow around a short night — go to sleep."
        }
    }

    #if targetEnvironment(simulator)
    /// Design review only: a night whose bedtime was `pastBedtime` minutes ago.
    func preview(now: Date = Date(), pastBedtime: Double) {
        let bed = now.addingTimeInterval(-pastBedtime * 60)
        plan = NightPlan(bed: bed, wake: bed.addingTimeInterval(8 * 3600), reason: "CS2100 at 09:00", firstEvent: nil)
        alarmState = "Set for \(NightPlan.clock(bed.addingTimeInterval(8 * 3600)))"
    }
    #endif

    // MARK: - Answers from the notification

    func goingToBed(at moment: Date = Date()) {
        inBed = true
        UserDefaults.standard.set(moment.timeIntervalSince1970, forKey: Self.bedKey)
        if let plan, moment >= plan.bed.addingTimeInterval(-3600) {
            lastAwake = moment
            // Recompute the alarm for a late bedtime (EventKit works in the background).
            Task { await self.refresh(planner: PlannerStore(), now: moment) }
        }
        Task {
            let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
            center.removePendingNotificationRequests(withIdentifiers: pending)
        }
        record(.sleep(event: "bed", at: ISO8601DateFormatter().string(from: moment)))
    }

    /// Moves the next nudge fifteen minutes out; the rest of the ladder stays.
    func snooze(from moment: Date = Date()) {
        Task {
            let pending = await center.pendingNotificationRequests()
                .filter { $0.identifier.hasPrefix(Self.prefix) }
                .compactMap { request -> (String, Date)? in
                    guard let trigger = request.trigger as? UNCalendarNotificationTrigger, let date = trigger.nextTriggerDate() else { return nil }
                    return (request.identifier, date)
                }
                .sorted { $0.1 < $1.1 }
            if let next = pending.first, next.1 < moment.addingTimeInterval(15 * 60) {
                center.removePendingNotificationRequests(withIdentifiers: [next.0])
            }
            guard let plan else { return }
            let content = UNMutableNotificationContent()
            content.title = "ORION"
            content.body = "Fifteen minutes are up. \(NightPlan.duration(plan.sleepLeft(at: moment.addingTimeInterval(900)))) left. Bed."
            content.sound = .default
            content.categoryIdentifier = Self.category
            let request = UNNotificationRequest(identifier: Self.prefix + "snooze-\(Int(moment.timeIntervalSince1970))", content: content,
                                                trigger: UNTimeIntervalNotificationTrigger(timeInterval: 15 * 60, repeats: false))
            try? await center.add(request)
        }
    }

    // MARK: - The wake alarm

    private func scheduleAlarm(_ plan: NightPlan, now: Date) async {
        guard #available(iOS 26.0, *) else { alarmState = "Needs iOS 26"; return }
        let manager = AlarmManager.shared
        if let old = UserDefaults.standard.string(forKey: Self.alarmKey).flatMap(UUID.init(uuidString:)) {
            try? manager.cancel(id: old)
            UserDefaults.standard.removeObject(forKey: Self.alarmKey)
        }
        guard settings.wakeAlarm else { alarmState = "Off"; return }
        guard plan.wake > now else { alarmState = "Not set"; return }
        do {
            if manager.authorizationState == .notDetermined { _ = try await manager.requestAuthorization() }
            guard manager.authorizationState == .authorized else { alarmState = "Allow Alarms for ORION in Settings"; return }
            let stop = AlarmButton(text: "I'm up", textColor: .white, systemImageName: "sun.max.fill")
            let snooze = AlarmButton(text: "Snooze", textColor: .white, systemImageName: "zzz")
            let title: LocalizedStringResource = plan.reason.map { "Time to get up — \($0)" } ?? "Time to get up"
            let alert = AlarmPresentation.Alert(title: title, stopButton: stop, secondaryButton: snooze, secondaryButtonBehavior: .countdown)
            let countdown = AlarmPresentation.Countdown(title: "Snoozing")
            let attributes = AlarmAttributes<WakeMetadata>(presentation: AlarmPresentation(alert: alert, countdown: countdown),
                                                           metadata: WakeMetadata(), tintColor: Phone.accent)
            let configuration = AlarmManager.AlarmConfiguration<WakeMetadata>(
                countdownDuration: Alarm.CountdownDuration(preAlert: nil, postAlert: 9 * 60),
                schedule: .fixed(plan.wake), attributes: attributes)
            let id = UUID()
            _ = try await manager.schedule(id: id, configuration: configuration)
            UserDefaults.standard.set(id.uuidString, forKey: Self.alarmKey)
            alarmState = "Set for \(NightPlan.clock(plan.wake))"
            // Kept for the morning card: he was asleep when this happened.
            if let shifted = plan.shifted {
                UserDefaults.standard.set(shifted, forKey: Self.shiftKey)
                UserDefaults.standard.set(plan.wake.timeIntervalSince1970, forKey: Self.shiftKey + ".at")
            }
        } catch {
            alarmState = "Could not set the alarm"
        }
    }

    /// The first open after the alarm time counts as getting up (logged once a night).
    private func logWakeIfNeeded(plan: NightPlan, now: Date) {
        let previousWake = plan.wake.addingTimeInterval(-86_400)
        let key = String(Int(previousWake.timeIntervalSince1970 / 86_400))
        guard now >= previousWake, now < previousWake.addingTimeInterval(5 * 3600),
              UserDefaults.standard.string(forKey: Self.upKey) != key else { return }
        UserDefaults.standard.set(key, forKey: Self.upKey)
        record(.sleep(event: "up", at: ISO8601DateFormatter().string(from: now)))
    }

    // MARK: - Sending to the Mac

    private func record(_ entry: LinkLog) {
        if let log { log(entry); return }
        var queued = (UserDefaults.standard.array(forKey: Self.queueKey) as? [String]) ?? []
        if let text = try? entry.encoded() { queued.append(text) }
        UserDefaults.standard.set(Array(queued.suffix(20)), forKey: Self.queueKey)
    }

    private func flush() {
        guard let log, let queued = UserDefaults.standard.array(forKey: Self.queueKey) as? [String], !queued.isEmpty else { return }
        UserDefaults.standard.removeObject(forKey: Self.queueKey)
        for text in queued { if let entry = try? LinkLog.decode(text) { log(entry) } }
    }
}

// WakeMetadata lives in OrionWidgets/iOS/OrionActivity.swift: the widget
// extension draws the alarm's snooze countdown and needs the same type.

// MARK: - Today's card

/// Tonight, on Today: bed and alarm times, and — once it is past bedtime — a
/// plain instruction instead of a card.
struct TonightCard: View {
    @ObservedObject var routine: NightRoutine
    @State private var editing = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            if let plan = routine.plan {
                if plan.isPastBedtime(context.date) && !routine.inBed {
                    lateNight(plan, now: context.date)
                } else {
                    tonight(plan)
                }
            }
        }
        .sheet(isPresented: $editing) { RoutineSettingsSheet(routine: routine) }
    }

    private func lateNight(_ plan: NightPlan, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("It's \(NightPlan.clock(now))", tint: Phone.orange)
            Text("Go to sleep.").font(Phone.display(30, .bold)).foregroundStyle(Phone.text)
            Text("\(NightPlan.duration(plan.sleepLeft(at: now))) left before your alarm\(plan.reason.map { " · \($0)" } ?? "").")
                .font(.system(size: 15)).foregroundStyle(Phone.soft)
            Button { routine.goingToBed() } label: { Label("Going to bed", systemImage: "moon.zzz.fill") }
                .buttonStyle(PhoneButtonStyle(tint: Phone.violet, prominent: true))
                .accessibilityIdentifier("goingToBed")
        }
        .padding(16)
        .background(Phone.violet.opacity(0.10), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func tonight(_ plan: NightPlan) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let note = routine.morningNote {
                Label(note, systemImage: "alarm").font(.system(size: 14)).foregroundStyle(Phone.accent)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let out = plan.nightOut {
                Label("Out tonight: \(out). No bedtime nudges until it's over — bed by \(NightPlan.clock(plan.bed)).", systemImage: "sparkles")
                    .font(.system(size: 14)).foregroundStyle(Phone.violet).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                SectionLabel("Tonight", tint: Phone.violet)
                Button("Adjust") { editing = true }.font(.system(size: 13, weight: .semibold)).foregroundStyle(Phone.accent)
            }
            HStack(alignment: .top, spacing: 18) {
                PhoneStat(label: "Bed by", value: NightPlan.clock(plan.bed), detail: routine.inBed ? "you're in bed" : "\(routine.settings.sleepMinutes / 60)h of sleep", tint: Phone.violet)
                PhoneStat(label: "Alarm", value: NightPlan.clock(plan.wake), detail: plan.reason ?? routine.alarmState, tint: Phone.accent)
            }
            if routine.alarmState.hasPrefix("Allow") || routine.alarmState.hasPrefix("Could") {
                Text(routine.alarmState).font(.footnote).foregroundStyle(Phone.orange)
            }
        }
    }
}

struct RoutineSettingsSheet: View {
    @ObservedObject var routine: NightRoutine
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Sleep") {
                    Picker("Latest bedtime", selection: $routine.settings.bedtimeMinute) {
                        ForEach([1260, 1290, 1320, 1350, 1380, 1410, 0, 30, 60, 90, 120], id: \.self) {
                            Text(String(format: "%02d:%02d", $0 / 60, $0 % 60)).tag($0)
                        }
                    }
                    Stepper("Sleep need: \(routine.settings.sleepMinutes / 60)h \(routine.settings.sleepMinutes % 60 == 0 ? "" : "30m")",
                            value: $routine.settings.sleepMinutes, in: 360...600, step: 30)
                    Stepper("Wind down: \(routine.settings.windDownMinutes) min before", value: $routine.settings.windDownMinutes, in: 0...90, step: 15)
                    Toggle("Bedtime nudges", isOn: $routine.settings.nudges)
                }
                Section {
                    Toggle("Wake-up alarm", isOn: $routine.settings.wakeAlarm)
                    Stepper("Get ready: \(routine.settings.readyMinutes) min before first event", value: $routine.settings.readyMinutes, in: 15...180, step: 15)
                    Picker("Usual wake time", selection: $routine.settings.freeDayWakeMinute) {
                        ForEach(stride(from: 360, through: 720, by: 30).map { $0 }, id: \.self) {
                            Text(String(format: "%02d:%02d", $0 / 60, $0 % 60)).tag($0)
                        }
                    }
                } header: { Text("Morning") } footer: {
                    Text("Bedtime is the earlier of your latest bedtime and your alarm minus your sleep need. Turn on Sleep Focus and the nudges stay quiet.")
                }
            }
            .scrollContentBackground(.hidden).background(Phone.ink)
            .navigationTitle("Tonight").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }
}
