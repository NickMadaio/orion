import SwiftUI
import MobileCore

/*
 One exchange in the thread, in the Claude / ChatGPT idiom (2026-10-16).

 ORION's words are plain text on the backdrop, left-aligned, no bubble.
 Nick's are a quiet rounded bubble on the right. A message ORION started
 (a push with an askId) has no words from Nick; it reads as ORION speaking
 first, and while it is unanswered it offers "Reply" and "Not now" as plain
 text actions. The composer works regardless.
*/
struct ChatExchange: View {
    let message: CloudLink.Message
    /// The ask this reply would answer right now (nil when nothing is waiting).
    let awaitingReplyTo: String?
    let waitingText: String
    let onReply: (String) -> Void
    let onDecline: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !message.text.isEmpty { userLine }
            orionLine
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var userLine: some View {
        HStack {
            Spacer(minLength: 56)
            Text(message.text)
                .font(.system(size: 16)).lineSpacing(4).foregroundStyle(Phone.text)
                .multilineTextAlignment(.leading).textSelection(.enabled)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(Phone.wash(0.08), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }

    @ViewBuilder private var orionLine: some View {
        switch message.status {
        case .pending, .running:
            HStack(spacing: 10) {
                PhoneThinkingDots()
                Text(message.status == .pending ? waitingText : "Thinking")
                    .font(.system(size: 14)).foregroundStyle(Phone.dim)
            }
        case .done, .failed:
            VStack(alignment: .leading, spacing: 8) {
                if let note = originNote { Text(note).font(.system(size: 12)).foregroundStyle(Phone.dim) }
                if let thinking = message.thinking, !thinking.isEmpty {
                    DisclosureGroup("Thinking") { Text(thinking).font(.system(size: 13)).textSelection(.enabled) }
                        .font(.system(size: 13)).foregroundStyle(Phone.dim)
                }
                Text(ConversationView.rendered(message.reply ?? "No answer came back."))
                    .font(.system(size: 16)).lineSpacing(5)
                    .foregroundStyle(message.status == .failed ? Phone.orange : Phone.text)
                    .textSelection(.enabled)
                if let ask = message.askID, awaitingReplyTo == ask { askActions(ask) }
            }
            .padding(.trailing, 24)
        }
    }

    /// A small line above ORION's words when it did not come from a question.
    private var originNote: String? {
        if message.id.hasPrefix("local-") { return "Answered on your iPhone" }
        if message.askID != nil { return "ORION · " + message.sentAt.formatted(date: .omitted, time: .shortened) }
        return nil
    }

    private func askActions(_ ask: String) -> some View {
        HStack(spacing: 22) {
            Button { onReply(ask) } label: {
                Label("Reply", systemImage: "arrowshape.turn.up.left").font(.system(size: 14, weight: .medium))
            }
            .accessibilityIdentifier("replyToAsk")
            Button { onDecline(ask) } label: { Text("Not now").font(.system(size: 14)) }
                .foregroundStyle(Phone.dim)
        }
        .buttonStyle(.plain).foregroundStyle(Phone.accent).padding(.top, 2)
    }
}

/// A quiet time marker between messages that are far apart.
struct ChatTimeMarker: View {
    let date: Date
    var body: some View {
        Text(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))
            .font(.system(size: 12)).foregroundStyle(Phone.dim)
            .frame(maxWidth: .infinity).padding(.top, 6)
    }
}

/// Three dots that breathe while ORION works on an answer.
struct PhoneThinkingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3) { index in
                    let phase = (sin(t * 5 - Double(index) * 0.8) + 1) / 2
                    Circle().fill(Phone.soft.opacity(0.35 + 0.65 * phase)).frame(width: 6, height: 6)
                        .offset(y: -2.5 * phase)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// The empty thread: the orb, one line, and a few things to ask, divided by hairlines.
struct ChatEmptyState: View {
    let mood: OrbMood
    let level: Float
    let suggestions: [String]
    let onPick: (String) -> Void

    var body: some View {
        VStack(spacing: 22) {
            PhoneOrb(mood: mood, level: level, size: 72).padding(.top, 36)
            Text("How can I help?").font(.system(size: 22, weight: .semibold)).foregroundStyle(Phone.text)
            VStack(spacing: 0) {
                ForEach(suggestions, id: \.self) { suggestion in
                    Button { onPick(suggestion) } label: {
                        Text(suggestion).font(.system(size: 15)).foregroundStyle(Phone.soft)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 13).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .top) { Rectangle().fill(Phone.hairline).frame(height: 1) }
                }
            }
        }
    }
}
