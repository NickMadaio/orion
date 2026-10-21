import Combine
import CoreGraphics
import Foundation

/// The to-do float: a compact list that either drops down under the minimized
/// session bar or pops out as its own always-on-top window. This file is the
/// pure part -- state, persistence, which tasks show, the completion path and
/// the panel-resize rule -- so none of it needs AppKit to be tested.

/// What he last left the float as. Two independent bits: whether the dropdown
/// under the session bar is open, and whether the list is its own window.
struct TodoFloatState: Equatable, Codable {
    var expanded = false
    var poppedOut = false
}

/// Where that state is remembered. A protocol so tests use memory, not defaults.
protocol TodoFloatStore {
    func load() -> TodoFloatState
    func save(_ state: TodoFloatState)
}

struct UserDefaultsTodoFloatStore: TodoFloatStore {
    static let key = "orion.todoFloat.state"
    let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func load() -> TodoFloatState {
        guard let data = defaults.data(forKey: Self.key),
              let state = try? JSONDecoder().decode(TodoFloatState.self, from: data) else { return TodoFloatState() }
        return state
    }

    func save(_ state: TodoFloatState) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        defaults.set(data, forKey: Self.key)
    }
}

final class TodoFloatModel: ObservableObject {
    @Published private(set) var state: TodoFloatState
    private let store: TodoFloatStore

    init(store: TodoFloatStore = UserDefaultsTodoFloatStore()) {
        self.store = store
        self.state = store.load()
    }

    /// The dropdown under the session bar: open, and not already its own window
    /// (the same list twice on screen is noise).
    var showsDropdown: Bool { state.expanded && !state.poppedOut }
    var isPoppedOut: Bool { state.poppedOut }

    /// The chevron. While popped out it brings the list back instead -- one tap
    /// from "where did it go" to "here".
    func toggleExpanded() {
        update { next in
            if next.poppedOut { next.poppedOut = false; next.expanded = true } else { next.expanded.toggle() }
        }
    }

    func popOut() { update { $0.poppedOut = true } }

    /// Menu bar / Tasks tab: open it if closed, close it if open.
    func togglePopOut() { update { $0.poppedOut.toggle() } }

    /// Back into the session bar, open.
    func dock() { update { $0.poppedOut = false; $0.expanded = true } }

    /// Closed outright; the dropdown keeps whatever it was.
    func closePopOut() { update { $0.poppedOut = false } }

    private func update(_ change: (inout TodoFloatState) -> Void) {
        var next = state
        change(&next)
        guard next != state else { return }
        state = next
        store.save(next)
    }
}

/// Which tasks the float lists: what is open and due today or overdue, then
/// anything undated (a to-do with no date is still on his plate), then what he
/// finished today so ticking one does not make it vanish under his cursor.
enum TodoFloatItems {
    static func today(_ tasks: [SyncedTask], now: Date = Date(), calendar: Calendar = .current,
                      limit: Int = 40) -> [SyncedTask] {
        let endOfToday = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
        let open = tasks.filter { task in
            guard !task.isComplete else { return false }
            guard let due = task.dueDate else { return true }
            return due < endOfToday
        }
        let doneToday = tasks.filter { task in
            guard task.isComplete, let at = task.completionDate else { return false }
            return calendar.isDate(at, inSameDayAs: now)
        }
        let sorted = open.sorted { lhs, rhs in
            let a = lhs.sortKey, b = rhs.sortKey
            return (a.0, a.1, a.2) < (b.0, b.1, b.2)
        }
        return Array((sorted + doneToday).prefix(limit))
    }

    static func openCount(_ tasks: [SyncedTask], now: Date = Date(), calendar: Calendar = .current) -> Int {
        today(tasks, now: now, calendar: calendar).filter { !$0.isComplete }.count
    }
}

/// The one way a tick becomes a change in Reminders, shared by the Tasks tab and
/// both float surfaces so they cannot disagree about it.
enum TodoCompletion {
    /// Flips `id`. Returns whether a task was found. `apply` is
    /// `AppleRemindersSync.setComplete`.
    @discardableResult
    static func toggle(id: String, in tasks: [SyncedTask], apply: (String, Bool) -> Void) -> Bool {
        guard let task = tasks.first(where: { $0.id == id }) else { return false }
        apply(id, !task.isComplete)
        return true
    }
}

/// Where the session float's panel goes when its content grows or shrinks: the
/// top edge stays put (the bar does not jump), unless that would push the
/// bottom off the screen, in which case it slides up just enough.
enum FloatPanelResize {
    static func frame(current: CGRect, newSize: CGSize, visible: CGRect) -> CGRect {
        var origin = CGPoint(x: current.minX, y: current.maxY - newSize.height)
        if origin.y < visible.minY { origin.y = visible.minY }
        if origin.y + newSize.height > visible.maxY { origin.y = max(visible.minY, visible.maxY - newSize.height) }
        if origin.x + newSize.width > visible.maxX { origin.x = max(visible.minX, visible.maxX - newSize.width) }
        return CGRect(origin: origin, size: newSize)
    }
}

/// Which to-do surfaces are on screen. The Reminders sync runs only while this
/// is non-empty.
struct TodoSurfaceSet {
    private var names = Set<String>()
    var isEmpty: Bool { names.isEmpty }
    mutating func insert(_ name: String) { names.insert(name) }
    mutating func remove(_ name: String) { names.remove(name) }
}

/// A saved window frame is only worth restoring if enough of it is on a
/// connected screen to grab; otherwise the window is recentred on the main one.
enum FrameRecovery {
    static func visibleEnough(_ frame: CGRect, screens: [CGRect], minWidth: CGFloat = 60, minHeight: CGFloat = 30) -> Bool {
        screens.contains { screen in
            let overlap = screen.intersection(frame)
            return !overlap.isNull && overlap.width >= minWidth && overlap.height >= minHeight
        }
    }

    static func centered(size: CGSize, on screen: CGRect) -> CGRect {
        CGRect(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2, width: size.width, height: size.height)
    }
}
