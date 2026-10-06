import SwiftUI
import MobileCore

/*
 The Plan tab: the day as a calendar app draws it, and the to-do list beside it.
 Events and to-dos are Apple Calendar and Reminders (PlannerStore); ORION's own
 planned blocks are drawn in its colours on the same grid.
*/

extension PlannerStore.Item {
    var tint: Color {
        switch source {
        case .calendar(let hex): return Color(hex: hex) ?? Phone.violet
        case .orion(let kind):
            switch kind {
            case .task: return Phone.accent
            case .free: return Phone.green
            case .commitment: return Phone.violet
            case .transition: return Phone.dim
            }
        }
    }
    var isOrion: Bool { if case .orion = source { return true }; return false }

    /// The sample day, drawn like any other, for when nothing is connected.
    static func sample(_ plan: TodayPlan) -> [PlannerStore.Item] {
        plan.blocks.filter { $0.kind != .transition }.map {
            PlannerStore.Item(id: "sample-\($0.id)", title: $0.title, start: $0.start, end: $0.end, allDay: false,
                              source: .orion($0.kind), detail: "Sample")
        }
    }
}

extension Color {
    init?(hex: String?) {
        guard let hex, hex.count == 6, let value = Int(hex, radix: 16) else { return nil }
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}

// MARK: - The day grid

struct DayScheduleView: View {
    let items: [PlannerStore.Item]
    let day: Date
    var timeZone: TimeZone = .current
    var onSelect: (PlannerStore.Item) -> Void = { _ in }
    /// When the alarm goes and when he should be asleep; wind-down ends on `bed`.
    var wake: Date? = nil
    var bed: Date? = nil
    /// `wake` is when he actually got up, not the alarm.
    var woke = false
    var fellAsleep: Date? = nil
    private let hourHeight: CGFloat = 64
    private let gutter: CGFloat = 52

    private var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = timeZone; return c }

