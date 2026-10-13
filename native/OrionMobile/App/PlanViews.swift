import SwiftUI
import MobileCore
import OrionViews

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

/// The to-do list: the shared OrionViews screen the Mac also draws (2026-10-13),
/// rebuilt after his old Notion list. Everything is set while adding and edited in place.
struct TodoListView: View {
    @ObservedObject var planner: PlannerStore

    private var items: [TodoItem] {
        planner.todos.map { TodoItem(id: $0.id, title: $0.title, due: $0.due, done: $0.done,
                                     priority: TodoPriority(eventKit: $0.priority), notes: $0.notes) }
    }

    var body: some View {
        TodoListScreen(items: items, actions: actions, density: .touch)
            .tint(Phone.accent)
    }

    private func edit(_ id: String, _ change: (inout PlannerStore.Todo) -> Void) {
        guard var todo = planner.todos.first(where: { $0.id == id }) else { return }
        change(&todo)
        planner.update(todo)
    }

    private var actions: TodoActions {
        TodoActions(
            add: { planner.addTodo($0) },
            toggle: { id in if let todo = planner.todos.first(where: { $0.id == id }) { planner.toggle(todo) } },
            rename: { id, title in edit(id) { $0.title = title } },
            setPriority: { id, level in edit(id) { $0.priority = level.eventKit } },
            setDue: { id, due in edit(id) { $0.due = due } },
            setNotes: { id, notes in edit(id) { $0.notes = notes } },
            delete: { id in if let todo = planner.todos.first(where: { $0.id == id }) { planner.deleteTodo(todo) } },
            reorder: { changes in applyOrder(changes) }
        )
    }

    /// New manual positions ("Order:" in each moved to-do's notes).
    private func applyOrder(_ changes: [String: Double]) {
        for (id, order) in changes {
            edit(id) { todo in var n = TaskNotes.parse(todo.notes); n.order = order; todo.notes = n.text }
        }
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
