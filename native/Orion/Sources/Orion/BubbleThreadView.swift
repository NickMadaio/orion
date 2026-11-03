import SwiftUI

/*
 The proactive bubble, drawn as a mini-thread (W16-d). Over an unknown desktop, so legibility comes from real alpha behind the
 text and a text shadow, never a material plate (2026-10-16 UI audit #8). ORION's lines keep the left hairline; his reply sits
 right in a thin glow-rim pill; while ORION thinks, a soft shimmer line; past the limit, the honest status in place of it.
 Holds still under Reduce Motion and in renders (orionFrozenMotion).
*/
struct BubbleThreadView: View {
    let thread: BubbleThread
    var width: CGFloat = 260
    /// Called with true for "Set up", false for "Not now" (the new-mouse question).
    var onMouseAnswer: ((Bool) -> Void)?
    /// Called with true for "Reopen", false for "No" (the game-over question).
    var onGameReopen: ((Bool) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            orionLine(thread.message, lines: thread.reply == nil ? 8 : 2, dim: thread.reply != nil)
            if thread.offersMouseSetup, thread.state == .shown, let onMouseAnswer {
                HStack(spacing: 8) {
                    ProjectBubble(text: "Set up", symbol: "computermouse", action: { onMouseAnswer(true) })
                    ProjectBubble(text: "Not now", hue: OrionTheme.textSoft, action: { onMouseAnswer(false) })
                }
                .padding(.leading, 12)
            }
            if thread.offersGameReopen, thread.state == .shown, let onGameReopen {
                HStack(spacing: 8) {
                    ProjectBubble(text: "Reopen", symbol: "arrow.uturn.backward", action: { onGameReopen(true) })
                    ProjectBubble(text: "No", hue: OrionTheme.textSoft, action: { onGameReopen(false) })
                }
                .padding(.leading, 12)
            }
            if let reply = thread.reply {
                HStack { Spacer(minLength: 40); BubbleReplyPill(text: reply) }
            }
            if let answer = thread.answer {
                orionLine(answer, lines: 7, dim: false)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            } else if thread.isThinking {
                BubbleThinkingLine().transition(.opacity)
            } else if let status = thread.statusLine {
                Text(status)
                    .font(.system(size: 12, weight: .medium)).italic()
                    .foregroundStyle(Color.white.opacity(0.62))
                    .shadow(color: .black.opacity(0.8), radius: 4)
                    .padding(.leading, 12)
                    .transition(.opacity)
            }
        }
        .frame(width: width, alignment: .leading)
        .animation(.spring(response: 0.4, dampingFraction: 0.86), value: thread)
        .accessibilityElement(children: .combine)
    }

    private func orionLine(_ text: String, lines: Int, dim: Bool) -> some View {
        Text(text)
            .font(.system(size: dim ? 12.5 : 13.5, weight: .medium))
            .foregroundStyle(Color.white.opacity(dim ? 0.7 : 0.92))
            .multilineTextAlignment(.leading)
            .lineLimit(lines)
            .padding(.leading, 12).padding(.trailing, 4).padding(.vertical, 6)
            .frame(width: width, alignment: .leading)
            .shadow(color: .black.opacity(0.8), radius: 4)
            .background(Color.black.opacity(0.35))
            .overlay(alignment: .leading) { Rectangle().fill(Color.white.opacity(0.28)).frame(width: 0.7) }
    }
}

/// His words, right-aligned in a hairline capsule with a faint rim glow.
private struct BubbleReplyPill: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 12.5, weight: .regular))
            .foregroundStyle(Color.white.opacity(0.86))
            .lineLimit(3)
            .multilineTextAlignment(.trailing)
            .padding(.horizontal, 11).padding(.vertical, 5)
            .background(Color.black.opacity(0.32), in: Capsule())
            .overlay(Capsule().stroke(Color.white.opacity(0.24), lineWidth: 0.7))
            .shadow(color: OrionTheme.accent.opacity(0.22), radius: 6)
    }
}

/// "ORION is thinking": a mono letter-spaced kicker with a light band sweeping across three soft bars.
private struct BubbleThinkingLine: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.orionFrozenMotion) private var frozen
    private var still: Bool { reduceMotion || frozen != nil }

    var body: some View {
        HStack(spacing: 9) {
            Text("THINKING")
                .font(.system(size: 9.5, weight: .semibold, design: .monospaced)).tracking(1.6)
                .foregroundStyle(Color.white.opacity(0.55))
            TimelineView(.animation(paused: still)) { context in
                let phase = still ? 0.5 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                VStack(alignment: .leading, spacing: 4) {
                    bar(width: 150, phase: phase)
                    bar(width: 96, phase: phase)
                }
            }
        }
        .padding(.leading, 12).padding(.vertical, 6)
        .accessibilityLabel("ORION is thinking")
    }

    private func bar(width: CGFloat, phase: Double) -> some View {
        Capsule()
            .fill(Color.white.opacity(0.12))
            .overlay(
                LinearGradient(colors: [.clear, Color.white.opacity(0.55), .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: 60)
                    .offset(x: CGFloat(phase) * (width + 60) - 60 - width / 2 + 30)
            )
            .clipShape(Capsule())
            .frame(width: width, height: 5)
    }
}
