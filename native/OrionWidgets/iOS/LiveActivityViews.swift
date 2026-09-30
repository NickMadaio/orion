import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit
import MobileCore
#if canImport(AlarmKit)
import AlarmKit
#endif

struct OrionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: OrionActivityAttributes.self) { context in
            LockScreenPresence(state: context.state)
                .activityBackgroundTint(W.ink.opacity(0.92))
                .activitySystemActionForegroundColor(W.text)
                .widgetURL(W.link("home"))
        } dynamicIsland: { context in
            let state = context.state
            let tint = Self.tint(state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HologramArt(mood: OrionGlance.Mood(rawValue: state.mood) ?? .calm, mini: true).frame(width: 52, height: 52)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Timer(state: state).font(W.mono(15, .bold)).foregroundStyle(tint).frame(maxWidth: 80, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(state.title).font(W.display(15, .bold)).lineLimit(1)
                        Text(state.detail).font(.system(size: 12)).foregroundStyle(W.soft).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    CheckinButtons(state: state, tint: tint)
                }
            } compactLeading: {
                Image(systemName: state.mode == "checkin" ? "bell.badge.fill" : state.mode == "snoozed" ? "zzz" : "sparkle").foregroundStyle(tint)
            } compactTrailing: {
                Timer(state: state).font(W.mono(12, .semibold)).foregroundStyle(tint).frame(maxWidth: 50)
            } minimal: {
                Image(systemName: state.mode == "checkin" ? "bell.badge.fill" : state.mode == "snoozed" ? "zzz" : "sparkle").foregroundStyle(tint)
            }
            .keylineTint(tint)
            .widgetURL(W.link("home"))
        }
    }

    static func tint(_ state: OrionActivityAttributes.ContentState) -> Color {
        if state.mode == "checkin" { return state.level >= 2 ? W.red : W.accent }
        if state.mode == "snoozed" { return W.gold }
        if state.mode == "active" { return W.violet }
        return W.tint(state.kind)
    }
}

/// Counts down to the end of what's on, or to the start of what's next.
private struct Timer: View {
    let state: OrionActivityAttributes.ContentState
    var body: some View {
        if state.mode == "checkin" {
            Text(state.level >= 2 ? "Now" : "Due")
        } else if state.mode == "active" {
            Text(timerInterval: state.start...max(state.start, Date().addingTimeInterval(8 * 3600)), countsDown: false)
        } else {
            let target = state.mode == "next" ? state.start : state.end
            Text(timerInterval: Date()...max(Date(), target), countsDown: true).multilineTextAlignment(.trailing)
        }
    }
}

private struct CheckinButtons: View {
    let state: OrionActivityAttributes.ContentState
    let tint: Color
    var body: some View {
        if state.mode == "checkin" || state.mode == "snoozed" {
            HStack(spacing: 8) {
                Button(intent: OrionWidgetIntent(.started)) { Text("Started").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(tint: tint, filled: true))
                if state.mode == "checkin" {
                    Button(intent: OrionWidgetIntent(.snooze)) { Text("10 min").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(tint: W.soft, filled: false))
                }
                Button(intent: OrionWidgetIntent(.done)) { Text("Done").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(tint: tint, filled: false))
            }
        } else if state.mode == "active" {
            Button(intent: OrionWidgetIntent(.done)) { Text("Done").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(tint: tint, filled: true))
        } else if let next = state.nextTitle, let at = state.nextAt {
            HStack {
                Text("Then \(next)").font(.system(size: 12)).foregroundStyle(W.soft).lineLimit(1)
                Spacer()
                Text(W.clock(at)).font(W.mono(11)).foregroundStyle(W.dim)
            }
        }
    }
}

struct LockScreenPresence: View {
    let state: OrionActivityAttributes.ContentState
    var body: some View {
        let tint = OrionLiveActivity.tint(state)
        HStack(alignment: .center, spacing: 12) {
            HologramArt(mood: OrionGlance.Mood(rawValue: state.mood) ?? .calm, mini: true).frame(width: 64, height: 64).padding(-6)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(label).textCase(.uppercase).font(W.mono(9)).tracking(1.3).foregroundStyle(tint)
                    Spacer()
                    Timer(state: state).font(W.mono(13, .bold)).foregroundStyle(tint)
                }
                Text(state.title).font(W.display(17, .bold)).foregroundStyle(W.text).lineLimit(1)
                if state.mode == "now" {
                    ProgressView(timerInterval: state.start...state.end, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                        .tint(tint)
                } else {
                    Text(state.detail).font(.system(size: 12)).foregroundStyle(W.soft).lineLimit(1)
                }
                CheckinButtons(state: state, tint: tint)
            }
        }
        .padding(14)
    }

    private var label: String {
        switch state.mode {
        case "checkin": return state.level >= 2 ? "ORION · still waiting" : "ORION · check-in"
        case "snoozed": return "ORION · snoozed"
        case "active": return "ORION · on it"
        case "next": return "ORION · up next"
        default: return "ORION · now"
        }
    }
}

#if canImport(AlarmKit)
/// The wake alarm's snooze countdown on the lock screen (AlarmKit asks for it).
@available(iOS 26.0, *)
struct WakeAlarmActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<WakeMetadata>.self) { context in
            HStack(spacing: 12) {
                Image(systemName: "alarm.fill").font(.system(size: 22)).foregroundStyle(W.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Snoozing").font(W.display(16, .bold)).foregroundStyle(W.text)
                    countdown(context.state)
                }
                Spacer()
            }
            .padding(14)
            .activityBackgroundTint(W.ink.opacity(0.92))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    HStack { Image(systemName: "alarm.fill").foregroundStyle(W.accent); countdown(context.state) }
                }
            } compactLeading: {
                Image(systemName: "alarm.fill").foregroundStyle(W.accent)
            } compactTrailing: {
                countdown(context.state).frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "alarm.fill").foregroundStyle(W.accent)
            }
        }
    }

    @ViewBuilder
    private func countdown(_ state: AlarmPresentationState) -> some View {
        if case .countdown(let countdown) = state.mode {
            Text(timerInterval: Date()...countdown.fireDate, countsDown: true).font(W.mono(13, .semibold)).foregroundStyle(W.soft)
        } else {
            Text("Wake up").font(W.mono(13, .semibold)).foregroundStyle(W.soft)
        }
    }
}
#endif
