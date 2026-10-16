import SwiftUI
import MobileCore

/*
 The to-do list's colours and pills (2026-10-13), after his old Notion list:
 muted, filled tags in Notion's nine colours, and priority as a coloured word
 (high red, medium yellow, low green) rather than a glyph.
*/

/// A pill's fill and text colour.
public struct TodoTone: Equatable {
    public let fill: Color
    public let text: Color

    private static func hex(_ value: UInt32) -> Color {
        Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
    private init(_ fill: UInt32, _ text: UInt32) { self.fill = Self.hex(fill); self.text = Self.hex(text) }
    init(fill: Color, text: Color) { self.fill = fill; self.text = text }

    /// Notion's dark-mode tag colours: gray, brown, orange, yellow, green, blue, purple, pink, red.
    static let palette: [TodoTone] = [
        TodoTone(0x454545, 0xE3E3E3), TodoTone(0x5C3B2E, 0xF0D2C3), TodoTone(0x7A4518, 0xFAD0A5),
        TodoTone(0x7D5F24, 0xF7E2A8), TodoTone(0x2A5A3F, 0xB7E6C6), TodoTone(0x26466F, 0xB8D4F7),
        TodoTone(0x4A3166, 0xDCC8F5), TodoTone(0x683050, 0xF5C1DA), TodoTone(0x6F3530, 0xF7BDB4),
    ]

    public static func tag(_ tag: String, in colours: [String: Int] = [:]) -> TodoTone {
        palette[colours[tag.lowercased()] ?? TodoTagColor.index(for: tag)]
    }

    public static func priority(_ level: TodoPriority) -> TodoTone {
        switch level {
        case .high: palette[8]
        case .medium: palette[3]
        case .low: palette[4]
        case .none: TodoTone(fill: Color.white.opacity(0.06), text: ViewTokens.dim)
        }
    }

    static let overdue = palette[8]
    static let due = TodoTone(fill: Color.white.opacity(0.07), text: ViewTokens.soft)
    static let ghost = TodoTone(fill: .clear, text: ViewTokens.dim)
}

/// Sizes for a pointer (Mac) or a finger (phone).
public enum TodoDensity: Sendable {
    case pointer, touch
    var title: CGFloat { self == .touch ? 16 : 13.5 }
    var pill: CGFloat { self == .touch ? 12 : 10.5 }
    var check: CGFloat { self == .touch ? 22 : 16 }
    var rowPadding: CGFloat { self == .touch ? 10 : 7 }
}

/// A small rounded label: a tag, a priority, a due date.
struct TodoPill: View {
    let text: String
    var icon: String? = nil
    let tone: TodoTone
    var density: TodoDensity = .pointer
    /// An empty slot ("+ date") is drawn as a dashed outline.
    var placeholder = false

    var body: some View {
        HStack(spacing: 4) {
            // 2026-10-16 UI audit #7: on the Mac (pointer density) a tag is plain
            // mono text with a dot in its colour, not a filled pill. The phone
            // (touch) keeps its pill.
            if density == .pointer && !placeholder && icon == nil {
                Circle().fill(tone.text).frame(width: 4, height: 4)
            }
            if let icon { Image(systemName: icon).font(.system(size: density.pill - 1.5, weight: .semibold)) }
            Text(text).font(.system(size: density.pill, weight: .medium, design: .monospaced)).lineLimit(1)
        }
        .foregroundStyle(tone.text)
        .padding(.horizontal, density == .touch ? 8 : 6.5)
        .padding(.vertical, density == .touch ? 3.5 : 2.5)
        .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(density == .pointer ? Color.clear : tone.fill))
        .overlay {
            if placeholder {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .strokeBorder(ViewTokens.dim.opacity(0.6), style: StrokeStyle(lineWidth: 0.8, dash: [3, 2]))
            }
        }
        .fixedSize()
    }
}

/// The menu behind a pill, drawn as the pill itself on both platforms.
struct PillMenu<Content: View>: View {
    let pill: TodoPill
    @ViewBuilder let content: () -> Content