    var body: some View {
        let timed = items.filter { !$0.allDay }
        let slots = timed.map { DaySlot(id: $0.id, start: $0.start, end: $0.end) }
        // The markers widen the visible hours so an early alarm or a late bedtime shows.
        let markerSlots = [wake, bed, fellAsleep].compactMap { $0 }.map { DaySlot(id: "marker-\($0.timeIntervalSince1970)", start: $0.addingTimeInterval(-15 * 60), end: $0) }
        let range = DayLayout.visibleHours(for: slots + markerSlots, on: day, calendar: calendar)
        let placements = Dictionary(uniqueKeysWithValues:
            DayLayout.place(slots, rangeStart: range.start, hours: range.hours).map { ($0.id, $0) })
        VStack(alignment: .leading, spacing: 10) {
            let allDay = items.filter(\.allDay)
            if !allDay.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(allDay) { item in
                        Button { onSelect(item) } label: {
                            Text(item.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Phone.text)
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(item.tint.opacity(0.22), in: RoundedRectangle(cornerRadius: 6))
                        }.buttonStyle(.plain)
                    }
                }.padding(.leading, gutter)
            }
            GeometryReader { geometry in
                    let width = geometry.size.width - gutter - 4
                    ZStack(alignment: .topLeading) {
                        hourLines(range)
                        ForEach(timed) { item in
                            if let place = placements[item.id] {
                                let columnWidth = width / CGFloat(place.columns)
                                block(item, height: CGFloat(place.height) / 60 * hourHeight)
                                    .frame(width: columnWidth - 3)
                                    .offset(x: gutter + CGFloat(place.column) * columnWidth, y: CGFloat(place.top) / 60 * hourHeight)
                            }
                        }
                        if let fellAsleep { marker(fellAsleep, "Fell asleep", "bed.double.fill", Phone.violet.opacity(0.7), range) }
                        if let wake { marker(wake, woke ? "Woke" : "Wake", "sunrise.fill", Phone.orange, range) }
                        if let bed { marker(bed, "Asleep by", "moon.zzz.fill", Phone.violet, range) }
                        nowLine(range)
                    }
                }
                .frame(height: CGFloat(range.hours) * hourHeight)
        }
    }

    /// The hour row to scroll to so "now" is in view, for the screen that owns the scroll view.
    static func anchor(for items: [PlannerStore.Item], day: Date, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        let slots = items.filter { !$0.allDay }.map { DaySlot(id: $0.id, start: $0.start, end: $0.end) }
        let range = DayLayout.visibleHours(for: slots, on: day, calendar: calendar)
        let hour = calendar.isDate(Date(), inSameDayAs: day) ? Int(Date().timeIntervalSince(range.start) / 3600) - 1 : 0
        return "hour-\(min(max(0, hour), range.hours - 1))"
    }

    private func hourLines(_ range: (start: Date, hours: Int)) -> some View {
        VStack(spacing: 0) {
            ForEach(0..<range.hours, id: \.self) { index in
                HStack(alignment: .top, spacing: 8) {
                    Text(label(range.start.addingTimeInterval(TimeInterval(index * 3600))))
                        .font(Phone.mono(10, .medium)).foregroundStyle(Phone.dim)
                        .frame(width: gutter - 8, alignment: .trailing).offset(y: -6)
                    Rectangle().fill(Phone.hairline).frame(height: 1)
                }
                .frame(height: hourHeight, alignment: .top)
                .id("hour-\(index)")
            }
        }
    }

    private func block(_ item: PlannerStore.Item, height: CGFloat) -> some View {
        Button { onSelect(item) } label: {
            HStack(spacing: 0) {
                Rectangle().fill(item.tint).frame(width: 3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.system(size: height < 22 ? 10.5 : 13, weight: .semibold)).foregroundStyle(Phone.text).lineLimit(height > 44 ? 2 : 1)
                    if height > 34 {
                        Text("\(label(item.start)) – \(label(item.end))\(item.isOrion ? " · ORION" : "")")
                            .font(Phone.mono(10, .medium)).foregroundStyle(Phone.soft)
                    }
                }
                .padding(.horizontal, 7).padding(.vertical, height < 22 ? 1 : 4)
                Spacer(minLength: 0)
            }
            // True size: a 20-pt floor drew a 15-minute break over the next block
            // (2026-10-01: "lunch goes into my break which goes into my lab").
            .frame(height: max(4, height - 2), alignment: .top)
            // ORION's blocks are outlined; calendar events are filled, as a calendar app draws them.
            .background(item.tint.opacity(item.isOrion ? 0.08 : 0.22))
            .overlay(item.isOrion ? RoundedRectangle(cornerRadius: 5).stroke(item.tint.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])) : nil)
            .clipShape(RoundedRectangle(cornerRadius: 5))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(item.title), \(label(item.start)) to \(label(item.end))")
    }

    /// A dashed boundary with a small label. Not an event: it takes no taps.
    @ViewBuilder private func marker(_ moment: Date, _ title: String, _ icon: String, _ tint: Color, _ range: (start: Date, hours: Int)) -> some View {
        let minutes = moment.timeIntervalSince(range.start) / 60
        if minutes >= 0, minutes <= Double(range.hours * 60) {
            HStack(spacing: 6) {
                Rectangle().fill(.clear).frame(height: 1)
                    .overlay(Rectangle().stroke(tint.opacity(0.75), style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                Label("\(title) \(label(moment))", systemImage: icon)
                    .font(Phone.mono(10, .semibold)).foregroundStyle(tint)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Phone.ink.opacity(0.9), in: Capsule())
                    .fixedSize()
            }
            .padding(.leading, gutter).padding(.trailing, 4)
            .offset(y: CGFloat(minutes) / 60 * hourHeight - 8)
            .allowsHitTesting(false)
            .accessibilityLabel("\(title) \(label(moment))")
        }
    }

    @ViewBuilder private func nowLine(_ range: (start: Date, hours: Int)) -> some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let minutes = context.date.timeIntervalSince(range.start) / 60
            if calendar.isDate(context.date, inSameDayAs: day), minutes >= 0, minutes <= Double(range.hours * 60) {
                HStack(spacing: 0) {
                    Circle().fill(Phone.red).frame(width: 8, height: 8)
                    Rectangle().fill(Phone.red).frame(height: 1.5)
                }
                .padding(.leading, gutter - 4)
                .offset(y: CGFloat(minutes) / 60 * hourHeight - 4)
                .accessibilityLabel("Now")
            }
        }
    }

    private func label(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB"); formatter.timeZone = timeZone; formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}

// MARK: - To-dos

struct TodoListView: View {
    @ObservedObject var planner: PlannerStore
    @State private var draft = ""
    @State private var editing: PlannerStore.Todo?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                Image(systemName: "plus.circle").foregroundStyle(Phone.accent)
                TextField("Add a to-do", text: $draft)
                    .submitLabel(.done)
                    .onSubmit { planner.addTodo(title: draft, due: nil); draft = "" }
                    .accessibilityIdentifier("addTodoField")
            }
            .padding(.vertical, 10)
            .overlay(alignment: .bottom) { Rectangle().fill(Phone.hairline).frame(height: 1) }

            let open = planner.todos.filter { !$0.done }, done = planner.todos.filter(\.done)
            if open.isEmpty && done.isEmpty {
                Text("Nothing on your \(PlannerStore.orionList) list. Add one above; it syncs to Reminders on every device.")
                    .font(.system(size: 14)).foregroundStyle(Phone.soft)
            }
            if !open.isEmpty {
                SectionLabel("To do · \(open.count)", tint: Phone.accent)
                ForEach(open) { todo in
                    row(todo)
                    // Its parts, dropped below it like to-dos of their own (2026-10-06).
                    ForEach(TaskNotes.parse(todo.notes).subtasks) { sub in subRow(sub, of: todo) }
                }
            }
            if !done.isEmpty {
                SectionLabel("Done today · \(done.count)", tint: Phone.green)
                ForEach(done) { row($0) }
            }
        }
        .sheet(item: $editing) { todo in TodoEditor(todo: todo, planner: planner) }
    }

    private func subRow(_ sub: TaskNotes.Subtask, of todo: PlannerStore.Todo) -> some View {
        PhoneSubtaskRow(sub: sub) { percent in
            var notes = TaskNotes.parse(todo.notes)
            guard let i = notes.subtasks.firstIndex(where: { $0.title == sub.title }) else { return }
            notes.subtasks[i].percent = percent
            var updated = todo; updated.notes = notes.text
            withAnimation(.spring(response: 0.3)) { planner.update(updated) }
        }
    }

    private func row(_ todo: PlannerStore.Todo) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Button { withAnimation(.spring(response: 0.3)) { planner.toggle(todo) } } label: {
                ZStack {
                    Circle().stroke(todo.done ? Phone.green : Phone.soft, lineWidth: 1.4).frame(width: 22, height: 22)
                    if todo.done { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Phone.green) }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(todo.done ? "Mark \(todo.title) not done" : "Complete \(todo.title)")
            Button { editing = todo } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(todo.title).font(.system(size: 16, weight: .medium))
                        .foregroundStyle(todo.done ? Phone.dim : Phone.text).strikethrough(todo.done, color: Phone.dim)
                    if let due = todo.due {
                        Text(due.formatted(date: Calendar.current.isDateInToday(due) ? .omitted : .abbreviated, time: .shortened))
                            .font(Phone.mono(11, .medium))
                            .foregroundStyle(!todo.done && due < Date() ? Phone.orange : Phone.dim)
                    }
                    let parsed = TaskNotes.parse(todo.notes)
                    if let progress = parsed.progress {
                        HStack(spacing: 8) {
                            ProgressView(value: Double(progress), total: 100).tint(Phone.accent).frame(maxWidth: 120)
                            Text("\(progress)% · \(parsed.subtasks.count) parts").font(Phone.mono(10, .medium)).foregroundStyle(Phone.dim)
                        }
                    }
                    if !parsed.spread.isEmpty {
                        Text(parsed.spread).font(.system(size: 12)).foregroundStyle(Phone.soft).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            if todo.priority > 0 && todo.priority <= 4 {
                Image(systemName: "exclamationmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Phone.orange)
                    .accessibilityLabel("High priority")
            }
        }
        .padding(.vertical, 4)
    }
}

