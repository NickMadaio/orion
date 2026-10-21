import SwiftUI

/// The compact to-do list used in both places it appears: under the minimized
/// session bar, and as its own floating window. No cards or bubbles -- rows
/// separated by hairlines, a real checkbox, nothing filled.
struct TodoFloatList: View {
    @ObservedObject var sync: AppleRemindersSync
    /// Popped out as a window: gets a header with dock / close. Docked: the
    /// session float already has its own chrome, so the list is just the list.
    let standalone: Bool
    var onPopOut: (() -> Void)?
    var onDock: (() -> Void)?
    var onClose: (() -> Void)?

    private let cyan = Color(red: 0.36, green: 0.83, blue: 0.93)
    static let rowHeight: CGFloat = 30
    static let maxDockedRows = 6

    private var items: [SyncedTask] { TodoFloatItems.today(sync.tasks) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            hairline
            content
        }
        .foregroundStyle(.white.opacity(0.92))
        .buttonStyle(.plain)
        .preferredColorScheme(.dark)
    }

    private var hairline: some View { Rectangle().fill(Color.white.opacity(0.12)).frame(height: 0.5) }

    private var header: some View {
        HStack(spacing: 4) {
            Text("TO-DOS").font(OrionTheme.mono(8, .semibold)).tracking(1.4).foregroundStyle(cyan)
            Text("\(TodoFloatItems.openCount(sync.tasks)) left")
                .font(OrionTheme.mono(9)).foregroundStyle(.white.opacity(0.45))
            Spacer(minLength: 8)
            if standalone {
                if let onDock {
                    Button(action: onDock) { Image(systemName: "arrow.down.right.and.arrow.up.left").hitTarget() }
                        .help("Dock back into the session float")
                }
                if let onClose {
                    Button(action: onClose) { Image(systemName: "xmark").hitTarget() }
                        .help("Close")
                }
            } else if let onPopOut {
                Button(action: onPopOut) { Image(systemName: "arrow.up.forward.square").hitTarget() }
                    .help("Pop out as its own window")
            }
        }
        .font(.system(size: 11, weight: .semibold))
        .padding(.leading, 14).padding(.trailing, 6)
        .frame(minHeight: HitTarget.minimum)
    }

    @ViewBuilder private var content: some View {
        if !sync.access.isGranted {
            note("Reminders access is needed for to-dos.")
        } else if items.isEmpty {
            note("Nothing due today.")
        } else if standalone {
            ScrollView { rows }
        } else {
            ScrollView { rows }
                .frame(height: CGFloat(min(items.count, Self.maxDockedRows)) * Self.rowHeight)
        }
    }

    private var rows: some View {
        VStack(spacing: 0) {
            ForEach(items) { task in
                row(task)
                if task.id != items.last?.id {
                    Rectangle().fill(Color.white.opacity(0.06)).frame(height: 0.5).padding(.leading, 40)
                }
            }
        }
    }

    private func row(_ task: SyncedTask) -> some View {
        Button {
            TodoCompletion.toggle(id: task.id, in: sync.tasks) { sync.setComplete($0, $1) }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: task.isComplete ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(task.isComplete ? cyan : (task.isOverdue ? Color.orange : .white.opacity(0.55)))
                    .frame(width: 28, height: Self.rowHeight)
                Text(task.title)
                    .font(.system(size: 12.5))
                    .strikethrough(task.isComplete)
                    .foregroundStyle(.white.opacity(task.isComplete ? 0.38 : 0.92))
                    .lineLimit(1)
                Spacer(minLength: 8)
                if task.isOverdue {
                    Text("overdue").font(OrionTheme.mono(8)).foregroundStyle(Color.orange.opacity(0.85))
                }
            }
            .padding(.leading, 8).padding(.trailing, 14)
            .frame(minHeight: Self.rowHeight)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(task.title)
        .accessibilityValue(task.isComplete ? "done" : "to do")
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
            .padding(.horizontal, 14).frame(minHeight: Self.rowHeight * 1.4, alignment: .leading)
    }
}

/// Reports a view's size so the panel hosting it can follow.
struct FloatSizeKey: PreferenceKey {
    static let defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}

extension View {
    func reportSize(_ onChange: @escaping (CGSize) -> Void) -> some View {
        background(GeometryReader { proxy in Color.clear.preference(key: FloatSizeKey.self, value: proxy.size) })
            .onPreferenceChange(FloatSizeKey.self) { size in if size != .zero { onChange(size) } }
    }
}
