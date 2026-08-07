import SwiftUI

/*
 Health, and what the day is asking of you right now.

 The complaint this rebuild answers: "the only big metric is yesterday's
 recovery, unless it's the morning." Which was fair. Recovery is a morning
 number — it is computed once, from the night you just had, and by two in the
 afternoon it is history. A dashboard whose headline never changes is a
 dashboard you stop looking at after breakfast.

 So the headline moves with the day:

   MORNING   recovery and sleep. What you woke up with.
   DAY       strain against the band that recovery bought you. What you have
             spent, and what is left.
   EVENING   what tonight needs to look like.

 The phase comes from the LOGICAL day (OrionDay), not the clock, so a day that
 started at 11am is four hours old at 3pm rather than most of the way through.

 And the week is on screen now. Orion was already downloading seven days and
 keeping one; every reading carries its own line and how far today sits from
 your own baseline, which is the difference between "HRV 71" and "HRV 71, eight
 above normal for you."
*/

struct HealthTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var whoop: WhoopClient
    @ObservedObject var health: HealthLog
    @ObservedObject var connections: ConnectionsModel
    let day: LogicalDay
    @ObservedObject var writer: NarrativeWriter

    @State private var workoutSheetVisible = false
    @State private var supplementSheetVisible = false

    private let bottleTarget = 9

    /// Where the day is, measured from when it actually began.
    private enum Phase { case morning, day, evening }

    private var phase: Phase {
        let hoursUp = day.elapsed / 3600
        // Falls back to the clock when the day start is only the 4am floor and
        // the hours-up figure would be fiction.
        let hour = Calendar.current.component(.hour, from: Date())
        if hoursUp < 4 && hour < 14 { return .morning }
        if hour >= 20 || hoursUp > 14 { return .evening }
        return .day
    }

    var body: some View {
        HStack(alignment: .top, spacing: 44) {
            VStack(alignment: .leading, spacing: 40) {
                headline
                if !whoop.week.isEmpty { week }
                logging
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            readingRail
                .frame(width: 262)
                .padding(.top, 44)
        }
        .onAppear(perform: loadSummary)
        .onChange(of: whoop.snapshot) { _, _ in loadSummary() }
        .onChange(of: state.hydrationBottles) { _, _ in loadSummary() }
        .onChange(of: health.takenToday) { _, _ in loadSummary() }
        .sheet(isPresented: $workoutSheetVisible) {
            WorkoutSheet(health: health) { workoutSheetVisible = false }
        }
        .sheet(isPresented: $supplementSheetVisible) {
            SupplementSheet(health: health) { supplementSheetVisible = false }
        }
    }

    // MARK: - Headline

    @ViewBuilder private var headline: some View {
        if let snapshot = whoop.snapshot {
            switch phase {
            case .morning: recoveryHeadline(snapshot)
            case .day: strainHeadline(snapshot)
            case .evening: eveningHeadline(snapshot)
            }
        } else {
            whoopEmptyState
        }
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

    /// Every reading with its own line and its distance from your baseline.
    private var week: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionRule(title: "Your week", trailing: "\(whoop.week.points.count) days")
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
        }
    }

    private var metricDivider: some View {
        Rectangle()
            .fill(OrionTheme.line)
            .frame(width: 1, height: 46)
            .padding(.horizontal, 22)
            .padding(.top, 14)
    }

    // MARK: - What Orion makes of it

    /// The numbers say what they are; this says what they mean together.
    ///
    /// Written by a local model and cached per day and phase, so it is composed
    /// about three times a day rather than every time a bottle of water is
    /// logged — which would be both wasteful and unsettling to watch rewrite
    /// itself under you.
    @ViewBuilder private var readingRail: some View {
        if whoop.snapshot != nil || state.hydrationBottles > 0 {
            VStack(alignment: .leading, spacing: 14) {
                SectionRule(title: "Orion reads this as")

                if let text = writer.text {
                    Text(text)
                        .font(.system(size: 13))
                        .foregroundStyle(OrionTheme.text.opacity(0.88))
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .transition(.opacity)
                } else if writer.isWriting {
                    Text("Reading the numbers…")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                } else {
                    // Says why rather than showing an empty column. The tab is
                    // complete without this, and it should look deliberate
                    // rather than broken.
                    Text("The local model is not running, so there is no summary — every number on this page is still live.")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if writer.text != nil {
                    FadingRule()
                    Text("written on this Mac by \(LocalModel.defaultModel)")
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
        }
    }

    private var summaryFacts: HealthFacts {
        HealthFacts(
            dayKey: day.key,
            phase: phaseName,
            recovery: whoop.snapshot?.recovery,
            recoveryDelta: whoop.week.recovery.deltaLabel(),
            sleepPerformance: whoop.snapshot?.sleepPerformance,
            sleepHours: whoop.snapshot?.sleepHours,
            hrv: whoop.snapshot?.hrvMilliseconds,
            hrvDelta: whoop.week.hrv.deltaLabel(),
            restingHeartRate: whoop.snapshot?.restingHeartRate,
            rhrDelta: whoop.week.restingHeartRate.deltaLabel(),
            strain: whoop.snapshot?.strain,
            strainTarget: StrainTarget.forRecovery(whoop.snapshot?.recovery),
            bottles: state.hydrationBottles,
            bottleTarget: bottleTarget,
            supplementsTaken: health.takenToday.count,
            supplementsTotal: health.supplements.count,
            workoutSets: health.todaysWorkout?.totalSets ?? 0
        )
    }

    private var phaseName: String {
        switch phase {
        case .morning: return "morning"
        case .day: return "day"
        case .evening: return "evening"
        }
    }

    private func loadSummary() {
        let facts = summaryFacts
        writer.load(key: facts.narrativeKey) { facts.prompt() }
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

    // MARK: - Logging

    private var logging: some View {
        HStack(alignment: .top, spacing: 46) {
            water
            supplements.padding(.top, 30)
            workout.padding(.top, 60)
        }
    }

    private var water: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Water")
            BigStat(value: "\(state.hydrationBottles)",
                    unit: "of \(bottleTarget) bottles",
                    tint: state.hydrationBottles >= bottleTarget ? OrionTheme.green : OrionTheme.text)
            ZoneBar(value: state.hydrationBottles, target: bottleTarget,
                    zoneLabel: "healthy zone", tint: OrionTheme.blue)
            HStack(spacing: 10) {
                LogButton(title: "Drank one", tint: OrionTheme.blue) { state.logHydration() }
                StepButton(systemImage: "minus") { state.removeHydration() }
            }
            .padding(.top, 2)
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
