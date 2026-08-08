import AppKit
import SwiftUI

/*
 Messages, read-only.

 Conversations on the left, the selected thread on the right — the shape every
 messaging surface converges on because it is the one that works. What is
 deliberately absent is a composer. Orion reads; it does not send. Sending is a
 different promise, and one worth making on purpose rather than by having a text
 field lying around.

 The empty states carry most of the weight here, because the interesting failure
 is not "no messages" — it is Full Disk Access, which cannot be requested and
 therefore has to be explained.
*/

struct MessagesTab: View {
    @ObservedObject var messages: MessagesReader
    @ObservedObject var contacts: ContactsClient

    var body: some View {
        Group {
            switch messages.access {
            case .granted:
                if messages.conversations.isEmpty { nothingYet } else { conversationsView }
            case .needsFullDisk:
                fullDiskNotice
            case .noDatabase:
                notice(title: "No Messages database",
                       body: "This Mac has never run Messages, so there is nothing to read. Sign in to Messages and it will appear here.",
                       tint: OrionTheme.textDim)
            case .failed(let why):
                notice(title: "Could not read Messages", body: why, tint: OrionTheme.red)
            case .unknown:
                Text("Checking…")
                    .font(OrionTheme.mono(11))
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
        .onAppear {
            messages.contacts = contacts
            messages.refresh()
        }
    }

    // MARK: - Connected

    private var conversationsView: some View {
        HStack(alignment: .top, spacing: 40) {
            VStack(alignment: .leading, spacing: 14) {
                SectionRule(title: "Conversations",
                            trailing: messages.unreadTotal > 0 ? "\(messages.unreadTotal) unread" : nil)
                VStack(spacing: 0) {
                    ForEach(messages.conversations) { conversation in
                        ConversationRow(
                            conversation: conversation,
                            isSelected: messages.selectedChat == conversation.id
                        ) {
                            withAnimation(.easeOut(duration: 0.16)) {
                                messages.selectedChat = conversation.id
                            }
                        }
                        if conversation.id != messages.conversations.last?.id {
                            Rectangle().fill(OrionTheme.line).frame(height: 1)
                        }
                    }
                }
            }
            .frame(width: 320)

            thread
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var thread: some View {
        if let chatID = messages.selectedChat ?? messages.conversations.first?.id,
           let conversation = messages.conversations.first(where: { $0.id == chatID }) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(conversation.title)
                        .font(OrionTheme.display(24))
                        .foregroundStyle(OrionTheme.text)
                    if conversation.isGroup {
                        Text("GROUP")
                            .font(OrionTheme.mono(8, .semibold))
                            .tracking(1.2)
                            .foregroundStyle(OrionTheme.violet)
                    }
                    Spacer(minLength: 8)
                    if let synced = messages.lastSyncedAt {
                        Text("read \(synced.formatted(date: .omitted, time: .shortened))")
                            .font(OrionTheme.mono(9))
                            .foregroundStyle(OrionTheme.textDim)
                    }
                }

                if !conversation.isGroup, let handle = conversation.handles.first {
                    Text(ContactsClient.pretty(handle: handle))
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }

                FadingRule()

                VStack(alignment: .leading, spacing: 14) {
                    ForEach(messages.thread(chatID)) { message in
                        MessageBubble(message: message,
                                      sender: senderName(message, in: conversation))
                    }
                }
            }
        } else {
            Text("Pick a conversation.")
                .font(.system(size: 13))
                .foregroundStyle(OrionTheme.textDim)
        }
    }

    /// Only worth naming in a group — in a one-to-one thread the heading
    /// already says who the other person is, and repeating it on every line is
    /// noise.
    private func senderName(_ message: Message, in conversation: Conversation) -> String? {
        guard conversation.isGroup, !message.isFromMe else { return nil }
        return contacts.name(forHandle: message.handle)
            ?? ContactsClient.pretty(handle: message.handle)
    }

    // MARK: - Empty states

    private var nothingYet: some View {
        notice(title: "Nothing in the last few hundred messages",
               body: "Orion reads the most recent messages rather than the whole history — that database runs to hundreds of megabytes.",
               tint: OrionTheme.textDim)
    }

    /// The one that matters. Full Disk Access cannot be requested by any app,
    /// so this has to be a set of instructions rather than a button.
    private var fullDiskNotice: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "Messages", trailing: "needs Full Disk Access")

            Text("macOS is refusing Orion the Messages database")
                .font(OrionTheme.display(24))
                .foregroundStyle(OrionTheme.orange)

