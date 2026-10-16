import SwiftUI
import MobileCore

/*
 The to-do list, shared by the Mac's Tasks tab and the phone's Plan tab
 (2026-10-13). Rebuilt after his old Notion list ("to-do list :D"): views along
 the top (to do / upcoming / by tag / done), coloured priority and tag pills on
 every row, and editing where things are instead of in a form. Adding takes
 everything at once — "essay #school !high fri 5pm" — so nothing has to be
 created first and edited after.

 It draws no scroll view of its own: both apps already scroll the page it sits in.
*/

public enum TodoListMode: String, CaseIterable, Identifiable, Sendable {
    case todo, upcoming, byTag, done
    public var id: String { rawValue }
    var title: String {
        switch self { case .todo: "to do"; case .upcoming: "upcoming"; case .byTag: "by tag"; case .done: "done" }
    }
    var icon: String {
        switch self { case .todo: "circle"; case .upcoming: "calendar"; case .byTag: "tag"; case .done: "checkmark" }
    }
}

public struct TodoListScreen: View {
    let items: [TodoItem]
    let actions: TodoActions
    let density: TodoDensity
    let motto: String?

    @AppStorage("todo.view") private var viewRaw = TodoListMode.todo.rawValue
    @State private var tagFilter: Set<String> = []
    @State private var expanded: String?

    public init(items: [TodoItem], actions: TodoActions, density: TodoDensity, motto: String? = "keep on going. lock in.") {
        self.items = items; self.actions = actions; self.density = density; self.motto = motto
    }

    private var view: TodoListMode { TodoListMode(rawValue: viewRaw) ?? .todo }
    private var knownTags: [String] { TaskNotes.cleanTags(items.flatMap(\.tags)) }
    private var colours: [String: Int] { TodoTagColor.assign(knownTags) }

