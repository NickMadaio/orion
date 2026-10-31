import SwiftUI
import MobileCore
import ThinkingOrbsKit

/// The pieces of the chat screen that carry motion, kept apart from its layout.

/// ORION is working: a small orb, a word that breathes, and the last few live steps — the newest bright, older
/// ones fading — so the wait reads as progress rather than as silence.
struct ChatThinkingIndicator: View {
    let liveThinking: String?
    var animated = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var steps: [String] {
        let lines = (liveThinking ?? "").split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return Array(lines.suffix(3))
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ThinkingOrb(state: .solving, size: .px20, theme: .dark)
            VStack(alignment: .leading, spacing: 6) {
                breathingLabel
                ForEach(Array(steps.enumerated()), id: \.element) { index, step in
                    Text(step)
                        .font(.system(size: 12))
                        .foregroundStyle(ViewTokens.soft.opacity(index == steps.count - 1 ? 1 : 0.55))
                        .transition(.opacity.combined(with: .offset(y: reduceMotion ? 0 : 6)))
                }
            }
            .animation(ViewMotion.resolved(ViewMotion.enter, reduceMotion: reduceMotion), value: steps)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("ORION is thinking")
    }

    /// "Thinking" with three dots that pulse in turn. Still under Reduce Motion and in renders.
    @ViewBuilder private var breathingLabel: some View {
        if animated && !reduceMotion {
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                label(phase: context.date.timeIntervalSinceReferenceDate)
            }
        } else {
            label(phase: nil)
        }
    }

    private func label(phase: Double?) -> some View {
        HStack(spacing: 3) {
            Text("THINKING")
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .tracking(2)
                .foregroundStyle(ViewTokens.violet.opacity(0.9))
            ForEach(0..<3, id: \.self) { dot in
                Circle()
                    .fill(ViewTokens.violet)
                    .frame(width: 3, height: 3)
                    .opacity(phase.map { 0.25 + 0.75 * max(0, sin(($0 * 3.2) - Double(dot) * 0.7)) } ?? (0.35 + Double(dot) * 0.25))
            }
        }
        .padding(.top, 4)
    }
}

/// A reply arriving: it rises a few points and is revealed top to bottom behind a soft edge, like text being set,
/// rather than appearing all at once. `frozen` holds it at a progress for renders.
struct ReplyReveal: ViewModifier {
    let active: Bool
    var frozen: Double?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var progress: Double = 0

    func body(content: Content) -> some View {
        let p = frozen ?? (active ? progress : 1)
        content
            .opacity(reduceMotion ? p : min(1, p * 1.6))
            .offset(y: reduceMotion ? 0 : (1 - p) * 8)
            .mask {
                if reduceMotion || p >= 1 {
                    Rectangle()
                } else {
                    GeometryReader { proxy in
                        LinearGradient(stops: [.init(color: .black, location: 0),
                                               .init(color: .black, location: max(0, p * 1.3 - 0.3)),
                                               .init(color: .clear, location: min(1, p * 1.3))],
                                       startPoint: .top, endPoint: .bottom)
                            .frame(height: proxy.size.height)
                    }
                }
            }
            .onAppear {
                guard active, frozen == nil else { return }
                withAnimation(ViewMotion.resolved(ViewMotion.reveal, reduceMotion: reduceMotion)) { progress = 1 }
            }
    }
}

/// A conversation in the sidebar: no plate. The selected one is marked by an accent hairline at its leading edge
/// that slides between rows, and by brighter type.
struct ChatSidebarRow: View {
    let summary: ChatSummary
    let selected: Bool
    let marker: Namespace.ID
    let onSelect: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 4) {
                    Text(summary.title)
                        .font(.system(size: 13, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected || hovering ? ViewTokens.text : ViewTokens.soft)
                        .lineLimit(1)
                    Text(summary.preview).font(.system(size: 12)).foregroundStyle(ViewTokens.dim).lineLimit(1)
                    Text(summary.updatedAt, style: .relative)
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundStyle(ViewTokens.dim.opacity(0.8))
                }
            .offset(x: hovering && !selected ? 2 : 0)
            .padding(.leading, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            // An overlay, so the marker is exactly as tall as the row it marks.
            .overlay(alignment: .leading) {
                if selected {
                    Capsule()
                        .fill(LinearGradient(colors: [ViewTokens.accent, ViewTokens.accent.opacity(0.1)], startPoint: .top, endPoint: .bottom))
                        .frame(width: 2)
                        .matchedGeometryEffect(id: "chat.selected", in: marker)
                }
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(ViewMotion.hover, value: hovering)
    }
}
