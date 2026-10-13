import SwiftUI
import MobileCore

/// Add a to-do with everything at once (2026-10-13): type "essay #school !high fri 5pm",
/// or set priority, date and tags from the pills under the field before pressing return.
/// What the line says wins over the pills; the pills fill whatever it leaves out.
struct TodoComposer: View {
    @Environment(\.todoTagColours) private var colours
    let knownTags: [String]
    let density: TodoDensity
    let add: (TodoDraft) -> Void

    @State private var text = ""
    @State private var priority: TodoPriority = .none
    @State private var due: Date?
    @State private var tags: [String] = []
    @State private var picking = false
    @State private var naming = false
    @State private var newTag = ""
    @FocusState private var focused: Bool

    /// The line read as a to-do, merged with the pills.
    private var draft: TodoDraft {
        var d = TodoQuickAdd.parse(text)
        if d.priority == .none { d.priority = priority }
        if d.due == nil, let due { d.due = due; d.dueHasTime = TodoBoard.hasTime(due) }
        d.tags = TaskNotes.cleanTags(tags + d.tags)
        return d
    }

    private var canAdd: Bool { !draft.title.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 10) {
                Image(systemName: "plus")
                    .font(.system(size: density.pill + 1, weight: .semibold))
                    .foregroundStyle(focused ? ViewTokens.accent : ViewTokens.dim)
                TextField(density == .touch ? "Add a to-do" : "Add a to-do — try  essay #school !high fri 5pm", text: $text)
                    .textFieldStyle(.plain)
                    .font(.system(size: density.title))
                    .foregroundStyle(ViewTokens.text)
                    .focused($focused)
                    .onSubmit(submit)
                    .submitLabel(.done)
                    .accessibilityIdentifier("addTodoField")
                if canAdd {
                    Button(action: submit) {
                        Image(systemName: "return")
                            .font(.system(size: density.pill, weight: .bold))
                            .foregroundStyle(Color.black.opacity(0.8))
                            .frame(width: density == .touch ? 28 : 22, height: density == .touch ? 28 : 22)
                            .background(Circle().fill(ViewTokens.accent))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Add to-do")
                    .transition(.scale.combined(with: .opacity))
                }
            }
            if density == .touch && focused && text.isEmpty {
                Text("try  essay #school !high fri 5pm")
                    .font(.system(size: density.pill, design: .monospaced))
                    .foregroundStyle(ViewTokens.dim)
            }
            if focused || canAdd || priority != .none || due != nil || !tags.isEmpty {
                pills.transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, density == .touch ? 14 : 12)
        .padding(.vertical, density == .touch ? 12 : 10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(focused ? 0.06 : 0.035))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(focused ? ViewTokens.accent.opacity(0.45) : ViewTokens.hairline, lineWidth: 0.8))
        )
        .animation(.easeOut(duration: 0.16), value: focused)
        .animation(.easeOut(duration: 0.16), value: canAdd)
        .popover(isPresented: $picking) {
            DuePicker(initial: due) { due = $0; picking = false }
                .presentationCompactAdaptation(.popover)
        }
        .alert("New tag", isPresented: $naming) {
            TextField("school", text: $newTag)
            Button("Add") { tags = TaskNotes.cleanTags(tags + [newTag]); newTag = "" }
            Button("Cancel", role: .cancel) { newTag = "" }
        }
    }

    /// What the to-do will be added with; each pill is also the control that sets it.
    private var pills: some View {
        let d = draft
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                PillMenu(pill: TodoPill(text: d.priority == .none ? "priority" : d.priority.label, icon: "flag",
                                        tone: d.priority == .none ? .ghost : .priority(d.priority), density: density,
                                        placeholder: d.priority == .none)) {
                    PriorityChoices(current: d.priority) { priority = $0 }
                }
                PillMenu(pill: TodoPill(text: d.due.map { TodoBoard.dueLabel($0) } ?? "date", icon: "calendar",
                                        tone: d.due == nil ? .ghost : .due, density: density, placeholder: d.due == nil)) {
                    DueChoices(hasDue: due != nil, choose: { due = $0 }, pick: { picking = true })
                }
                ForEach(d.tags, id: \.self) { tag in
                    Button { tags.removeAll { $0 == tag } } label: {
                        TodoPill(text: "#\(tag)", tone: .tag(tag, in: colours), density: density)
                    }
                    .buttonStyle(.plain)
                    .help("Remove #\(tag)")
                }
                PillMenu(pill: TodoPill(text: "tag", icon: "number", tone: .ghost, density: density, placeholder: true)) {
                    TagChoices(all: knownTags, selected: d.tags,
                               toggle: { tag in tags = tags.contains(tag) ? tags.filter { $0 != tag } : tags + [tag] },
                               new: { naming = true })
                }
            }
        }
    }

    private func submit() {
        let d = draft
        guard canAdd else { return }
        add(d)
        withAnimation(.easeOut(duration: 0.16)) {
            text = ""; priority = .none; due = nil; tags = []
        }
        focused = true
    }
}
