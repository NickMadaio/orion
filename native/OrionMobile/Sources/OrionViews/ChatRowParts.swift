import SwiftUI
import MobileCore
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Quiet furniture around chat rows (wave 12, 2026-11-02): a time divider after a long silence, and the Copy and
/// time controls that appear only while a row is hovered.

enum ChatTime {
    /// A divider goes between two messages more than this far apart.
    static let dividerGap: TimeInterval = 30 * 60

    /// True when `message` follows `previous` after a gap long enough to mark.
    static func needsDivider(after previous: ChatMessage?, _ message: ChatMessage) -> Bool {
        guard let previous else { return false }
        return message.at.timeIntervalSince(previous.at) > dividerGap
    }

    /// "Today 16:30", "Yesterday 16:30", or the date.
    static func label(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDate(date, inSameDayAs: now) { return "Today \(time)" }
        if calendar.isDate(date, inSameDayAs: calendar.date(byAdding: .day, value: -1, to: now) ?? now) { return "Yesterday \(time)" }
        return date.formatted(.dateTime.month(.abbreviated).day()) + " " + time
    }

    static func copy(_ text: String) {
        #if canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #elseif canImport(UIKit)
        UIPasteboard.general.string = text
        #endif
    }
}

/// Two short hairlines that fade at their outer ends, with the time between them in small mono.
struct ChatTimeDivider: View {
    let date: Date
    var now = Date()

    var body: some View {
        HStack(spacing: 12) {
            line(fadingToward: .leading)
            Text(ChatTime.label(date, now: now).uppercased())
                .font(.system(size: 10.5, weight: .medium, design: .monospaced)).tracking(1.2)
                .foregroundStyle(ViewTokens.dim)
                .fixedSize()
            line(fadingToward: .trailing)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ChatTime.label(date, now: now))
    }

    private func line(fadingToward edge: HorizontalEdge) -> some View {
        Rectangle()
            .fill(LinearGradient(colors: edge == .leading ? [.clear, Color.white.opacity(0.09)] : [Color.white.opacity(0.09), .clear],
                                 startPoint: .leading, endPoint: .trailing))
            .frame(width: 70, height: 0.5)
    }
}

/// The 20 pt strip under a message. It is always laid out, so showing the controls never shifts the thread.
struct ChatRowControls: View {
    let message: ChatMessage
    let visible: Bool
    var trailing = false

    var body: some View {
        HStack(spacing: 12) {
            if trailing { Spacer(minLength: 0) }
            Text(message.at, style: .time)
                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
            Button { ChatTime.copy(message.text) } label: {
                Label("Copy", systemImage: "doc.on.doc").labelStyle(.titleAndIcon)
                    .font(.system(size: 10.5, weight: .medium))
            }
            .buttonStyle(.plain)
            if !trailing { Spacer(minLength: 0) }
        }
        .foregroundStyle(ViewTokens.dim)
        .frame(height: 20)
        .opacity(visible ? 1 : 0)
        .allowsHitTesting(visible)
        .animation(ViewMotion.hover, value: visible)
    }
}
