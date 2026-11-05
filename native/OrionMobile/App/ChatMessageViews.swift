import SwiftUI
import MobileCore

/// The chat's type scale and rhythm, one place (the Claude / ChatGPT cadence).
enum PhoneChat {
    static let body = Font.system(.callout)
    static let bodyLineSpacing: CGFloat = 5
    static let meta = Font.system(.caption)
    /// Mono letter-spaced kicker, the Home language.
    static let kicker = Font.system(.caption2, design: .monospaced, weight: .medium)
    static let bubbleRadius: CGFloat = 20
    /// The gutter on the side a bubble does not occupy: keeps bubbles at about 80% of the width.
    static let gutter: CGFloat = 48
    static let action = Font.system(.subheadline, weight: .medium)
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
    /// Where his message is in its life (sending, delivered, thinking, answered, stuck), and whether the Mac is answering.
    var delivery: ChatDelivery = .answered
    var macOnline = true
    /// True for a message that arrived after the thread was first shown: it eases in.
    var arriving = false
    /// ORION speaking first, right after another such message: no caption of its own, it reads as one group.
    var grouped = false
    var onRetry: () -> Void = {}
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

    /// The small line under his bubble: Sending…, Delivered, or a retry pill after a failure.
    @ViewBuilder private var statusLine: some View {
        if let caption = delivery.caption(macOnline: macOnline, received: message.received) {
            if delivery.canRetry {
                Button(action: onRetry) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: "arrow.clockwise").font(.system(size: 10, weight: .bold))
                        Text(caption).font(PhoneChat.kicker).tracking(0.6).multilineTextAlignment(.leading)
                    }
                    .foregroundStyle(Phone.orange).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .overlay(Capsule().stroke(Phone.orange.opacity(0.6), lineWidth: 1))
                    .shadow(color: Phone.orange.opacity(0.25), radius: 5)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .buttonStyle(PhonePressStyle()).accessibilityIdentifier("retryMessage")
                .transition(.opacity)
            } else {
                HStack(spacing: 6) {
                    if delivery == .sending { ProgressView().controlSize(.mini).tint(Phone.dim) }
                    Text(caption.uppercased()).font(PhoneChat.kicker).tracking(0.8)
                }
                .foregroundStyle(Phone.dim).multilineTextAlignment(.trailing).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .transition(.opacity).accessibilityIdentifier("messageStatus")
            }
        }
    }

    /// His bubble: a thin accent rim with a soft glow, the near-bottom corner tightened. Failed ones go orange.
    private var userBubbleShape: UnevenRoundedRectangle {
        let r = PhoneChat.bubbleRadius
        return UnevenRoundedRectangle(topLeadingRadius: r, bottomLeadingRadius: r, bottomTrailingRadius: 6, topTrailingRadius: r, style: .continuous)
    }

    private var userLine: some View {
        let failed = delivery.canRetry
        let tint = failed ? Phone.orange : Phone.accent
        return VStack(alignment: .trailing, spacing: 6) {
            HStack(spacing: 0) {
                Spacer(minLength: PhoneChat.gutter)
                Text(PhoneLinks.linked(message.text))
                    .font(PhoneChat.body).lineSpacing(3).foregroundStyle(Phone.text)
                    .tint(Phone.accent)
                    .multilineTextAlignment(.leading).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(tint.opacity(failed ? 0.05 : 0.12), in: userBubbleShape)
                    .overlay(userBubbleShape.stroke(tint.opacity(failed ? 0.6 : 0.42), lineWidth: 1))
                    .shadow(color: tint.opacity(failed ? 0.12 : 0.2), radius: 8)
            }
            statusLine.padding(.trailing, 4)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .contentShape(Rectangle())
        .animation(PhoneMotion.enter, value: delivery)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var orionLine: some View {
        Group {
            switch delivery {
            case .waiting, .thinking:
                HStack(spacing: 10) {
                    PhoneThinkingDots()
                    PhoneShimmerText(text: delivery == .waiting ? waitingText : (message.progress ?? "Thinking"))
                }
                .transition(.opacity)
            case .sending, .notSent, .stalled:
                // Nothing from ORION yet, and none promised: his message carries the state.
                EmptyView()
            case .failed:
                if message.reply != nil { reply.transition(.opacity) }
            case .answered:
                reply.transition(.opacity.combined(with: .offset(y: 6)))
            }
        }
        .animation(PhoneMotion.enter, value: delivery)
    }

    private var replyShape: UnevenRoundedRectangle {
        let r = PhoneChat.bubbleRadius
        return UnevenRoundedRectangle(topLeadingRadius: r, bottomLeadingRadius: 6, bottomTrailingRadius: r, topTrailingRadius: r, style: .continuous)
    }

    private var reply: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                if let note = originNote { caption(note) }
                if let thinking = message.thinking, !thinking.isEmpty {
                    DisclosureGroup("Thinking") { Text(thinking).font(.system(size: 13)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
                        .font(.system(size: 13)).foregroundStyle(Phone.dim)
                }
                Text(PhoneLinks.linked(ConversationView.rendered(shownReply)))
                    .font(PhoneChat.body).lineSpacing(PhoneChat.bodyLineSpacing - 1)
                    .foregroundStyle(delivery == .failed ? Phone.orange : Phone.text)
                    .tint(Phone.accent)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                if let ask = message.askID, awaitingReplyTo == ask { askActions(ask) }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(Phone.wash(0.045), in: replyShape)
            .overlay(replyShape.stroke(proactive ? Phone.accent.opacity(0.35) : Phone.hairline, lineWidth: 1))
            .shadow(color: Phone.accent.opacity(proactive ? 0.12 : 0), radius: 8)
            Spacer(minLength: PhoneChat.gutter)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// ORION's words as Nick should read them: no job tags or notify headers, 12-hour times (also for history written before that fix).
    private var shownReply: String {
        let raw = message.reply ?? "No answer came back."
        return ChatSanitizer.display(raw) ?? (message.text.isEmpty ? "" : raw)
    }

    private func caption(_ text: String) -> some View {
        HStack(spacing: 6) {
            if proactive { Circle().fill(Phone.accent).frame(width: 4, height: 4) }
            Text(text).font(PhoneChat.kicker).tracking(1.2).foregroundStyle(Phone.dim).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        }
    }

    /// A small line above ORION's words when it did not come from a question.
    private var originNote: String? {
        if message.id.hasPrefix("local-") { return "ANSWERED ON YOUR IPHONE" }
        if grouped { return nil }
        if PhoneMirror.isMirrorID(message.askID) { return "ORION · NOTIFICATION" }
        if message.askID != nil { return "ORION · FIRST" }
        return nil
    }

    private func askActions(_ ask: String) -> some View {
        HStack(spacing: 18) {
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

/// One time label per run of messages, as a mono kicker between two fading hairlines.
struct ChatTimeMarker: View {
    let date: Date
    private var text: String {
        let cal = Calendar.current
        let time = date.formatted(date: .omitted, time: .shortened)
        if cal.isDateInToday(date) { return "TODAY " + time }
        if cal.isDateInYesterday(date) { return "YESTERDAY " + time }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()).uppercased() + " " + time
    }
    var body: some View {
        HStack(spacing: 10) {
            line(.leading)
            Text(text.uppercased()).font(PhoneChat.kicker).tracking(1.4).foregroundStyle(Phone.dim)
                .lineLimit(1).minimumScaleFactor(0.7).layoutPriority(1).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            line(.trailing)
        }
        .frame(maxWidth: .infinity).padding(.top, 6)
        .accessibilityElement(children: .ignore).accessibilityLabel(text.capitalized)
    }
    private func line(_ edge: HorizontalEdge) -> some View {
        LinearGradient(colors: edge == .leading ? [.clear, Phone.wash(0.14)] : [Phone.wash(0.14), .clear], startPoint: .leading, endPoint: .trailing)
            .frame(height: 0.5)
    }
}

/// Makes web addresses in plain text tappable (long ones wrap, they do not run off the edge).
enum PhoneLinks {
    static func linked(_ text: String) -> AttributedString { linked(AttributedString(text)) }

    static func linked(_ text: AttributedString) -> AttributedString {
        let plain = String(text.characters)
        guard plain.contains("."), let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return text }
        var result = text
        for match in detector.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
            guard let url = match.url, let range = Range(match.range, in: plain),
                  let lower = AttributedString.Index(range.lowerBound, within: result),
                  let upper = AttributedString.Index(range.upperBound, within: result),
                  result[lower..<upper].link == nil else { continue }
            result[lower..<upper].link = url
        }
        return result
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
