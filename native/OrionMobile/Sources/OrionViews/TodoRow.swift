import SwiftUI
import MobileCore

/// What a row can change. Tags, details, spread and subtasks all go through
/// `setNotes` (TaskNotes text), as before, so ORION's planner reads them.
public struct TodoActions {
    public var add: (TodoDraft) -> Void
    public var toggle: (String) -> Void
    public var rename: (String, String) -> Void
    public var setPriority: (String, TodoPriority) -> Void
    public var setDue: (String, Date?) -> Void
    public var setNotes: (String, String) -> Void
    public var delete: (String) -> Void
    public var reorder: ([String: Double]) -> Void
    /// Mac only: put it on the calendar now.
    public var schedule: ((String) -> Void)?

    public init(add: @escaping (TodoDraft) -> Void, toggle: @escaping (String) -> Void, rename: @escaping (String, String) -> Void,
                setPriority: @escaping (String, TodoPriority) -> Void, setDue: @escaping (String, Date?) -> Void,
                setNotes: @escaping (String, String) -> Void, delete: @escaping (String) -> Void,
                reorder: @escaping ([String: Double]) -> Void, schedule: ((String) -> Void)? = nil) {
        self.add = add; self.toggle = toggle; self.rename = rename; self.setPriority = setPriority; self.setDue = setDue
        self.setNotes = setNotes; self.delete = delete; self.reorder = reorder; self.schedule = schedule
    }
}

/// One to-do. Everything on it is edited where it is: the title by clicking it,
/// priority, date and tags from their pills, and the rest by opening the row.
struct TodoRow: View {
    @Environment(\.todoTagColours) private var colours
    let item: TodoItem
    let knownTags: [String]
    let density: TodoDensity
    let actions: TodoActions
    @Binding var expanded: String?
    var filterBy: (String) -> Void = { _ in }

    @State private var hovering = false
    @State private var editingTitle = false
    @State private var title = ""
    @State private var picking = false
    @State private var naming = false
    @State private var newTag = ""
    @FocusState private var titleFocused: Bool

