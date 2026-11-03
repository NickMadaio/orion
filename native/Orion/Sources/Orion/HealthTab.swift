import MobileCore
import SwiftUI

/*
 Health shows today's WHOOP rings and the owner's activity-day logs. WHOOP values stay in the local UI.

 Wave 18: nothing on this page describes where a number came from. The ring captions, the hover details and the
 Today line are reads of the day (HealthReads, HealthTodayLine); the "From your records" rail, which was a list of
 source statements ("RECOVERY SOURCE: A recovery reading is available…"), is gone.
*/

struct HealthTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var whoop: WhoopClient
    @ObservedObject var health: HealthLog
    @ObservedObject var connections: ConnectionsModel
    let day: LogicalDay

    /// One hover stage per area: the rings under the main column, the week row, and the glance rail.
    @StateObject private var ringHover = HealthHoverController()
    @StateObject private var weekHover = HealthHoverController()
    @StateObject private var railHover = HealthHoverController()

    @State private var workoutSheetVisible = false
    @State private var supplementSheetVisible = false
    @State private var nutritionSheetVisible = false
    @State private var calorieDraft = ""

    private let bottleTarget = 9

    var body: some View {
        VStack(alignment: .leading, spacing: 44) {
            PageHeader(title: "Health", subline: HealthHeadline.line(recovery: whoop.snapshot?.recovery,
                                                                      sleepHours: whoop.snapshot?.sleepHours,
                                                                      strain: whoop.snapshot?.strain)) {
                if let snapshot = whoop.snapshot { refreshControl(snapshot) }
            }
            HStack(alignment: .top, spacing: 64) {
                VStack(alignment: .leading, spacing: 30) {
                    headline.deal(order: 1, rise: 12)
                    // Fixed spot under the rings: the Today line until a ring is hovered.
                    HealthHoverStage(controller: ringHover, reads: reads,
                                     rest: HealthTodayLine.line(recovery: whoop.snapshot?.recovery,
                                                                sleepHours: whoop.snapshot?.sleepHours))
                        .deal(order: 2, rise: 8)
                    if !whoop.week.isEmpty { week }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 10) {
                    railDailyProgress
                    HealthHoverStage(controller: railHover, reads: reads, column: 300, height: 110)
                }
                .frame(width: 300)
                .padding(.top, 8)
            }
        }
        // Persisting what the watch said is NOT done here any more — see
        // DashboardView. A health record that only exists on days Nick happened
        // to open this tab is what left the calendar grey.
        .onChange(of: health.caloriesToday) { _, value in
            calorieDraft = value == 0 ? "" : String(value)
        }
        .sheet(isPresented: $workoutSheetVisible) {
            WorkoutSheet(health: health) { workoutSheetVisible = false }
        }
        .sheet(isPresented: $supplementSheetVisible) {
            SupplementSheet(health: health) { supplementSheetVisible = false }
        }
        .sheet(isPresented: $nutritionSheetVisible) {
            NutritionSheet(health: health) { nutritionSheetVisible = false }
        }
    }

    // MARK: - What the page says

    /// Everything the captions and hover details are read from. `Trend` is oldest → newest; its `delta` is today
    /// against the mean of the days before, and `baseline` the mean of the nights before last.
    private var reads: HealthReads.Inputs {
        let snapshot = whoop.snapshot
        let week = whoop.week
        return HealthReads.Inputs(
            recovery: snapshot?.recovery, recoveryDelta: week.recovery.delta,
            sleepHours: snapshot?.sleepHours, sleepPerformance: snapshot?.sleepPerformance,
            usualSleepHours: week.sleepHours.baseline, strain: snapshot?.strain,
            hrvDelta: week.hrv.delta, restingHeartRateDelta: week.restingHeartRate.delta,
            days: week.points.count,
            bottles: health.hydrationBottles, bottleTarget: bottleTarget,
            calories: health.caloriesToday, calorieTarget: health.nutritionGoals.calories)
    }

    // MARK: - Headline

    @ViewBuilder private var headline: some View {
        if let snapshot = whoop.snapshot {
            wellnessOverview(snapshot)
        } else {
            whoopEmptyState
        }
    }

    /// Wave 13: the three numbers stand on the page as big light figures, each over a line-art meter, staggered
    /// rather than three equal panels. The day they are about is the kicker over them.
    private func wellnessOverview(_ snapshot: WhoopSnapshot) -> some View {
        let reads = reads
        return VStack(alignment: .leading, spacing: 22) {
            Kicker(text: "WHOOP · \(snapshot.dayLabel)", hue: Color.white.opacity(0.4))
            HStack(alignment: .top, spacing: 58) {
                wellnessRing(title: "Recovery", section: .recovery, tint: recoveryTint(snapshot.recovery),
                             progress: Double(snapshot.recovery ?? 0) / 100, number: snapshot.recovery.map(Double.init), decimals: 0,
                             unit: "%", detail: HealthReads.caption(.recovery, reads), drop: 0, delay: 0.1)
                wellnessRing(title: "Sleep", section: .sleep, tint: OrionTheme.violet,
                             progress: Double(snapshot.sleepPerformance ?? 0) / 100, number: snapshot.sleepHours, decimals: 1,
                             unit: "h", detail: HealthReads.caption(.sleep, reads), drop: 24, delay: 0.25)
                wellnessRing(title: "Strain", section: .activity, tint: OrionTheme.orange,
                             progress: min(1, max(0, (snapshot.strain ?? 0) / 21)), number: snapshot.strain, decimals: 1,
                             unit: "of 21", detail: HealthReads.caption(.activity, reads), drop: 8, delay: 0.4)
                Spacer(minLength: 0)
            }
        }
    }

    /// One number as a ring: it counts up in the centre, the kicker and a short read sit under it, and hovering (or
    /// clicking) floats what it means for today into the stage under the rings.
    private func wellnessRing(title: String, section: HealthSection, tint: Color,
                              progress: Double, number: Double?, decimals: Int, unit: String, detail: String,
                              drop: CGFloat, delay: Double) -> some View {
        VStack(alignment: .center, spacing: 14) {
            HealthRing(progress: number == nil ? 0 : progress, tint: tint, diameter: 132, lineWidth: 4.5, delay: delay) {
                VStack(spacing: 1) {
                    Group {
                        if let number { HealthCount(value: number, decimals: decimals, delay: delay) } else { Text("—") }
                    }
                    .font(OrionTheme.display(36, .light))
                    .foregroundStyle(OrionTheme.text)
                    if number != nil {
                        Text(unit).font(OrionTheme.mono(9.5)).foregroundStyle(Color.white.opacity(0.42))
                    }
                }
            }
            VStack(spacing: 5) {
                Kicker(text: title, hue: tint.opacity(0.9))
                Text(detail)
                    .font(OrionTheme.mono(9.5))
                    .foregroundStyle(Color.white.opacity(0.42))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(width: 150)
            }
        }
        .padding(.top, drop)
        .healthHover(section, ringHover)
    }

    /// Morning: what you woke up with.
    private func recoveryHeadline(_ snapshot: WhoopSnapshot) -> some View {
        HStack(alignment: .center, spacing: 38) {
            RingMeter(progress: Double(snapshot.recovery ?? 0) / 100,
                      value: "\(snapshot.recovery ?? 0)",
                      caption: "recovery",
                      tint: recoveryTint(snapshot.recovery),
                      diameter: 138)

            VStack(alignment: .leading, spacing: 8) {
                phaseLabel("this morning · \(snapshot.dayLabel)")
                Text(snapshot.call.headline)
                    .font(OrionTheme.display(30))
                    .foregroundStyle(recoveryTint(snapshot.recovery))
                Text(snapshot.call.detail)
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textSoft)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 400, alignment: .leading)
                if let sleep = snapshot.sleepPerformance {
                    Text("Slept \(sleep)%"
                         + (snapshot.sleepHours.map { String(format: ", %.1fh in bed", $0) } ?? "")
                         + (snapshot.wokeAt.map { " · up at \($0.formatted(date: .omitted, time: .shortened))" } ?? ""))
                        .font(OrionTheme.mono(11))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
            Spacer(minLength: 0)
            refreshControl(snapshot)
        }
    }

    /// The rest of the day: what you have spent against what today can carry.
    private func strainHeadline(_ snapshot: WhoopSnapshot) -> some View {
        let target = StrainTarget.forRecovery(snapshot.recovery)
        return HStack(alignment: .center, spacing: 38) {
            RingMeter(progress: target.progress(snapshot.strain),
                      value: snapshot.strain.map { String(format: "%.1f", $0) } ?? "—",
                      caption: "strain",
                      subcaption: "of \(Int(target.high))",
                      tint: OrionTheme.orange,
                      diameter: 138)

            VStack(alignment: .leading, spacing: 8) {
                phaseLabel("today so far")
                Text(target.headline)
                    .font(OrionTheme.display(30))
                    .foregroundStyle(OrionTheme.text)
                Text("Recovery came in at \(snapshot.recovery.map { "\($0)" } ?? "—"), "
                     + "which supports a strain of \(Int(target.low))–\(Int(target.high)). "
                     + "You are \(target.verdict(snapshot.strain)).")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textSoft)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 420, alignment: .leading)
            }
            Spacer(minLength: 0)
            refreshControl(snapshot)
        }
    }

    /// Evening: what tonight needs to look like.
    private func eveningHeadline(_ snapshot: WhoopSnapshot) -> some View {
        HStack(alignment: .center, spacing: 38) {
            RingMeter(progress: Double(snapshot.sleepPerformance ?? 0) / 100,
                      value: snapshot.sleepHours.map { String(format: "%.1f", $0) } ?? "—",
                      caption: "hours",
                      subcaption: "last night",
                      tint: OrionTheme.violet,
                      diameter: 138)

            VStack(alignment: .leading, spacing: 8) {
                phaseLabel("winding down")
                Text(eveningCall(snapshot))
                    .font(OrionTheme.display(30))
                    .foregroundStyle(OrionTheme.violet)
                Text(eveningDetail(snapshot))
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textSoft)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 420, alignment: .leading)
            }
            Spacer(minLength: 0)
            refreshControl(snapshot)
        }
    }

    private func eveningCall(_ snapshot: WhoopSnapshot) -> String {
        guard let strain = snapshot.strain else { return "Get a full night" }
        if strain >= 14 { return "Hard day — sleep it off" }
        if strain <= 6 { return "Quiet day" }
        return "Normal night will do"
    }

    private func eveningDetail(_ snapshot: WhoopSnapshot) -> String {
        let baseline = whoop.week.sleepHours.baseline
        let usual = baseline.map { String(format: "%.1fh", $0) } ?? "your usual"
        guard let strain = snapshot.strain else {
            return "No strain logged today. Aim for \(usual)."
        }
        if strain >= 14 {
            return "Strain hit \(String(format: "%.1f", strain)). After a day like that, more than \(usual) is the difference between tomorrow being green or yellow."
        }
        return "Strain came in at \(String(format: "%.1f", strain)). \(usual) should have you recovered."
    }

    private func phaseLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(OrionTheme.mono(9, .semibold))
            .tracking(2.2)
            .foregroundStyle(OrionTheme.textDim)
    }

    private func refreshControl(_ snapshot: WhoopSnapshot) -> some View {
        VStack(alignment: .trailing, spacing: 8) {
            if whoop.isLoading {
                ProgressView().controlSize(.small)
            } else {
                InlineAction(title: "Refresh", systemImage: "arrow.clockwise") { whoop.refresh() }
            }
            Text("synced \(snapshot.capturedAt.formatted(date: .omitted, time: .shortened))")
                .font(OrionTheme.mono(9))
                .foregroundStyle(OrionTheme.textDim)
        }
    }

    // MARK: - The week

    /// Every measure with its own line and its distance from your baseline.
    private var week: some View {
        HairlineSection(title: "Your week", trailing: "\(whoop.week.points.count) days", order: 2) {
            HStack(alignment: .top, spacing: 0) {
                Metric(label: "recovery", trend: whoop.week.recovery, unit: "%",
                       tint: OrionTheme.green, decimals: 0, drop: 0)
                metricDivider
                Metric(label: "sleep", trend: whoop.week.sleepPerformance, unit: "%",
                       tint: OrionTheme.violet, decimals: 0, drop: 16)
                metricDivider
                Metric(label: "hrv", trend: whoop.week.hrv, unit: "ms",
                       tint: OrionTheme.blue, decimals: 0, drop: 0)
                metricDivider
                Metric(label: "resting hr", trend: whoop.week.restingHeartRate, unit: "bpm",
                       tint: OrionTheme.red, decimals: 0, drop: 16)
                metricDivider
                Metric(label: "strain", trend: whoop.week.strain, unit: "",
                       tint: OrionTheme.orange, decimals: 1, drop: 0)
                Spacer(minLength: 0)
            }
            .healthHover(.trends, weekHover)
            HealthHoverStage(controller: weekHover, reads: reads, height: 76)
        }
    }

    private var metricDivider: some View {
        FadingVerticalHairline(peak: 0.2)
            .frame(height: 50)
            .padding(.horizontal, 22)
            .padding(.top, 14)
    }

    // MARK: - The glance rail

    /// The right side should answer the quick question — "how is the day
    /// going?" — while the main column remains the place to log the detail.
    ///
    /// Wave 13: four logs, each a line rather than a tile in a two-by-two grid: what it is, how far along, and the
    /// one outline action that moves it on.
    private var railDailyProgress: some View {
        HairlineSection(title: "Today at a glance", spacing: 4, order: 1, accessory: {
            Button("Food log") { nutritionSheetVisible = true }
                .buttonStyle(.plain)
                .font(OrionTheme.mono(9, .semibold))
                .foregroundStyle(OrionTheme.orange)
        }) {
            VStack(alignment: .leading, spacing: 0) {
                logLine(label: "Water", value: "\(health.hydrationBottles)", unit: "of \(bottleTarget)",
                        progress: Double(health.hydrationBottles) / Double(bottleTarget), tint: OrionTheme.blue,
                        section: .energy) {
                    HStack(spacing: 8) {
                        RailCircleButton(symbol: "minus", tint: OrionTheme.textSoft, help: "One fewer bottle") { health.removeHydration() }
                        RailCircleButton(symbol: "plus", tint: OrionTheme.blue, help: "Drank one") { health.logHydration() }
                    }
                }
                RowHairline()
                logLine(label: "Calories", value: health.caloriesToday > 0 ? "\(health.caloriesToday)" : "—",
                        unit: "of \(health.nutritionGoals.calories)",
                        progress: Double(health.caloriesToday) / Double(max(1, health.nutritionGoals.calories)), tint: OrionTheme.orange,
                        section: .energy) {
                    RailCircleButton(symbol: "arrow.up.right", tint: OrionTheme.orange, help: "Open the food log") { nutritionSheetVisible = true }
                }
                RowHairline()
                logLine(label: "Supplements", value: health.supplements.isEmpty ? "—" : "\(health.takenToday.count)",
                        unit: health.supplements.isEmpty ? nil : "of \(health.supplements.count)",
                        progress: health.supplements.isEmpty ? 0 : Double(health.takenToday.count) / Double(health.supplements.count),
                        tint: OrionTheme.violet) {
                    RailCircleButton(symbol: "chevron.right", tint: OrionTheme.violet, help: "Open the stack") { supplementSheetVisible = true }
                }
                RowHairline()
                logLine(label: "Training", value: health.todaysWorkout.map { "\($0.totalSets)" } ?? "—",
                        unit: health.todaysWorkout == nil ? "not logged" : "sets",
                        progress: health.todaysWorkout == nil ? 0 : 1, tint: OrionTheme.green) {
                    RailCircleButton(symbol: "plus", tint: OrionTheme.green, help: "Log a session") { workoutSheetVisible = true }
                }
            }
        }
    }

    /// One log: a small ring (its count in the middle), the label and unit beside it, and the one round action.
    private func logLine<Action: View>(label: String, value: String, unit: String?, progress: Double, tint: Color,
                                       section: HealthSection? = nil,
                                       @ViewBuilder action: () -> Action) -> some View {
        HStack(alignment: .center, spacing: 14) {
            HealthRing(progress: progress, tint: tint, diameter: 48, lineWidth: 3, delay: 0.3) {
                Text(value)
                    .font(OrionTheme.display(value.count > 4 ? 11 : 15, .light))
                    .foregroundStyle(OrionTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.horizontal, 6)
            }
            VStack(alignment: .leading, spacing: 4) {
                Kicker(text: label, hue: tint.opacity(0.9))
                if let unit {
                    Text(unit).font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
                }
            }
            Spacer(minLength: 8)
            action()
        }
        .padding(.vertical, 11)
        .healthHover(section, railHover)
    }

    // MARK: - Not connected

    /// Every reason Whoop can show nothing, each with the one action that fixes
    /// it. The old version had a single "Connected — waiting for today's data."
    /// which was wrong for most of these and actionable for none of them.
    @ViewBuilder private var whoopEmptyState: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionRule(title: "Recovery", trailing: connections.state(.whoop).label)

            switch connections.state(.whoop) {
            case .cannotRenew:
                VStack(alignment: .leading, spacing: 8) {
                    Text("Whoop needs reconnecting once")
                        .font(OrionTheme.display(22))
                        .foregroundStyle(OrionTheme.orange)
                    Text("This sign-in was granted without offline access, so it cannot renew itself — which is why it asks again every day. Reconnecting once fixes it permanently.")
                        .font(.system(size: 13))
                        .foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 560, alignment: .leading)
                    LogButton(title: "Reconnect Whoop", systemImage: "arrow.clockwise", tint: OrionTheme.orange) {
                        connections.connect(.whoop)
                    }
                    .padding(.top, 4)
                }
            case .connected:
                HStack(spacing: 12) {
                    if whoop.isLoading { ProgressView().controlSize(.small) }
                    Text(whoop.lastError ?? "Connected — waiting for Whoop to score a day.")
                        .font(.system(size: 13))
                        .foregroundStyle(whoop.lastError == nil ? OrionTheme.textSoft : OrionTheme.red)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 620, alignment: .leading)
                    Spacer(minLength: 12)
                    InlineAction(title: "Refresh", systemImage: "arrow.clockwise") { whoop.refresh() }
                }
            case .expired, .failed:
                HStack(spacing: 12) {
                    Text(whoop.lastError ?? connections.state(.whoop).label)
                        .font(.system(size: 13))
                        .foregroundStyle(OrionTheme.red)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 12)
                    InlineAction(title: "Reconnect", systemImage: "arrow.clockwise") {
                        connections.connect(.whoop)
                    }
                }
            default:
                NotConnected(what: "Whoop",
                             detail: "Recovery, sleep, strain and HRV. Settings ▸ Connections.")
            }
        }
    }

    private var water: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Water")
            BigStat(value: "\(health.hydrationBottles)",
                    unit: "of \(bottleTarget) bottles",
                    tint: health.hydrationBottles >= bottleTarget ? OrionTheme.green : OrionTheme.text)
            ZoneBar(value: health.hydrationBottles, target: bottleTarget,
                    zoneLabel: "healthy zone", tint: OrionTheme.blue)
            HStack(spacing: 10) {
                LogButton(title: "Drank one", tint: OrionTheme.blue) { health.logHydration() }
                StepButton(systemImage: "minus") { health.removeHydration() }
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var calories: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Nutrition")
            BigStat(value: health.caloriesToday == 0 ? "—" : "\(health.caloriesToday)",
                    unit: "of \(health.nutritionGoals.calories) kcal", tint: OrionTheme.orange)
            Text("Meals, macros, targets, recent foods, and daily history live in the food log.")
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
            LogButton(title: "Open food log", tint: OrionTheme.orange) { nutritionSheetVisible = true }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Counts and an action. The full list lives in a sheet, because a column
    /// that grows with the number of supplements is a column that eventually
    /// owns the screen — which is exactly what went wrong before.
    private var supplements: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Supplements")
            BigStat(value: "\(health.takenToday.count)",
                    unit: "of \(health.supplements.count)",
                    tint: health.supplements.isEmpty
                        ? OrionTheme.textDim
                        : (health.takenToday.count == health.supplements.count
                            ? OrionTheme.green : OrionTheme.text))
            if health.supplements.isEmpty {
                Text("Nothing set up yet.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            } else {
                ZoneBar(value: health.takenToday.count,
                        target: max(1, health.supplements.count),
                        zoneLabel: "on track",
                        tint: OrionTheme.violet)
                // Only what is still outstanding — the done ones need no space.
                let remaining = health.supplements.filter { !health.takenToday.contains($0.id) }
                if remaining.isEmpty {
                    Text("All taken today.")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.green)
                } else {
                    Text("left: " + remaining.prefix(3).map(\.name).joined(separator: ", ")
                         + (remaining.count > 3 ? " +\(remaining.count - 3)" : ""))
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            LogButton(title: "Open stack", systemImage: "arrow.right", tint: OrionTheme.violet) {
                supplementSheetVisible = true
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var workout: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Workout")
            if let session = health.todaysWorkout, session.totalSets > 0 {
                BigStat(value: "\(session.totalSets)", unit: "sets", tint: OrionTheme.green)
                Text("\(Int(session.volume)) total load")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
                Text(session.exercises.map(\.name).joined(separator: " · "))
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textSoft)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                BigStat(value: "—", unit: "sets", tint: OrionTheme.textDim)
                Text("Nothing logged today.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }
            LogButton(title: "Open session", systemImage: "arrow.right", tint: OrionTheme.green) {
                workoutSheetVisible = true
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A small outline circle around one glyph: the rail's per-log action. Stroke, a whisper of fill, no plate.
private struct RailCircleButton: View {
    let symbol: String
    let tint: Color
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(Circle().fill(tint.opacity(hovering ? 0.14 : 0.05)))
                .overlay(Circle().strokeBorder(tint.opacity(hovering ? 0.9 : 0.5), lineWidth: 0.8))
                .shadow(color: tint.opacity(hovering ? 0.45 : 0), radius: 6)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
        .help(help)
        .accessibilityLabel(help)
    }
}

/// One takeaway: a coloured tick, what it is about, and what it means.
///
/// The label carries the colour and the sentence carries the meaning, so the
/// rail can be scanned by colour and read only where it matters. No fills — the
/// hairlines between rows do the separating, same as everywhere else.
struct TakeawayRow: View {
    let takeaway: Takeaway

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Capsule()
                .fill(takeaway.tint)
                .frame(width: 2, height: 13)
                .padding(.top, 3)
                .shadow(color: takeaway.tint.opacity(0.7), radius: 3)

            VStack(alignment: .leading, spacing: 4) {
                Text(takeaway.label)
                    .font(OrionTheme.mono(8, .semibold))
                    .tracking(1.6)
                    .foregroundStyle(takeaway.tint)
                Text(takeaway.text)
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.text.opacity(0.88))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One metric across the week: today's value, how far it is from your own
/// baseline, and the shape of the line that got there.
private struct Metric: View {
    let label: String
    let trend: Trend
    let unit: String
    let tint: Color
    let decimals: Int
    /// The stagger. Alternating heights is what keeps five readings in a row
    /// from reading as five cells of a table.
    let drop: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased())
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.6)
                .foregroundStyle(tint.opacity(0.85))

            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(trend.latest.map { String(format: "%.\(decimals)f", $0) } ?? "—")
                    .font(OrionTheme.display(26))
                    .foregroundStyle(OrionTheme.text)
                if !unit.isEmpty {
                    Text(unit)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }

            if let delta = trend.deltaLabel(decimals: decimals) {
                Text("\(delta) vs avg")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            } else {
                Text(" ")
                    .font(OrionTheme.mono(9))
            }

            if trend.hasShape {
                Sparkline(points: trend.normalised, tint: tint, height: 22)
                    .frame(width: 78)
            }
        }
        .padding(.top, drop)
    }
}
