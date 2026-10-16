import SwiftUI
import MobileCore

/// One chat in the drawer: its id and the line that names it.
struct ChatSummary: Identifiable, Equatable {
    let id: String
    let title: String
    let lastAt: Date

    /// Conversations in the thread, newest first, named by their first words.
    static func list(from messages: [CloudLink.Message]) -> [ChatSummary] {
        Dictionary(grouping: messages.filter { $0.conversationID != nil }, by: { $0.conversationID! })
            .map { id, group in
                let sorted = group.sorted { $0.sentAt < $1.sentAt }
                let first = sorted.first
                let words = [first?.text, first?.reply].compactMap { $0 }.first { !$0.isEmpty } ?? "Chat"
                return ChatSummary(id: id, title: String(words.prefix(44)), lastAt: sorted.last?.sentAt ?? .distantPast)
            }
            .sorted { $0.lastAt > $1.lastAt }
    }
}

/// The side drawer: new chat, the sections that used to be tabs, and past chats.
/// Flat on the backdrop; rows are text with an icon, separated by space.
struct PhoneDrawer: View {
    let chats: [ChatSummary]
    let currentChat: String?
    let waitingApprovals: Int
    let online: Bool
    @Binding var appearance: String
    let onNewChat: () -> Void
    let onOpenChat: (String?) -> Void
    let onOpenSection: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                PhoneOrb(mood: .idle, size: 30)
                Text("ORION").font(.system(size: 20, weight: .semibold)).foregroundStyle(Phone.text)
                Spacer()
            }
            .padding(.top, 14).padding(.bottom, 22)

            row("square.and.pencil", "New chat", id: "drawerNewChat", action: onNewChat)
            sectionRows.padding(.top, 14)

            Text("Chats").font(.system(size: 12, weight: .medium)).foregroundStyle(Phone.dim)
                .padding(.top, 26).padding(.bottom, 6)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    chatRow("All history", selected: currentChat == nil) { onOpenChat(nil) }
                    ForEach(chats) { chat in chatRow(chat.title, selected: chat.id == currentChat) { onOpenChat(chat.id) } }
                }
            }
            Rectangle().fill(Phone.hairline).frame(height: 1)
            footer
        }
        .padding(.horizontal, 20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Phone.ink.ignoresSafeArea())
        .overlay(alignment: .trailing) { Rectangle().fill(Phone.hairline).frame(width: 1).ignoresSafeArea() }
    }

    private var sectionRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            row("sun.max", "Today", id: "drawerToday") { onOpenSection("today") }
            row("calendar", "Plan", id: "drawerPlan") { onOpenSection("plan") }
            row("heart", "Health & tracking", id: "drawerHealth") { onOpenSection("health") }
            row("slider.horizontal.3", "Focus, Mac & settings", id: "drawerControl", badge: waitingApprovals) { onOpenSection("control") }
        }
    }

    private var footer: some View {
        HStack {
            Circle().fill(online ? Phone.green : Phone.dim).frame(width: 6, height: 6)
            Text(online ? "Mac online" : "Mac not reachable").font(.system(size: 13)).foregroundStyle(Phone.dim)
            Spacer()
            Menu {
                Picker("Appearance", selection: $appearance) {
                    Text("Dark").tag("dark"); Text("Light").tag("light"); Text("System").tag("system")
                }
            } label: {
                Label("Appearance", systemImage: appearance == "light" ? "sun.max" : "moon").labelStyle(.iconOnly)
                    .font(.system(size: 16)).foregroundStyle(Phone.soft).frame(width: 36, height: 36)
            }
        }
        .padding(.vertical, 10)
    }

    private func row(_ symbol: String, _ title: String, id: String, badge: Int = 0, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbol).font(.system(size: 17, weight: .light)).foregroundStyle(Phone.soft).frame(width: 24)
                Text(title).font(.system(size: 17)).foregroundStyle(Phone.text)
                Spacer()
                if badge > 0 {
                    Text("\(badge)").font(.system(size: 13, weight: .semibold)).foregroundStyle(Phone.orange)
                }
            }
            .padding(.vertical, 11).contentShape(Rectangle())
        }
        .buttonStyle(.plain).accessibilityIdentifier(id)
    }

    private func chatRow(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 16)).lineLimit(1)
                .foregroundStyle(selected ? Phone.text : Phone.soft)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 9).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Slides the drawer over the chat with a dim scrim; tap the scrim or drag left to close.
struct PhoneDrawerHost<Content: View, Drawer: View>: View {
    @Binding var open: Bool
    @ViewBuilder let content: () -> Content
    @ViewBuilder let drawer: () -> Drawer
    @GestureState private var drag: CGFloat = 0
    private let width: CGFloat = 300

    var body: some View {
        ZStack(alignment: .leading) {
            content()
                .allowsHitTesting(!open)
                .overlay(alignment: .leading) {
                    // A narrow strip on the left edge opens the drawer with a swipe.
                    if !open {
                        Color.clear.frame(width: 18).contentShape(Rectangle())
                            .gesture(DragGesture(minimumDistance: 12).onEnded { if $0.translation.width > 40 { open = true } })
                    }
                }
            Color.black.opacity(open ? 0.45 : 0).ignoresSafeArea()
                .allowsHitTesting(open).onTapGesture { open = false }
            drawer().frame(width: width)
                .offset(x: open ? min(0, drag) : -width - 2)
                .gesture(DragGesture().updating($drag) { value, state, _ in state = min(0, value.translation.width) }
                    .onEnded { if $0.translation.width < -60 { open = false } })
        }
        .animation(.easeOut(duration: 0.22), value: open)
    }
}
