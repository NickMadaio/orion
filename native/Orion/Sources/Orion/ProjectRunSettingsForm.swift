import SwiftUI

/*
 The project's run settings as a quiet form: grouped by space and fading hairlines, mono kickers, pill choices and
 round switches. Everything it edits is a binding owned by ProjectTab, so the start command reads the same state as
 before. The primary action (Start) stays in the console above as the one glow pill; nothing here competes with it.
*/
struct ProjectRunSettingsForm: View {
    @Binding var stopRule: ProjectRunStopRule
    @Binding var stopAt: Date
    @Binding var options: ProjectLaunchOptions
    @Binding var nudgeInterval: Int
    var suggestion: (title: String, time: Date)? = nil
    var preflight: ProjectPreflight?
    var problem: String?
    var checking: Bool
    var enabled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            HairlineSection(title: "Run until", spacing: 14) {
                VStack(alignment: .leading, spacing: 14) {
                    ProjectPillChoice(options: ProjectRunStopRule.allCases.map { ($0, $0.label) }, selection: $stopRule)
                    if stopRule == .atTime { timeRow.transition(.opacity.combined(with: .move(edge: .top))) }
                }
            }
            HairlineSection(title: "Keep awake", spacing: 6) {
                ProjectKeepAwakeOptions(options: $options, nudgeInterval: $nudgeInterval, preflight: preflight,
                                        problem: problem, checking: checking)
            }
            if !enabled {
                Text("Enable & start allows local execution for your saved projects.")
                    .font(.system(size: 11.5)).foregroundStyle(OrionTheme.textDim)
            }
        }
        .animation(OrionMotion.page, value: stopRule)
        .padding(.top, 20)
    }

    private var timeRow: some View {
        HStack(spacing: 12) {
            Text("STOP AT").font(OrionTheme.mono(9, .semibold)).tracking(2).foregroundStyle(OrionTheme.textDim)
            DatePicker("Stop at", selection: $stopAt, in: Date().addingTimeInterval(60)..., displayedComponents: [.hourAndMinute])
                .labelsHidden().datePickerStyle(.field)
                .padding(.horizontal, 10).padding(.vertical, 3)
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.14), lineWidth: 0.8))
            if let suggestion {
                ProjectBubble(text: "Before \(suggestion.title) · \(suggestion.time.formatted(date: .omitted, time: .shortened))",
                              symbol: "clock") { stopAt = suggestion.time }
                    .help("Stop 30 minutes before \(suggestion.title)")
            }
        }
    }
}

/// The collapsed line above the form: a kicker, what the settings come to, and a turning chevron.
struct ProjectRunSettingsHeader: View {
    @Binding var open: Bool
    let summary: String
    var warnings: [String] = []

    var body: some View {
        Button { withAnimation(OrionMotion.page) { open.toggle() } } label: {
            HStack(spacing: 12) {
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                    .foregroundStyle(OrionTheme.textSoft).rotationEffect(.degrees(open ? 90 : 0))
                Text("RUN SETTINGS").font(OrionTheme.mono(9.5, .semibold)).tracking(2.3).foregroundStyle(OrionTheme.accent.opacity(0.9))
                Text(summary).font(OrionTheme.mono(10.5)).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
                if !warnings.isEmpty {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10)).foregroundStyle(OrionTheme.orange)
                        .help(warnings.joined(separator: "\n\n"))
                }
                FadingRule()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/*
 Keep-awake choices for the next start, and a read of this Mac as it is now. Round switches, one row each with a
 muted line saying what it does; the preflight line and its warnings are worded by awake.mjs and only laid out and
 coloured here, so the app and the launch receipt never describe the same Mac in two ways.
*/
struct ProjectKeepAwakeOptions: View {
    @Binding var options: ProjectLaunchOptions
    @Binding var nudgeInterval: Int
    let preflight: ProjectPreflight?
    let problem: String?
    let checking: Bool

    private var nudging: Binding<Bool> {
        Binding(get: { options.nudgeMinutes > 0 }, set: { options.nudgeMinutes = $0 ? nudgeInterval : 0 })
    }
    private var interval: Binding<Int> {
        Binding(get: { nudgeInterval }, set: { nudgeInterval = $0; if options.nudgeMinutes > 0 { options.nudgeMinutes = $0 } })
    }
    /// Keep-awake off on a short idle sleep is worth saying before the start, not after.
    private var sleepsAfter: Int? {
        guard !options.preventSleep, let minutes = preflight?.idleSleepMinutes, minutes > 0 else { return nil }
        return minutes
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            row("Keep this Mac awake while it runs", "Stops idle sleep so an overnight run does not stall.", $options.preventSleep)
            Group {
                RowHairline()
                row("Keep the display on", "The run view stays open and the screen lit.", $options.keepDisplayOn)
                RowHairline()
                row("Nudge activity", options.nudgeMinutes > 0
                        ? "Declares activity the way moving the mouse does, so it also wakes the display each time."
                        : "Off.", nudging) {
                    ProjectRoundStepper(value: interval, range: 1...60).opacity(options.nudgeMinutes > 0 ? 1 : 0.35)
                        .disabled(options.nudgeMinutes == 0)
                }
            }
            .disabled(!options.preventSleep)
            .opacity(options.preventSleep ? 1 : 0.4)
            preflightLines.padding(.top, 14)
        }
        .animation(OrionMotion.page, value: options.nudgeMinutes > 0)
    }

    private func row(_ title: String, _ detail: String, _ isOn: Binding<Bool>) -> some View {
        row(title, detail, isOn) { EmptyView() }
    }

    private func row<Trailing: View>(_ title: String, _ detail: String, _ isOn: Binding<Bool>,
                                     @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(OrionTheme.text)
                Text(detail).font(.system(size: 11.5)).foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            trailing()
            ProjectRoundToggle(isOn: isOn)
        }
        .padding(.vertical, 12)
    }

    @ViewBuilder private var preflightLines: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let preflight {
                Label(preflight.summary, systemImage: preflight.warnings.isEmpty ? "checkmark.circle" : "exclamationmark.triangle")
                    .font(.system(size: 12)).foregroundStyle(preflight.warnings.isEmpty ? OrionTheme.textSoft : OrionTheme.orange)
                ForEach(preflight.warnings, id: \.self) { warning in
                    Text(warning).font(.system(size: 11)).foregroundStyle(OrionTheme.orange.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                }
            } else if let problem {
                Label(problem, systemImage: "questionmark.circle").font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft)
            } else if checking {
                Label("Checking power and lid…", systemImage: "hourglass").font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft)
            }
            if let sleepsAfter {
                Text("With keep-awake off, this Mac sleeps after \(sleepsAfter) min idle and the run stalls until it wakes.")
                    .font(.system(size: 11)).foregroundStyle(OrionTheme.orange.opacity(0.9))
            }
        }
    }
}
