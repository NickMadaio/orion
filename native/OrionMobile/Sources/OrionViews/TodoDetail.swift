import SwiftUI
import MobileCore

/// A to-do opened in place (2026-10-13): details, how ORION should spread the work,
/// and its parts. Each field saves when you press return or leave it — no Save button,
/// no sheet.
struct TodoDetail: View {
    let item: TodoItem
    let density: TodoDensity
    let actions: TodoActions

    @State private var details = ""
    @State private var spread = ""
    @State private var newPart = ""
    @FocusState private var field: Field?

    private enum Field { case details, spread, part }

    private var notes: TaskNotes { item.parsed }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            labelled("details", icon: "text.alignleft") {
                TextField("Anything worth remembering", text: $details, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($field, equals: .details)
                    .onSubmit(save)
            }
            labelled("spread", icon: "calendar.day.timeline.left") {
                TextField("e.g. 2 hours a day until it's due", text: $spread)
                    .focused($field, equals: .spread)
                    .onSubmit(save)
            }
            VStack(alignment: .leading, spacing: 6) {
                header("parts", icon: "checklist", trailing: notes.progress.map { "\($0)% overall" })
                HStack(spacing: 8) {
                    Image(systemName: "plus").font(.system(size: density.pill)).foregroundStyle(ViewTokens.dim)
                    TextField("Add a part (a course, a chapter…)", text: $newPart)
                        .focused($field, equals: .part)
                        .onSubmit(addPart)
                }
            }
            HStack(spacing: 14) {
                if let schedule = actions.schedule, !item.done {
                    Button { schedule(item.id) } label: { Label("Schedule now", systemImage: "calendar.badge.plus") }
                        .foregroundStyle(ViewTokens.violet)
                }
                Spacer()
                Button(role: .destructive) { actions.delete(item.id) } label: { Label("Delete", systemImage: "trash") }
                    .foregroundStyle(ViewTokens.warning)
            }
            .buttonStyle(.plain)
            .font(.system(size: density.pill + 0.5, weight: .medium))
        }
        .textFieldStyle(.plain)
        .font(.system(size: density.title - 1))
        .foregroundStyle(ViewTokens.text)
        .onAppear { details = notes.other.joined(separator: "\n"); spread = notes.spread }
        .onChange(of: field) { old, _ in if old == .details || old == .spread { save() } }
        .onDisappear(perform: save)
    }

    private func labelled<Content: View>(_ title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            header(title, icon: icon, trailing: nil)
            content()
                .padding(.horizontal, 9).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.white.opacity(0.04)))
        }
    }

    private func header(_ title: String, icon: String, trailing: String?) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: density.pill - 1))
            Text(title.uppercased()).font(.system(size: density.pill - 1.5, weight: .semibold, design: .monospaced)).tracking(1.1)
            Spacer()
            if let trailing { Text(trailing).font(.system(size: density.pill - 1, weight: .semibold, design: .monospaced)).foregroundStyle(ViewTokens.accent) }
        }
        .foregroundStyle(ViewTokens.dim)
    }

    /// Writes details and spread if either changed; parts save as they change.
    private func save() {
        var n = notes
        let other = details.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let newSpread = spread.trimmingCharacters(in: .whitespaces)
        guard other != n.other || newSpread != n.spread else { return }
        n.other = other
        n.spread = newSpread
        actions.setNotes(item.id, n.text)
    }

    private func addPart() {
        let title = newPart.trimmingCharacters(in: .whitespaces)
        guard !title.isEmpty, !notes.subtasks.contains(where: { $0.title.caseInsensitiveCompare(title) == .orderedSame }) else { return }
        editParts { $0.append(.init(title: title)) }
        newPart = ""
        field = .part
    }

    private func editParts(_ change: (inout [TaskNotes.Subtask]) -> Void) {
        var n = notes
        change(&n.subtasks)
        actions.setNotes(item.id, n.text)
    }
}

/// One part: tick it, drag its bar to set how far along it is.
struct TodoPartRow: View {
    let sub: TaskNotes.Subtask
    let density: TodoDensity
    let set: (Int) -> Void
    var remove: (() -> Void)? = nil
    @State private var draft: Double?

    private var shown: Double { draft ?? Double(sub.percent) / 100 }

    var body: some View {
        Group {
            // A phone is too narrow for name and bar side by side: the bar goes under the name.
            if density == .touch {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 9) { check; name; Spacer(minLength: 4); percent; removeButton }
                    bar.padding(.leading, density.check + 6)
                }
            } else {
                HStack(spacing: 9) { check; name; bar; percent; removeButton }
            }
        }
        .onChange(of: sub.percent) { _, _ in draft = nil }
    }

    private var check: some View {
        TodoCheck(done: sub.done, tint: ViewTokens.soft, size: density.check - 3) { set(sub.done ? 0 : 100) }
    }

    private var name: some View {
        Text(sub.title)
            .font(.system(size: density.title - 1))
            .foregroundStyle(sub.done ? ViewTokens.dim : ViewTokens.text)
            .strikethrough(sub.done, color: ViewTokens.dim)
            .lineLimit(density == .touch ? 2 : 1)
            .frame(minWidth: 60, alignment: .leading)
    }

    private var bar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.08)).frame(height: 4)
                Capsule().fill(sub.done ? TodoTone.palette[4].text : ViewTokens.accent)
                    .frame(width: max(4, geo.size.width * shown), height: 4)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { draft = min(1, max(0, $0.location.x / max(1, geo.size.width))) }
                .onEnded { value in
                    let v = min(1, max(0, value.location.x / max(1, geo.size.width)))
                    set(Int((v * 100 / 5).rounded()) * 5); draft = nil
                })
        }
        .frame(height: 18)
        .accessibilityElement()
        .accessibilityLabel("\(sub.title) progress")
        .accessibilityValue("\(sub.percent) percent")
        .accessibilityAdjustableAction { direction in set(min(100, max(0, sub.percent + (direction == .increment ? 10 : -10)))) }
    }

    private var percent: some View {
        Text("\(Int((shown * 100).rounded()))%")
            .font(.system(size: density.pill, weight: .semibold, design: .monospaced))
            .foregroundStyle(shown > 0 && !sub.done ? ViewTokens.accent : ViewTokens.dim)
            .frame(width: 38, alignment: .trailing)
    }

    @ViewBuilder private var removeButton: some View {
        if let remove {
            Button(action: remove) { Image(systemName: "xmark").font(.system(size: density.pill - 1, weight: .bold)) }
                .buttonStyle(.plain)
                .foregroundStyle(ViewTokens.dim)
                .accessibilityLabel("Remove \(sub.title)")
        }
    }
}