struct TodoEditor: View {
    @State var todo: PlannerStore.Todo
    let planner: PlannerStore
    @Environment(\.dismiss) private var dismiss
    @State private var hasDue = false
    /// The notes, read as spread + subtasks + other lines (MobileCore.TaskNotes).
    @State private var notes = TaskNotes()
    @State private var newSubtask = ""

    private static let priorities: [(String, Int)] = [("None", 0), ("Low", 9), ("Medium", 5), ("High", 1)]
    private var priorityChoice: Binding<Int> {
        Binding(get: { todo.priority == 0 ? 0 : todo.priority <= 4 ? 1 : todo.priority == 5 ? 5 : 9 },
                set: { todo.priority = $0 })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $todo.title)
                    Picker("Priority", selection: priorityChoice) {
                        ForEach(Self.priorities, id: \.1) { Text($0.0).tag($0.1) }
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    Toggle("Due date", isOn: $hasDue.animation())
                    if hasDue {
                        DatePicker("Done by", selection: Binding(get: { todo.due ?? Date() }, set: { todo.due = $0 }))
                    }
                    TextField("How to spread it", text: $notes.spread, axis: .vertical).lineLimit(1...3)
                } header: { Text("Plan") } footer: {
                    Text("ORION books the work before the due date, e.g. \"2.5 hours a day\", \"two 2-hour blocks, Tuesday and Thursday\", \"four 1-hour blocks this week\".")
                }
                Section {
                    ForEach($notes.subtasks) { $sub in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(sub.title).strikethrough(sub.done, color: Phone.dim)
                                Spacer()
                                Text("\(sub.percent)%").font(Phone.mono(12, .semibold)).foregroundStyle(sub.done ? Phone.green : Phone.accent)
                            }
                            Slider(value: Binding(get: { Double(sub.percent) }, set: { sub.percent = Int($0.rounded()) }), in: 0...100, step: 5)
                        }
                    }
                    .onDelete { notes.subtasks.remove(atOffsets: $0) }
                    HStack {
                        TextField("Add a subtask", text: $newSubtask).onSubmit(addSubtask)
                        Button(action: addSubtask) { Image(systemName: "plus.circle.fill") }
                            .disabled(newSubtask.trimmingCharacters(in: .whitespaces).isEmpty)
                            .accessibilityLabel("Add subtask")
                    }
                } header: {
                    HStack {
                        Text("Subtasks")
                        Spacer()
                        if let progress = notes.progress { Text("\(progress)% overall").foregroundStyle(Phone.accent) }
                    }
                } footer: { Text("Only this to-do goes on your schedule; subtasks track how far along each part is.") }
                Section("Notes") {
                    TextField("Anything else", text: Binding(get: { notes.other.joined(separator: "\n") },
                                                           set: { notes.other = $0.components(separatedBy: "\n") }), axis: .vertical)
                        .lineLimit(1...5)
                }
                Toggle("Done", isOn: $todo.done)
                Section { Text("Saved to the \(todo.listName) list in Reminders.").font(.footnote).foregroundStyle(Phone.dim) }
                Section { Button("Delete to-do", role: .destructive) { planner.deleteTodo(todo); dismiss() } }
            }
            .navigationTitle("To-do")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if !hasDue { todo.due = nil }
                        notes.other = notes.other.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                        todo.notes = notes.text
                        planner.update(todo); dismiss()
                    }
                }
            }
            .onAppear { hasDue = todo.due != nil; notes = TaskNotes.parse(todo.notes) }
        }
        .preferredColorScheme(.dark)
        .tint(Phone.accent)
    }

    private func addSubtask() {
        let title = newSubtask.trimmingCharacters(in: .whitespaces)
        guard !title.isEmpty, !notes.subtasks.contains(where: { $0.title.caseInsensitiveCompare(title) == .orderedSame }) else { return }
        withAnimation { notes.subtasks.append(.init(title: title)) }
        newSubtask = ""
    }
}