    public var body: some View {
        VStack(alignment: .leading, spacing: density == .touch ? 14 : 12) {
            header
            tabs
            if !TodoBoard.allTags(items).isEmpty && view != .byTag { tagFilterBar }
            TodoComposer(knownTags: knownTags, density: density, add: actions.add)
            content
        }
        .foregroundStyle(ViewTokens.text)
        .environment(\.todoTagColours, colours)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: items)
        .animation(.easeOut(duration: 0.18), value: viewRaw)
        .onChange(of: items.map(\.id)) { _, ids in
            if let open = expanded, !ids.contains(open) { expanded = nil }
            tagFilter = tagFilter.intersection(knownTags)
        }
    }

    // MARK: - Top

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("to-do list")
                    .font(.system(size: density == .touch ? 22 : 19, weight: .bold, design: .monospaced))
                Spacer()
                let open = TodoBoard.open(items).count, done = TodoBoard.done(items).count
                Text("\(open) to do · \(done) done")
                    .font(.system(size: density.pill, weight: .medium, design: .monospaced))
                    .foregroundStyle(ViewTokens.dim)
            }
            if let motto {
                Text(motto)
                    .font(.system(size: density.pill + 0.5, design: .monospaced))
                    .foregroundStyle(TodoTone.palette[4].text.opacity(0.9))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        HStack(spacing: 0) {
                            Rectangle().fill(TodoTone.palette[4].text.opacity(0.8)).frame(width: 2)
                            // No fill behind the Mac's motto (2026-10-16 UI audit #7).
                            TodoTone.palette[4].fill.opacity(density == .pointer ? 0 : 0.35)
                        }
                    )
            }
        }
    }

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(TodoListMode.allCases) { option in
                    let selected = option == view
                    Button { viewRaw = option.rawValue; expanded = nil } label: {
                        HStack(spacing: 5) {
                            Image(systemName: option.icon).font(.system(size: density.pill - 0.5, weight: .semibold))
                            Text(option.title).font(.system(size: density.pill + 0.5, weight: selected ? .semibold : .regular, design: .monospaced))
                            if let count = count(option) {
                                Text("\(count)").font(.system(size: density.pill - 1, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(ViewTokens.dim)
                            }
                        }
                        .foregroundStyle(selected ? ViewTokens.text : ViewTokens.dim)
                        .padding(.horizontal, density == .touch ? 11 : 9).padding(.vertical, density == .touch ? 6 : 4.5)
                        .background(Capsule().fill(selected ? Color.white.opacity(0.1) : .clear))
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
        }
    }

    private func count(_ option: TodoListMode) -> Int? {
        switch option {
        case .todo: TodoBoard.open(items, tags: tagFilter).count
        case .done: TodoBoard.done(items, tags: tagFilter).count
        default: nil
        }
    }

    /// Tap tags to narrow the list to them; tap again to let go.
    private var tagFilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 5) {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: density.pill, weight: .semibold))
                    .foregroundStyle(tagFilter.isEmpty ? ViewTokens.dim : ViewTokens.accent)
                ForEach(TodoBoard.allTags(items), id: \.self) { tag in
                    let on = tagFilter.contains(tag)
                    Button { if on { tagFilter.remove(tag) } else { tagFilter.insert(tag) } } label: {
                        TodoPill(text: tag, icon: on ? "checkmark" : nil, tone: .tag(tag, in: colours), density: density)
                            .opacity(tagFilter.isEmpty || on ? 1 : 0.45)
                    }
                    .buttonStyle(.plain)
                }
                if !tagFilter.isEmpty {
                    Button("clear") { tagFilter = [] }
                        .buttonStyle(.plain)
                        .font(.system(size: density.pill, design: .monospaced))
                        .foregroundStyle(ViewTokens.dim)
                }
            }
        }
        .accessibilityIdentifier("todoTagFilter")
    }

    // MARK: - The list

    @ViewBuilder private var content: some View {
        switch view {
        case .todo:
            let open = TodoBoard.open(items, tags: tagFilter)
            if open.isEmpty { empty(tagFilter.isEmpty ? "Nothing to do. Add one above, or just tell ORION." : "Nothing tagged \(tagFilter.sorted().map { "#\($0)" }.joined(separator: " ")).") }
            list(open, reorderable: true)
        case .upcoming:
            let groups = TodoBoard.upcoming(items, tags: tagFilter)
            if groups.isEmpty { empty("Nothing coming up.") }
            ForEach(Array(groups.enumerated()), id: \.element.id) { index, group in
                section(group, tone: group.title == "Overdue" ? .overdue : TodoTone.palette[[4, 5, 3, 2, 6, 7, 1, 0][index % 8]])
            }
        case .byTag:
            let groups = TodoBoard.byTag(items)
            if groups.isEmpty { empty("Nothing to do.") }
            ForEach(groups) { group in section(group, tone: group.tag.map({ TodoTone.tag($0, in: colours) }) ?? TodoTone.palette[0]) }
        case .done:
            let done = TodoBoard.done(items, tags: tagFilter)
            if done.isEmpty { empty("Nothing ticked off yet.") }
            list(done, reorderable: false)
        }
    }

    private func section(_ group: TodoGroup, tone: TodoTone) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                TodoPill(text: group.title, tone: tone, density: density)
                Text("\(group.items.count)").font(.system(size: density.pill, weight: .medium, design: .monospaced)).foregroundStyle(ViewTokens.dim)
                Rectangle().fill(ViewTokens.hairline).frame(height: 1)
            }
            .padding(.top, 6)
            list(group.items, reorderable: false)
        }
    }

    private func list(_ shown: [TodoItem], reorderable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(shown) { item in
                let row = TodoRow(item: item, knownTags: knownTags, density: density, actions: actions, expanded: $expanded,
                                  filterBy: { tag in tagFilter = [tag]; if view == .byTag { viewRaw = TodoListMode.todo.rawValue } })
                if reorderable {
                    // Drag a to-do onto another to put it just above; the order is saved in the
                    // reminder's notes, so both devices show the same order (2026-10-11).
                    row.draggable(item.id) { TodoPill(text: item.title, tone: .due, density: density) }
                        .dropDestination(for: String.self) { ids, _ in
                            guard let id = ids.first else { return false }
                            let all = TodoBoard.open(items)
                            let changes = TaskNotes.reorder(all.map(\.id), orders: all.map { $0.parsed.order }, moving: id, before: item.id)
                            actions.reorder(changes)
                            return !changes.isEmpty
                        }
                } else {
                    row
                }
            }
        }
    }

    private func empty(_ text: String) -> some View {
        Text(text)
            .font(.system(size: density.title - 1, design: .monospaced))
            .foregroundStyle(ViewTokens.dim)
            .padding(.vertical, 10)
    }
}
