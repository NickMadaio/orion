import SwiftUI

/// Where a plan step stands in the run. `blocked` is a task parked on a note from Nick.
enum ProjectPlanStepState: Equatable { case done, doing, next, todo, blocked }

/// One step of the plan as the flow draws it: a heading and everything written under it, up to the next heading.
struct ProjectPlanStep: Identifiable, Equatable {
    let id: Int
    let title: String
    let level: Int
    let details: [Int]   // ProjectPlanBlock ids

    /// Groups the display blocks: h2/h3 open a step, h1 and anything before the first step stay outside the flow.
    static func steps(from blocks: [ProjectPlanBlock]) -> [ProjectPlanStep] {
        var result: [ProjectPlanStep] = []
        for block in blocks {
            if block.kind == "h2" || block.kind == "h3" {
                result.append(ProjectPlanStep(id: block.id, title: block.text, level: block.kind == "h2" ? 2 : 3, details: []))
            } else if !block.kind.hasPrefix("h"), let last = result.last {
                result[result.count - 1] = ProjectPlanStep(id: last.id, title: last.title, level: last.level, details: last.details + [block.id])
            }
        }
        return result
    }

    /// Matches steps to the run's tasks by title, then marks the first step still to do as `next`.
    static func states(for steps: [ProjectPlanStep], tasks: [ProjectAgentStatus.WorkItem]) -> [Int: ProjectPlanStepState] {
        func norm(_ s: String) -> String { s.lowercased().filter { $0.isLetter || $0.isNumber } }
        var result: [Int: ProjectPlanStepState] = [:]
        for step in steps {
            let title = norm(step.title)
            let task = tasks.first { let t = norm($0.title); return !t.isEmpty && !title.isEmpty && (title.contains(t) || t.contains(title)) }
            switch task?.status {
            case .accepted?: result[step.id] = .done
            case .running?, .awaiting_review?: result[step.id] = .doing
            case .blocked?: result[step.id] = .blocked
            default: result[step.id] = .todo
            }
        }
        if let first = steps.first(where: { result[$0.id] == .todo }) { result[first.id] = .next }
        return result
    }
}

/*
 The Plan pane: each step is a row on a thin vertical flow line, a circular status node on the left, the title in
 the serif face and its details in muted sans. The step in progress glows. Headings above the first step and any
 text before it sit above the flow. Content is exactly the plan's blocks; only the presentation is new.
*/
struct ProjectPlanFlowView: View {
    let blocks: [ProjectPlanBlock]
    var tasks: [ProjectAgentStatus.WorkItem] = []

    var body: some View {
        let steps = ProjectPlanStep.steps(from: blocks)
        let states = ProjectPlanStep.states(for: steps, tasks: tasks)
        let stepIDs = Set(steps.flatMap { [$0.id] + $0.details })
        let byID = Dictionary(uniqueKeysWithValues: blocks.map { ($0.id, $0) })
        VStack(alignment: .leading, spacing: 18) {
            ForEach(blocks.filter { !stepIDs.contains($0.id) }) { block in blockView(block) }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                    ProjectPlanStepRow(title: step.title, state: states[step.id] ?? .todo, last: index == steps.count - 1) {
                        ForEach(step.details, id: \.self) { id in
                            if let block = byID[id] { blockView(block) }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func blockView(_ block: ProjectPlanBlock) -> some View {
        if block.kind.hasPrefix("code:") {
            DisclosureGroup(block.kind == "code:orion-task" ? "Task scope & acceptance criteria" : block.kind == "code:orion-plan" ? "Run configuration" : "Code / command reference") {
                Text(block.text).font(OrionTheme.mono(11)).foregroundStyle(OrionTheme.textSoft).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 14).padding(.vertical, 6)
                    .overlay(alignment: .leading) { FadingVerticalHairline(peak: 0.3) }
            }
            .font(OrionTheme.mono(10.5)).foregroundStyle(OrionTheme.textDim)
        } else if block.kind.hasPrefix("h") {
            Text(block.text).font(OrionTheme.serif(block.kind == "h1" ? 28 : 20)).foregroundStyle(OrionTheme.text)
                .padding(.top, block.kind == "h1" ? 0 : 6)
        } else {
            Text((try? AttributedString(markdown: block.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(block.text))
                .font(.system(size: 13)).lineSpacing(5).foregroundStyle(OrionTheme.textSoft).textSelection(.enabled)
        }
    }
}

struct ProjectPlanStepRow<Details: View>: View {
    let title: String
    let state: ProjectPlanStepState
    let last: Bool
    @ViewBuilder var details: Details

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            ProjectPlanNode(state: state).padding(.top, 2).frame(width: 22)
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(OrionTheme.serif(state == .doing ? 19 : 17))
                    .foregroundStyle(state == .todo ? OrionTheme.textSoft : OrionTheme.text.opacity(state == .done ? 0.7 : 1))
                    .shadow(color: state == .doing ? hue.opacity(0.45) : .clear, radius: 8)
                details
            }
            .padding(.bottom, last ? 0 : 26)
            .frame(maxWidth: .infinity, alignment: .leading)
            // The flow line hangs off the text column so it is exactly as tall as the row, never taller.
            .background(alignment: .topLeading) {
                if !last {
                    Rectangle()
                        .fill(LinearGradient(colors: [hue.opacity(state == .done ? 0.45 : 0.22), Color.white.opacity(0.05)],
                                             startPoint: .top, endPoint: .bottom))
                        .frame(width: 1).padding(.top, 24).offset(x: -27)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var hue: Color { state == .blocked ? OrionTheme.orange : state == .done ? OrionTheme.green : OrionTheme.accent }
}

/// The circular status node: done is a ticked ring, doing a glowing ring with a core, next an open ring, todo a faint one.
struct ProjectPlanNode: View {
    let state: ProjectPlanStepState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathe = false

    var body: some View {
        ZStack {
            switch state {
            case .done:
                Circle().fill(OrionTheme.green.opacity(0.16))
                Circle().strokeBorder(OrionTheme.green.opacity(0.8), lineWidth: 1)
                Image(systemName: "checkmark").font(.system(size: 8, weight: .bold)).foregroundStyle(OrionTheme.green)
            case .doing, .blocked:
                let hue = state == .blocked ? OrionTheme.orange : OrionTheme.accent
                Circle().fill(hue.opacity(0.14))
                Circle().strokeBorder(hue, lineWidth: 1.2)
                Circle().fill(hue).frame(width: 6, height: 6)
            case .next:
                Circle().strokeBorder(OrionTheme.accent.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [2.5, 2.5]))
            case .todo:
                Circle().strokeBorder(Color.white.opacity(0.2), lineWidth: 0.9)
            }
        }
        .frame(width: 16, height: 16)
        .shadow(color: glow.opacity(state == .doing || state == .blocked ? (breathe ? 0.9 : 0.5) : 0), radius: breathe ? 9 : 5)
        .onAppear {
            guard !reduceMotion, state == .doing else { return }
            withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) { breathe = true }
        }
    }

    private var glow: Color { state == .blocked ? OrionTheme.orange : OrionTheme.accent }
}