struct EventEditor: View {
    let planner: PlannerStore
    var existing: PlannerStore.Item?
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(3600)
    @State private var allDay = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
                Toggle("All day", isOn: $allDay)
                DatePicker("Starts", selection: $start, displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                DatePicker("Ends", selection: $end, in: start..., displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                Section { Text("Saved to Apple Calendar, so it appears on every device.").font(.footnote).foregroundStyle(Phone.dim) }
                if let existing {
                    Section { Button("Delete event", role: .destructive) { planner.deleteEvent(id: existing.id); dismiss() } }
                }
            }
            .navigationTitle(existing == nil ? "New event" : "Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { planner.saveEvent(id: existing?.id, title: title, start: start, end: end, allDay: allDay); dismiss() }
                }
            }
            .onAppear {
                if let existing { title = existing.title; start = existing.start; end = existing.end; allDay = existing.allDay }
                else {
                    let next = Calendar.current.nextDate(after: Date(), matching: DateComponents(minute: 0), matchingPolicy: .nextTime) ?? Date()
                    let day = planner.day
                    let hour = Calendar.current.dateComponents([.hour], from: next).hour ?? 9
                    start = Calendar.current.date(byAdding: .hour, value: hour, to: day) ?? next
                    end = start.addingTimeInterval(3600)
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(Phone.accent)
    }
}

/// Read-only details for an ORION block: it belongs to the plan, not the calendar.
struct OrionBlockSheet: View {
    let item: PlannerStore.Item
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                SectionLabel("ORION plan", tint: item.tint)
                Text(item.title).font(Phone.display(24)).foregroundStyle(Phone.text)
                Text("\(item.start.formatted(date: .omitted, time: .shortened)) – \(item.end.formatted(date: .omitted, time: .shortened))")
                    .font(Phone.mono(13, .medium)).foregroundStyle(Phone.soft)
                Text("Part of the plan ORION made on your Mac. Change it by replanning there; it is not a calendar event.")
                    .font(.system(size: 14)).foregroundStyle(Phone.soft)
                Spacer()
            }
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PhoneBackdrop(tint: item.tint))
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium])
    }
}