            Text("There is no Messages API on macOS. The only source of a conversation is a protected database, and the only key to it is Full Disk Access — which no app can request. There is no prompt to raise and no entitlement that grants it; it is granted by hand or not at all.")
                .font(.system(size: 13))
                .foregroundStyle(OrionTheme.textSoft)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 620, alignment: .leading)

            VStack(alignment: .leading, spacing: 9) {
                step(1, "Open Privacy & Security ▸ Full Disk Access.")
                step(2, "Press +, and add Orion from the path below.")
                step(3, "Quit Orion completely and reopen it. macOS only applies the change on a fresh launch.")
            }

            Text(PermissionsAudit.bundlePath)
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
                .textSelection(.enabled)

            HStack(spacing: 18) {
                LogButton(title: "Open Full Disk Access", systemImage: "arrow.up.right", tint: OrionTheme.orange) {
                    PermissionsAudit.open("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
                }
                InlineAction(title: "Reveal Orion in Finder", systemImage: "folder", tint: OrionTheme.textSoft) {
                    NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
                }
                InlineAction(title: "Check again", systemImage: "arrow.clockwise", tint: OrionTheme.textSoft) {
                    messages.refresh()
                }
            }

            // Said plainly, because it is a much larger grant than the others
            // and the user should know what they are handing over.
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(OrionTheme.orange)
                Text("Worth knowing: Full Disk Access is not scoped to Messages. It lets Orion read any file in your home folder. Orion only opens the Messages database, read-only, and the code that does it is one file — but the grant itself is broad, and that is macOS's design rather than a choice Orion makes.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.orange.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 620, alignment: .leading)
            }
        }
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(number)")
                .font(OrionTheme.mono(9, .semibold))
                .foregroundStyle(OrionTheme.textDim)
                .frame(width: 12, alignment: .trailing)
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(OrionTheme.textSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func notice(title: String, body: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionRule(title: "Messages")
            Text(title)
                .font(OrionTheme.display(22))
                .foregroundStyle(tint)
            Text(body)
                .font(.system(size: 13))
                .foregroundStyle(OrionTheme.textSoft)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 620, alignment: .leading)
        }
    }
}

private struct ConversationRow: View {
    let conversation: Conversation
    let isSelected: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 11) {
                // Unread is a mark, not a badge — the count is on the section
                // heading and repeating it per row is noise.
                Circle()
                    .fill(conversation.unread > 0 ? OrionTheme.accent : .clear)
                    .frame(width: 6, height: 6)
                    .padding(.top, 5)

                VStack(alignment: .leading, spacing: 3) {
                    Text(conversation.title)
                        .font(.system(size: 13, weight: conversation.unread > 0 ? .semibold : .medium))
                        .foregroundStyle(OrionTheme.text)
                        .lineLimit(1)
                    Text((conversation.lastFromMe ? "You: " : "") + conversation.lastMessage)
                        .font(.system(size: 11))
                        .foregroundStyle(conversation.unread > 0 ? OrionTheme.textSoft : OrionTheme.textDim)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 8)

                Text(Self.when(conversation.lastDate))
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 8)
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? OrionTheme.accent.opacity(0.10)
                          : (hovering ? Color.white.opacity(0.035) : .clear))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
    }

    /// Time today, weekday this week, date beyond that — the resolution people
    /// actually want, which decreases as things get older.
    static func when(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
        if calendar.isDateInYesterday(date) { return "yesterday" }
        if let week = calendar.date(byAdding: .day, value: -6, to: Date()), date > week {
            return date.formatted(.dateTime.weekday(.abbreviated))
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

private struct MessageBubble: View {
    let message: Message
    let sender: String?

    var body: some View {
        HStack {
            if message.isFromMe { Spacer(minLength: 60) }

            VStack(alignment: message.isFromMe ? .trailing : .leading, spacing: 3) {
                if let sender {
                    Text(sender)
                        .font(OrionTheme.mono(8, .semibold))
                        .tracking(1)
                        .foregroundStyle(OrionTheme.textDim)
                }
                Text(message.text)
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.text)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(message.isFromMe ? .trailing : .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(tint.opacity(0.16))
                            .overlay {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(tint.opacity(0.3), lineWidth: 1)
                            }
                    }
                Text(message.date.formatted(date: .omitted, time: .shortened)
                     + (message.service == "SMS" ? " · SMS" : ""))
                    .font(OrionTheme.mono(8))
                    .foregroundStyle(OrionTheme.textDim)
            }
            .frame(maxWidth: 460, alignment: message.isFromMe ? .trailing : .leading)

            if !message.isFromMe { Spacer(minLength: 60) }
        }
    }

    /// Green for SMS, blue for iMessage — the convention everyone already
    /// knows, so it needs no legend.
    private var tint: Color {
        if message.isFromMe { return message.service == "SMS" ? OrionTheme.green : OrionTheme.accent }
        return OrionTheme.textSoft
    }
}
