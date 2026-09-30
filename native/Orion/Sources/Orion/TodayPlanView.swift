import SwiftUI
import MobileCore

/*
 ORION's plan for the day, on the Tasks tab (2026-09-28).

 It used to be the whole Home page (Astra's Today plan, 2026-09-08), a long
 column of settings and paragraphs above the orb. Nick wanted Home back, and the
 plan belongs beside the things it arranges -- the task list and the calendar --
 so it lives here now, and it says less: one button to plan, the blocks, and
 the few controls a day actually needs. The time budgets fold away.

 The same plan is on the phone. "Plan my day" there asks this app to do exactly
 what the button here does (PhonePlanRequests), and a plan made on either side
 is the one both show.
*/
struct TodayPlanView: View {
    @ObservedObject var model: TodayPlanModel
    var refresh: () -> Void
    @State private var showsBudgets = false
    @State private var timelineExpanded = true

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let now = context.date
            let usable = model.hasUsableSources(at: now)
            VStack(alignment: .leading, spacing: 14) {
                SectionRule(title: "ORION's plan", trailing: trailing(now))
                if let error = model.error {
                    Text(error).font(.system(size: 12)).foregroundStyle(OrionTheme.orange)
                }
                if let plan = model.proposal ?? model.current(at: now) {
                    TodayPlanContent(plan: plan, previous: model.current(at: now), now: now,
                                     isProposal: model.proposal != nil,
                                     needsReview: model.proposal == nil && !model.sourcesMatch(plan, at: now),
                                     expanded: $timelineExpanded,
                                     finish: { model.preview(.finish($0)) }, moreTime: { model.preview(.moreTime($0)) },
                                     togglePin: { id in
                                         model.preview(plan.blocks.first(where: { $0.sourceID == id })?.pinned == true ? .unpin(id) : .pin(id))
                                     })
                    actions(plan: plan, usable: usable)
                } else {
                    empty(usable: usable)
                }
                budgets
            }
            .foregroundStyle(OrionTheme.text)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func trailing(_ now: Date) -> String {
        if model.isSaving { return "saving…" }
        if model.proposal != nil { return "preview" }
        if let plan = model.current(at: now) { return "made \(plan.generatedAt.formatted(date: .omitted, time: .shortened))" }
        return ""
    }

    @ViewBuilder private func empty(usable: Bool) -> some View {
        Text(model.loaded ? "Fit today's tasks into the gaps between your events, with free time kept free."
                          : "Loading your saved plan…")
            .font(.system(size: 13)).foregroundStyle(OrionTheme.textSoft)
            .fixedSize(horizontal: false, vertical: true)
        HStack(spacing: 12) {
            Button { model.preview(.plan) } label: { Label("Plan my day", systemImage: "sparkles") }
                .buttonStyle(PlanButtonStyle(prominent: true))
                .disabled(!model.loaded || model.isSaving || !usable)
            if !usable { sourcesNote }
        }
    }

    @ViewBuilder private func actions(plan: TodayPlan, usable: Bool) -> some View {
        if model.proposal != nil {
            HStack(spacing: 12) {
                Button("Keep this plan") { model.accept() }
                    .buttonStyle(PlanButtonStyle(prominent: true)).disabled(!usable || model.isSaving)
                Button("Discard") { model.dismissProposal() }.buttonStyle(PlanButtonStyle())
                if !usable { sourcesNote }
            }
        } else {
            HStack(spacing: 12) {
                Button { model.preview(.replan) } label: { Label("Replan from now", systemImage: "arrow.clockwise") }
                    .buttonStyle(PlanButtonStyle()).disabled(!usable || model.isSaving)
                if model.document.hasUndo {
                    Button { model.undo() } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                        .buttonStyle(PlanButtonStyle()).disabled(model.isSaving)
                }
                if plan.blocks.contains(where: \.pinned) {
                    Button("Release pins") { model.preview(.unpinAll) }.buttonStyle(PlanButtonStyle())
                }
                if !usable { sourcesNote }
            }
        }
    }

    private var sourcesNote: some View {
        Button(action: refresh) {
            Label("Calendar or Reminders needs a refresh", systemImage: "arrow.triangle.2.circlepath")
        }
        .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(OrionTheme.orange)
    }

    /// The starting assumptions, folded away: set once, rarely touched.
    private var budgets: some View {
        DisclosureGroup(isExpanded: $showsBudgets) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 20) {
                    minutePicker("Day starts", selection: $model.preferences.wakeMinute, range: Array(stride(from: 0, through: 720, by: 30)))
                    minutePicker("Day ends", selection: $model.preferences.sleepMinute, range: Array(stride(from: 1080, through: 1440, by: 30)))
                }
                Stepper("Free time kept: \(model.preferences.freeMinutes) min", value: $model.preferences.freeMinutes, in: 0...240, step: 15)
                Stepper("Buffer around events: \(model.preferences.transitionMinutes) min", value: $model.preferences.transitionMinutes, in: 0...60, step: 5)
                Stepper("Default task length: \(model.preferences.defaultTaskMinutes) min", value: $model.preferences.defaultTaskMinutes, in: 5...240, step: 5)
                Stepper("Minimum sleep: \(model.preferences.minimumSleepMinutes / 60) h", value: $model.preferences.minimumSleepMinutes, in: 360...720, step: 60)
                if let inputs = model.inputs, !inputs.tasks.filter({ !$0.completedInSource }).isEmpty {
                    Text("TASK LENGTHS").font(OrionTheme.mono(8, .semibold)).tracking(1.6).foregroundStyle(OrionTheme.textDim).padding(.top, 4)
                    ForEach(inputs.tasks.filter { !$0.completedInSource }) { task in
                        Stepper("\(task.title): \(model.estimate(for: task.id)) min",
                                value: Binding(get: { model.estimate(for: task.id) }, set: { model.setEstimate(task.id, minutes: $0) }),
                                in: 5...240, step: 5)
                    }
                }
            }
            .font(.system(size: 12)).padding(.top, 10)
        } label: {
            Text("Time budgets").font(.system(size: 11, weight: .medium)).foregroundStyle(OrionTheme.textDim)
        }
    }

    private func minutePicker(_ title: String, selection: Binding<Int>, range: [Int]) -> some View {
        Picker(title, selection: selection) {
            ForEach(range, id: \.self) { minute in
                Text(String(format: "%02d:%02d", minute / 60, minute % 60)).tag(minute)
            }
        }.frame(maxWidth: 190)
    }
}

/// Quiet buttons that match the rest of the dashboard; the prominent one is filled.
struct PlanButtonStyle: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(prominent ? OrionTheme.ink : OrionTheme.accent)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background {
                Capsule().fill(prominent ? OrionTheme.accent : OrionTheme.accent.opacity(0.10))
            }
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .contentShape(Capsule())
    }
}
