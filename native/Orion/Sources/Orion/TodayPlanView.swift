import SwiftUI
import MobileCore

struct TodayPlanView: View {
    @ObservedObject var model: TodayPlanModel
    var refresh: () -> Void
    @State private var settingsExpanded = false
    @State private var timelineExpanded = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Today").font(.system(size: 30, weight: .semibold, design: .rounded))
                    Spacer()
                    Button("Refresh sources", action: refresh).buttonStyle(.plain).foregroundStyle(OrionTheme.accent)
                }
                Text(model.inputs?.isFresh(at: context.date) == true ? model.sourceMessage : "Source data is missing or out of date. Refresh before making a plan.")
                    .font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
                if let error = model.error {
                    Text(error).font(.system(size: 12)).foregroundStyle(OrionTheme.orange)
                }
                if let plan = model.proposal ?? model.current(at: context.date) {
                    TodayPlanContent(plan: plan, previous: model.current(at: context.date), now: context.date,
                                     isProposal: model.proposal != nil,
                                     needsReview: !model.sourcesMatch(plan, at: context.date), expanded: $timelineExpanded,
                                     finish: { model.preview(.finish($0)) }, moreTime: { model.preview(.moreTime($0)) })
                    if model.proposal != nil {
                        HStack {
                            Button("Accept this plan") { model.accept() }.buttonStyle(.borderedProminent).tint(OrionTheme.accent)
                            Button("Discard preview") { model.dismissProposal() }.buttonStyle(.plain)
                            Text("Preview only until accepted").font(.caption).foregroundStyle(OrionTheme.textSoft)
                        }
                        .disabled(model.isSaving)
                    } else {
                        HStack(spacing: 18) {
                            Button("Running late · replan from now") { model.preview(.replan) }
                            if model.document.hasUndo { Button("Undo last plan change") { model.undo() } }
                        }.buttonStyle(.plain).foregroundStyle(OrionTheme.accent).disabled(model.isSaving)
                    }
                } else {
                    Text(model.loaded ? "Give the rest of your day a realistic shape." : "Loading your saved plan…")
                        .font(.system(size: 19, weight: .medium))
                    Text("Review the time budgets below, then preview a plan from your calendar and the Orion Reminders list.")
                        .font(.system(size: 13)).foregroundStyle(OrionTheme.textSoft)
                }
                DisclosureGroup("Day boundaries and task estimates", isExpanded: $settingsExpanded) {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Starting assumptions, not learned preferences. Off-hours and free time are protected before work is placed.")
                            .font(.caption).foregroundStyle(OrionTheme.textSoft)
                        HStack(spacing: 24) {
                            minutePicker("Day starts", selection: $model.preferences.wakeMinute, range: Array(stride(from: 0, through: 720, by: 30)))
                            minutePicker("Day ends", selection: $model.preferences.sleepMinute, range: Array(stride(from: 1080, through: 1440, by: 30)))
                        }
                        Stepper("Minimum sleep: \(model.preferences.minimumSleepMinutes / 60) hours", value: $model.preferences.minimumSleepMinutes, in: 360...720, step: 60)
                        Stepper("Protected free time: \(model.preferences.freeMinutes) min", value: $model.preferences.freeMinutes, in: 0...240, step: 15)
                        Stepper("Transition around commitments: \(model.preferences.transitionMinutes) min", value: $model.preferences.transitionMinutes, in: 0...60, step: 5)
                        Stepper("Default task estimate: \(model.preferences.defaultTaskMinutes) min", value: $model.preferences.defaultTaskMinutes, in: 5...240, step: 5)
                        if let inputs = model.inputs {
                            ForEach(inputs.tasks.filter { !$0.completedInSource }) { task in
                                Stepper("\(task.title): \(model.estimate(for: task.id)) min",
                                        value: Binding(get: { model.estimate(for: task.id) }, set: { model.setEstimate(task.id, minutes: $0) }),
                                        in: 5...240, step: 5)
                            }
                        }
                    }.font(.system(size: 12)).padding(.top, 12)
                }.font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
                HStack {
                    Button(model.current() == nil ? "Preview my day" : "Preview updated plan") { model.preview(.plan) }
                        .buttonStyle(.bordered).disabled(!model.loaded || model.isSaving || model.inputs?.isFresh(at: context.date) != true)
                    if model.isSaving { ProgressView().controlSize(.small) }
                }
                Text("Plan changes stay on this Mac. Finish block records work in this plan; edit the original reminder in Tasks. Calendar commitments are never moved here.")
                    .font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft)
            }
            .foregroundStyle(OrionTheme.text)
            .frame(maxWidth: 900, alignment: .leading)
            .padding(.vertical, 16)
        }
    }

    private func minutePicker(_ title: String, selection: Binding<Int>, range: [Int]) -> some View {
        Picker(title, selection: selection) {
            ForEach(range, id: \.self) { minute in
                Text(String(format: "%02d:%02d", minute / 60, minute % 60)).tag(minute)
            }
        }.frame(maxWidth: 250)
    }
}