/// A part of a to-do, drawn like a to-do (same circle, title and colours),
/// indented under its parent, with a drag-to-set progress track that saves
/// once when the drag ends (2026-10-06).
struct PhoneSubtaskRow: View {
    let sub: TaskNotes.Subtask
    let onSet: (Int) -> Void
    @State private var draft: Double?
    private var shown: Double { draft ?? Double(sub.percent) / 100 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                Button { onSet(sub.done ? 0 : 100) } label: {
                    ZStack {
                        Circle().stroke(sub.done ? Phone.green : Phone.soft, lineWidth: 1.4).frame(width: 22, height: 22)
                        if sub.done { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Phone.green) }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(sub.done ? "Mark \(sub.title) not done" : "Complete \(sub.title)")
                Text(sub.title).font(.system(size: 16, weight: .medium))
                    .foregroundStyle(sub.done ? Phone.dim : Phone.text).strikethrough(sub.done, color: Phone.dim)
                Spacer(minLength: 8)
                Text("\(Int((shown * 100).rounded()))%").font(Phone.mono(12, .semibold))
                    .foregroundStyle(shown > 0 && !sub.done ? Phone.accent : Phone.dim)
            }
            if !sub.done {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.08)).frame(height: 4)
                        Capsule().fill(Phone.accent).frame(width: max(4, geo.size.width * shown), height: 4)
                    }
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 0)
                        .onChanged { draft = min(1, max(0, $0.location.x / max(1, geo.size.width))) }
                        .onEnded { value in
                            let v = min(1, max(0, value.location.x / max(1, geo.size.width)))
                            onSet(Int((v * 100 / 5).rounded()) * 5); draft = nil
                        })
                }
                .frame(height: 18)
                .padding(.leading, 34)
                .accessibilityElement()
                .accessibilityLabel("\(sub.title) progress")
                .accessibilityValue("\(sub.percent) percent")
                .accessibilityAdjustableAction { direction in
                    onSet(min(100, max(0, sub.percent + (direction == .increment ? 10 : -10))))
                }
            }
        }
        .padding(.leading, 30)
        .padding(.vertical, 4)
        .onChange(of: sub.percent) { _, _ in draft = nil }
    }
}
