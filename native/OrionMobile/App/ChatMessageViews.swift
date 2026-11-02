import SwiftUI
import MobileCore

/// The chat's type scale and rhythm, one place (the Claude / ChatGPT cadence).
enum PhoneChat {
    static let body = Font.system(size: 16)
    static let bodyLineSpacing: CGFloat = 5
    static let meta = Font.system(size: 12)
    static let action = Font.system(size: 14, weight: .medium)
    /// Between exchanges, and between the lines inside one.
    static let exchangeGap: CGFloat = 28
    static let lineGap: CGFloat = 12
}

/*
 One exchange in the thread, in the Claude / ChatGPT idiom (2026-10-16).

 ORION's words are plain text on the backdrop, left-aligned, no bubble.
 Nick's are a quiet rounded bubble on the right. A message ORION started
 (a push with an askId, or a phone notification mirrored into the thread, whose
 askId starts "phone.") has no words from Nick; it reads as ORION speaking
 first: a short fading rule beside it and a small dated caption, nothing boxed.
 While it is unanswered it offers "Reply" and "Not now" as plain text actions.
 The composer works regardless.
*/
struct ChatExchange: View {
    let message: CloudLink.Message
    /// The ask this reply would answer right now (nil when nothing is waiting).
    let awaitingReplyTo: String?
    let waitingText: String
    /// True for a message that arrived after the thread was first shown: it eases in.
    var arriving = false
    let onReply: (String) -> Void
    let onDecline: (String) -> Void

    private var proactive: Bool { message.askID != nil && message.text.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: PhoneChat.lineGap) {
            if !message.text.isEmpty { userLine.softReveal(arriving, rise: 56) }
            orionLine.softReveal(arriving && message.text.isEmpty)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var userLine: some View {
        HStack {
            Spacer(minLength: 56)
            Text(message.text)
                .font(PhoneChat.body).lineSpacing(4).foregroundStyle(Phone.text)
                .multilineTextAlignment(.leading).textSelection(.enabled)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(Phone.wash(0.08), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }

    @ViewBuilder private var orionLine: some View {
        Group {
            switch message.status {
            case .pending, .running:
                HStack(spacing: 10) {
                    PhoneThinkingDots()
                    PhoneShimmerText(text: message.status == .pending ? waitingText : "Thinking")
                }
                .transition(.opacity)
            case .done, .failed:
                reply.transition(.opacity.combined(with: .offset(y: 6)))
            }
        }
        .animation(PhoneMotion.enter, value: message.status)
    }

    private var reply: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let note = originNote { caption(note) }
            if let thinking = message.thinking, !thinking.isEmpty {
                DisclosureGroup("Thinking") { Text(thinking).font(.system(size: 13)).textSelection(.enabled) }
                    .font(.system(size: 13)).foregroundStyle(Phone.dim)
            }
            Text(ConversationView.rendered(message.reply ?? "No answer came back."))
                .font(PhoneChat.body).lineSpacing(PhoneChat.bodyLineSpacing)
                .foregroundStyle(message.status == .failed ? Phone.orange : Phone.text)
                .textSelection(.enabled)
            if let ask = message.askID, awaitingReplyTo == ask { askActions(ask) }
        }
        .padding(.trailing, 24)
        .padding(.leading, proactive ? 14 : 0)
        .overlay(alignment: .leading) { if proactive { proactiveRule } }
    }

    /// A short rule that fades out along its length: marks ORION speaking first, quietly.
    private var proactiveRule: some View {
        LinearGradient(colors: [Phone.accent.opacity(0.55), Phone.accent.opacity(0)], startPoint: .top, endPoint: .bottom)
            .frame(width: 1.5).frame(maxHeight: .infinity).accessibilityHidden(true)
    }

    private func caption(_ text: String) -> some View {
        HStack(spacing: 6) {
            if proactive { Circle().fill(Phone.accent).frame(width: 4, height: 4) }
            Text(text).font(PhoneChat.meta).foregroundStyle(Phone.dim)
        }
    }

    /// A small line above ORION's words when it did not come from a question.
    private var originNote: String? {
        let time = message.sentAt.formatted(date: .omitted, time: .shortened)
        if message.id.hasPrefix("local-") { return "Answered on your iPhone" }
        if PhoneMirror.isMirrorID(message.askID) { return "ORION · notification · " + time }
        if message.askID != nil { return "ORION · " + time }
        return nil
    }

    private func askActions(_ ask: String) -> some View {
        HStack(spacing: 22) {
            Button { onReply(ask) } label: {
                Label("Reply", systemImage: "arrowshape.turn.up.left").font(PhoneChat.action)
            }
            .accessibilityIdentifier("replyToAsk")
            Button { onDecline(ask) } label: { Text("Not now").font(.system(size: 14)) }
                .foregroundStyle(Phone.dim)
        }
        .buttonStyle(PhonePressStyle()).foregroundStyle(Phone.accent).padding(.top, 2)
    }
}

/// A quiet time marker between messages that are far apart.
struct ChatTimeMarker: View {
    let date: Date
    var body: some View {
        Text(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))
            .font(PhoneChat.meta).foregroundStyle(Phone.dim)
            .frame(maxWidth: .infinity).padding(.top, 6)
    }
}

/// Three dots that breathe while ORION works on an answer. Runs off the shared
/// ambient clock, so it stops with the app, under Reduce Motion and in Low Power Mode.
struct PhoneThinkingDots: View {
    var body: some View {
        AmbientTimeline { t in
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
                    .buttonStyle(PhonePressStyle(scale: 0.99))
                    .overlay(alignment: .top) { Rectangle().fill(Phone.hairline).frame(height: 1) }
                }
            }
        }
    }
}