    var body: some View {
        Menu(content: content) { pill }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
    }
}

/// Priority choices, each in its own colour.
struct PriorityChoices: View {
    let current: TodoPriority
    let choose: (TodoPriority) -> Void

    var body: some View {
        ForEach([TodoPriority.high, .medium, .low, .none]) { level in
            Button { choose(level) } label: {
                Label(level == .none ? "No priority" : level.label.capitalized,
                      systemImage: current == level ? "checkmark" : level == .none ? "circle.dashed" : "flag.fill")
            }
        }
    }
}

/// Quick due-date choices, plus "Pick a date…" which the caller presents.
struct DueChoices: View {
    let hasDue: Bool
    let choose: (Date?) -> Void
    let pick: () -> Void

    var body: some View {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let endOf = { (day: Date) in cal.date(bySettingHour: 23, minute: 59, second: 0, of: day) ?? day }
        let saturday = cal.nextDate(after: today.addingTimeInterval(-1), matching: DateComponents(weekday: 7), matchingPolicy: .nextTime) ?? today
        let nextMonday = cal.nextDate(after: today, matching: DateComponents(weekday: 2), matchingPolicy: .nextTime) ?? today
        Button { choose(endOf(today)) } label: { Label("Today", systemImage: "sun.max") }
        Button { choose(endOf(cal.date(byAdding: .day, value: 1, to: today) ?? today)) } label: { Label("Tomorrow", systemImage: "sunrise") }
        Button { choose(endOf(saturday)) } label: { Label("This weekend", systemImage: "sofa") }
        Button { choose(endOf(nextMonday)) } label: { Label("Next week", systemImage: "arrow.right.to.line") }
        Button(action: pick) { Label("Pick a date…", systemImage: "calendar") }
        if hasDue {
            Divider()
            Button(role: .destructive) { choose(nil) } label: { Label("No date", systemImage: "xmark") }
        }
    }
}

/// A date and, optionally, a time. Date-only is saved at 23:59 (the planner's convention).
struct DuePicker: View {
    let initial: Date?
    let save: (Date?) -> Void
    @State private var date = Date()
    @State private var timed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DatePicker("Due", selection: $date, displayedComponents: [.date])
                .datePickerStyle(.graphical)
                .labelsHidden()
            Toggle("At a time", isOn: $timed.animation(.easeOut(duration: 0.15)))
            if timed {
                DatePicker("Time", selection: $date, displayedComponents: [.hourAndMinute])
            }
            HStack {
                Button("Clear", role: .destructive) { save(nil) }
                Spacer()
                Button("Set") {
                    let cal = Calendar.current
                    save(timed ? date : cal.date(bySettingHour: 23, minute: 59, second: 0, of: date) ?? date)
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
        .frame(width: 300)
        .onAppear {
            if let initial {
                timed = TodoBoard.hasTime(initial)
                date = initial
            } else {
                let next = Calendar.current.nextDate(after: Date(), matching: DateComponents(minute: 0), matchingPolicy: .nextTime) ?? Date()
                date = next
            }
        }
    }
}

/// Toggle existing tags on or off, or make a new one.
struct TagChoices: View {
    let all: [String]
    let selected: [String]
    let toggle: (String) -> Void
    let new: () -> Void

    var body: some View {
        ForEach(all, id: \.self) { tag in
            Button { toggle(tag) } label: {
                Label(tag, systemImage: selected.contains(tag) ? "checkmark" : "number")
            }
        }
        if !all.isEmpty { Divider() }
        Button(action: new) { Label("New tag…", systemImage: "plus") }
    }
}

/// The screen's tag colours (TodoTagColor.assign), so no two tags look alike.
private struct TodoTagColoursKey: EnvironmentKey { static let defaultValue: [String: Int] = [:] }
extension EnvironmentValues {
    var todoTagColours: [String: Int] {
        get { self[TodoTagColoursKey.self] }
        set { self[TodoTagColoursKey.self] = newValue }
    }
}