    private var isOpen: Bool { expanded == item.id }
    private var notes: TaskNotes { item.parsed }
    /// Empty slots show while pointing at it (Mac) or once it is opened (phone).
    private var showSlots: Bool { isOpen || (hovering && density == .pointer) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                TodoCheck(done: item.done, tint: item.priority == .none ? ViewTokens.soft : TodoTone.priority(item.priority).text, size: density.check) {
                    actions.toggle(item.id)
                }
                .padding(.top, density == .touch ? 0 : 1)
                VStack(alignment: .leading, spacing: density == .touch ? 6 : 5) {
                    titleLine
                    if hasMeta { meta }
                }
                Spacer(minLength: 4)
                Button { withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { expanded = isOpen ? nil : item.id } } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: density.pill, weight: .semibold))
                        .rotationEffect(.degrees(isOpen ? 180 : 0))
                        .foregroundStyle(isOpen || hovering ? ViewTokens.soft : ViewTokens.dim.opacity(density == .touch ? 1 : 0))
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isOpen ? "Close \(item.title)" : "Open \(item.title)")
            }
            // Its parts, under it like to-dos of their own (2026-10-06); removable while it is open.
            if !item.done && !notes.subtasks.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(notes.subtasks) { sub in
                        TodoPartRow(sub: sub, density: density,
                                    set: { percent in editParts { parts in
                                        if let i = parts.firstIndex(where: { $0.title == sub.title }) { parts[i].percent = percent } } },
                                    remove: isOpen ? { editParts { $0.removeAll { $0.title == sub.title } } } : nil)
                    }
                }
                .padding(.leading, density.check + 10)
                .padding(.trailing, 26)
                .padding(.top, 8)
            }
            if isOpen {
                TodoDetail(item: item, density: density, actions: actions)
                    .padding(.leading, density.check + 10)
                    .padding(.top, 10)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.vertical, density.rowPadding)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.white.opacity(isOpen ? 0.045 : hovering ? 0.03 : 0))
        )
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
        .contextMenu { contextItems }
        .popover(isPresented: $picking) {
            DuePicker(initial: item.due) { actions.setDue(item.id, $0); picking = false }
                .presentationCompactAdaptation(.popover)
        }
        .alert("New tag", isPresented: $naming) {
            TextField("school", text: $newTag)
            Button("Add") { setTags(notes.tags + [newTag]); newTag = "" }
            Button("Cancel", role: .cancel) { newTag = "" }
        }
    }

    @ViewBuilder private var titleLine: some View {
        if editingTitle {
            TextField("Title", text: $title)
                .textFieldStyle(.plain)
                .font(.system(size: density.title, weight: .medium))
                .foregroundStyle(ViewTokens.text)
                .focused($titleFocused)
                .onSubmit(commitTitle)
                .onChange(of: titleFocused) { _, focused in if !focused { commitTitle() } }
                .onAppear { titleFocused = true }
        } else {
            Text(item.title)
                .font(.system(size: density.title, weight: .medium))
                .foregroundStyle(item.done ? ViewTokens.dim : ViewTokens.text)
                .strikethrough(item.done, color: ViewTokens.dim)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture {
                    guard !item.done else { return }
                    title = item.title; editingTitle = true
                }
                .help("Click to rename")
        }
    }

    private var hasMeta: Bool {
        showSlots || item.priority != .none || item.due != nil || !notes.tags.isEmpty || (item.done && notes.progress != nil)
            || !notes.spread.isEmpty || !notes.other.isEmpty
    }

    /// Priority, date, tags, parts and details, as pills; each pill is its own control.
    private var meta: some View {
        TodoFlow(spacing: 5) {
            if item.priority != .none || showSlots {
                PillMenu(pill: TodoPill(text: item.priority == .none ? "priority" : item.priority.label, icon: item.priority == .none ? "flag" : nil,
                                        tone: item.priority == .none ? .ghost : .priority(item.priority), density: density,
                                        placeholder: item.priority == .none)) {
                    PriorityChoices(current: item.priority) { actions.setPriority(item.id, $0) }
                }
            }
            if let due = item.due {
                PillMenu(pill: TodoPill(text: TodoBoard.dueLabel(due), icon: TodoBoard.hasTime(due) ? "clock" : "calendar",
                                        tone: !item.done && due < Date() ? .overdue : .due, density: density)) {
                    DueChoices(hasDue: true, choose: { actions.setDue(item.id, $0) }, pick: { picking = true })
                }
            } else if showSlots {
                PillMenu(pill: TodoPill(text: "date", icon: "calendar", tone: .ghost, density: density, placeholder: true)) {
                    DueChoices(hasDue: false, choose: { actions.setDue(item.id, $0) }, pick: { picking = true })
                }
            }
            ForEach(notes.tags, id: \.self) { tag in
                PillMenu(pill: TodoPill(text: tag, tone: .tag(tag, in: colours), density: density)) {
                    Button { filterBy(tag) } label: { Label("Show only #\(tag)", systemImage: "line.3.horizontal.decrease") }
                    Button(role: .destructive) { setTags(notes.tags.filter { $0 != tag }) } label: { Label("Remove #\(tag)", systemImage: "xmark") }
                }
            }
            if showSlots {
                PillMenu(pill: TodoPill(text: "tag", icon: "number", tone: .ghost, density: density, placeholder: true)) {
                    TagChoices(all: knownTags, selected: notes.tags,
                               toggle: { tag in setTags(notes.tags.contains(tag) ? notes.tags.filter { $0 != tag } : notes.tags + [tag]) },
                               new: { naming = true })
                }
            }
            if let progress = notes.progress, item.done {
                TodoPill(text: "\(notes.subtasks.filter(\.done).count)/\(notes.subtasks.count) · \(progress)%", icon: "checklist",
                         tone: TodoTone(fill: ViewTokens.accent.opacity(0.12), text: ViewTokens.accent), density: density)
            }
            if !notes.spread.isEmpty {
                TodoPill(text: notes.spread, icon: "calendar.day.timeline.left", tone: TodoTone(fill: ViewTokens.violet.opacity(0.13), text: ViewTokens.violet), density: density)
            }
            if !notes.other.isEmpty && !isOpen {
                Image(systemName: "text.alignleft").font(.system(size: density.pill)).foregroundStyle(ViewTokens.dim)
                    .padding(.top, 3)
                    .help(notes.other.joined(separator: "\n"))
            }
        }
    }

    @ViewBuilder private var contextItems: some View {
        Button { actions.toggle(item.id) } label: { Label(item.done ? "Not done" : "Done", systemImage: item.done ? "circle" : "checkmark.circle") }
        Button { title = item.title; editingTitle = true } label: { Label("Rename", systemImage: "pencil") }
        if let schedule = actions.schedule, !item.done {
            Button { schedule(item.id) } label: { Label("Schedule now", systemImage: "calendar.badge.plus") }
        }
        Divider()
        Button(role: .destructive) { actions.delete(item.id) } label: { Label("Delete", systemImage: "trash") }
    }

    private func commitTitle() {
        guard editingTitle else { return }
        editingTitle = false
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, trimmed != item.title { actions.rename(item.id, trimmed) }
    }

    private func editParts(_ change: (inout [TaskNotes.Subtask]) -> Void) {
        var n = notes
        change(&n.subtasks)
        actions.setNotes(item.id, n.text)
    }

    private func setTags(_ tags: [String]) {
        var n = notes
        n.tags = TaskNotes.cleanTags(tags)
        actions.setNotes(item.id, n.text)
    }
}

/// A rounded-square checkbox, as Notion draws it, tinted by priority.
struct TodoCheck: View {
    let done: Bool
    let tint: Color
    let size: CGFloat
    let toggle: () -> Void

    var body: some View {
        Button { withAnimation(.spring(response: 0.28, dampingFraction: 0.7)) { toggle() } } label: {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .strokeBorder(done ? Color.clear : tint.opacity(0.75), lineWidth: 1.3)
                    .background(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(done ? TodoTone.palette[4].text.opacity(0.9) : .clear))
                if done {
                    Image(systemName: "checkmark")
                        .font(.system(size: size * 0.58, weight: .heavy))
                        .foregroundStyle(Color.black.opacity(0.75))
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .frame(width: size, height: size)
            .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(done ? "Mark not done" : "Complete")
    }
}

/// Pills that wrap onto a second line instead of squeezing the title.
struct TodoFlow: Layout {
    var spacing: CGFloat = 5

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: .unspecified)
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if needed > width, !current.indices.isEmpty {
                rows.append(current)
                current = Row()
            }
            current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(index)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
