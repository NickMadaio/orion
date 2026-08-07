import SwiftUI

/// Health: recovery leads, vitals read across, and the three things Nick logs
/// sit underneath on a staircase rather than in a row of three equal cards.
///
/// Recovery is not as important as a water counter — it is the number the whole
/// day hangs on, so it gets the width, the size and the top of the page. The
/// logging columns are deliberately staggered downward: same content as a grid,
/// none of the "three identical boxes" read that made the old version feel like
/// a settings screen.
struct HealthTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var whoop: WhoopClient
    @ObservedObject var health: HealthLog
    @ObservedObject var connections: ConnectionsModel

    @State private var workoutSheetVisible = false
    @State private var supplementSheetVisible = false

    private let bottleTarget = 9

    var body: some View {
        VStack(alignment: .leading, spacing: 42) {
            recovery
            if whoop.snapshot != nil { vitals }
            logging
        }
        .sheet(isPresented: $workoutSheetVisible) {
            WorkoutSheet(health: health) { workoutSheetVisible = false }
        }
        .sheet(isPresented: $supplementSheetVisible) {
            SupplementSheet(health: health) { supplementSheetVisible = false }
        }
    }

    // MARK: - Recovery

    @ViewBuilder private var recovery: some View {
        if let snapshot = whoop.snapshot {
            HStack(alignment: .center, spacing: 38) {
                RingMeter(progress: Double(snapshot.recovery ?? 0) / 100,
                          value: "\(snapshot.recovery ?? 0)",
                          caption: "recovery",
                          tint: recoveryTint(snapshot.recovery),
                          diameter: 132)

                VStack(alignment: .leading, spacing: 8) {
                    Text(snapshot.dayLabel.uppercased())
                        .font(OrionTheme.mono(9, .semibold))
                        .tracking(2.2)
                        .foregroundStyle(OrionTheme.textDim)
                    Text(snapshot.call.headline)
                        .font(OrionTheme.display(28))
                        .foregroundStyle(recoveryTint(snapshot.recovery))
                    Text(snapshot.call.detail)
                        .font(.system(size: 13))
                        .foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 420, alignment: .leading)
                }

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 8) {
                    if whoop.isLoading {
                        ProgressView().controlSize(.small)
                    } else {
                        InlineAction(title: "Refresh", systemImage: "arrow.clockwise") {
                            whoop.refresh()
                        }
                    }
                    Text("synced \(snapshot.capturedAt.formatted(date: .omitted, time: .shortened))")
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
        } else {
            whoopEmptyState
        }
    }

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

    // MARK: - Vitals

    /// Readings that run across the page, separated by hairlines and set at
    /// alternating heights. No tiles: five squares in a row is the grid this
    /// design is replacing.
    @ViewBuilder private var vitals: some View {
        if let snapshot = whoop.snapshot {
            HStack(alignment: .top, spacing: 0) {
                Vital(label: "sleep", value: snapshot.sleepPerformance.map { "\($0)" } ?? "—",
                      unit: "%", tint: OrionTheme.violet, drop: 0)
                vitalDivider
                Vital(label: "in bed", value: snapshot.sleepHours.map { String(format: "%.1f", $0) } ?? "—",
                      unit: "h", tint: OrionTheme.violet, drop: 14)
                vitalDivider
                Vital(label: "strain", value: snapshot.strain.map { String(format: "%.1f", $0) } ?? "—",
                      unit: "", tint: OrionTheme.orange, drop: 0)
                vitalDivider
                Vital(label: "hrv", value: snapshot.hrvMilliseconds.map { "\($0)" } ?? "—",
                      unit: "ms", tint: OrionTheme.blue, drop: 14)
                vitalDivider
                Vital(label: "resting hr", value: snapshot.restingHeartRate.map { "\($0)" } ?? "—",
                      unit: "bpm", tint: OrionTheme.red, drop: 0)
                Spacer(minLength: 0)
            }
        }
    }

    private var vitalDivider: some View {
        Rectangle()
            .fill(OrionTheme.line)
            .frame(width: 1, height: 34)
            .padding(.horizontal, 26)
            .padding(.top, 16)
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

/// One reading. A label, a number, and nothing drawn around it.
private struct Vital: View {
    let label: String
    let value: String
    let unit: String
    let tint: Color
    /// How far down the page this one sits. The alternation is the point.
    let drop: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.6)
                .foregroundStyle(tint.opacity(0.85))
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(OrionTheme.display(26))
                    .foregroundStyle(OrionTheme.text)
                if !unit.isEmpty {
                    Text(unit)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
        }
        .padding(.top, drop)
    }
}
