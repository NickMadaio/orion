import AppKit
import SwiftUI

/*
 A pill that opens a clean list, in place of the system Picker (which drew a plain bordered menu beside Home's
 outline cards). One component serves the per-project model, the global worker and reviewer, and the escalation
 choice: each just supplies rows.
*/

struct ProjectPickItem: Identifiable, Equatable {
    let id: String
    let title: String
    var detail: String? = nil
    var badges: [String] = []
    /// Shown in orange with a "missing" tag: the choice exists in a record but not on this machine.
    var missing = false
}

/// Sizes the popover to its longest model name. Pure so a test can pin it.
enum ProjectPickLayout {
    static let minWidth: CGFloat = 320
    static let maxWidth: CGFloat = 560
    static let maxListHeight: CGFloat = 520
    /// Check column, gaps and side padding around a row's text.
    static let rowChrome: CGFloat = 14 + 12 + 9 + 9 + 6 + 14 + 8

    static func textWidth(_ text: String, size: CGFloat, weight: NSFont.Weight) -> CGFloat {
        ceil((text as NSString).size(withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: size, weight: weight)]).width)
    }

    /// Wide enough for the longest title (and its badges), never below `minWidth` or above `maxWidth`.
    static func listWidth(for items: [ProjectPickItem]) -> CGFloat {
        let widest = items.map { item -> CGFloat in
            let badges = (item.badges + (item.missing ? ["missing"] : []))
                .reduce(CGFloat(0)) { $0 + textWidth($1, size: 8.5, weight: .semibold) + 14 + 9 }
            return textWidth(item.title, size: 11.5, weight: .semibold) + badges
        }.max() ?? 0
        return min(maxWidth, max(minWidth, widest + rowChrome))
    }

    /// Tall enough to show every row up to a cap, after which the list scrolls.
    static func listHeight(for items: [ProjectPickItem]) -> CGFloat {
        min(maxListHeight, naturalHeight(items))
    }
    static func needsScroll(_ items: [ProjectPickItem]) -> Bool { naturalHeight(items) > maxListHeight }
    private static func naturalHeight(_ items: [ProjectPickItem]) -> CGFloat {
        items.reduce(CGFloat(0)) { $0 + ($1.detail == nil ? 27 : 42) }
    }
}

/// The list itself: a "Default" row first when there is one, then the items, the current one checked.
/// Separate from the pill so it can be rendered on its own (ImageRenderer cannot draw popovers).
struct ProjectPickList: View {
    var defaultRow: ProjectPickItem? = nil
    let items: [ProjectPickItem]
    /// `nil` is the default row.
    let selection: String?
    var emptyText = "Nothing to choose from"
    let onSelect: (String?) -> Void
    var onRefresh: (() -> Void)? = nil
    var refreshing = false
    @State private var hovered: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let defaultRow {
                row(defaultRow, checked: selection == nil, key: "")
                Rectangle().fill(LinearGradient(colors: [OrionTheme.line, .clear], startPoint: .leading, endPoint: .trailing))
                    .frame(height: 0.8).padding(.vertical, 5).padding(.horizontal, 12)
            }
            if items.isEmpty {
                Text(emptyText).font(.system(size: 12)).foregroundStyle(OrionTheme.textDim).padding(.horizontal, 14).padding(.vertical, 8)
            }
            // Scrolls only once the rows would pass the height cap; shorter lists lay out plainly.
            if ProjectPickLayout.needsScroll(items) {
                ScrollView(.vertical, showsIndicators: false) { rows }
                    .frame(height: ProjectPickLayout.listHeight(for: items))
            } else {
                rows
            }
            if let onRefresh {
                Rectangle().fill(OrionTheme.line).frame(height: 0.8).padding(.vertical, 5).padding(.horizontal, 12)
                Button(action: onRefresh) {
                    HStack(spacing: 7) {
                        Image(systemName: "arrow.clockwise").font(.system(size: 10, weight: .semibold))
                            .rotationEffect(.degrees(refreshing ? 360 : 0))
                            .animation(refreshing ? .linear(duration: 0.9).repeatForever(autoreverses: false) : .default, value: refreshing)
                        Text(refreshing ? "Looking…" : "Refresh models").font(.system(size: 11.5))
                    }
                    .foregroundStyle(OrionTheme.textSoft).padding(.horizontal, 14).padding(.vertical, 6)
                }.buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
        .frame(width: ProjectPickLayout.listWidth(for: items + (defaultRow.map { [$0] } ?? [])), alignment: .leading)
        .background(OrionTheme.ink)
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(items) { item in row(item, checked: selection == item.id, key: item.id) }
        }
    }

    private func row(_ item: ProjectPickItem, checked: Bool, key: String) -> some View {
        Button { onSelect(key.isEmpty ? nil : item.id) } label: {
            HStack(spacing: 9) {
                Image(systemName: "checkmark").font(.system(size: 9.5, weight: .bold))
                    .foregroundStyle(OrionTheme.accent).opacity(checked ? 1 : 0).frame(width: 12)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(OrionTheme.mono(11.5, checked ? .semibold : .medium)).lineLimit(1).truncationMode(.middle)
                        .help(item.title)
                        .foregroundStyle(item.missing ? OrionTheme.orange : OrionTheme.text)
                    if let detail = item.detail { Text(detail).font(.system(size: 10.5)).foregroundStyle(OrionTheme.textDim).lineLimit(1) }
                }
                Spacer(minLength: 6)
                if item.missing { badge("missing", hue: OrionTheme.orange) }
                ForEach(item.badges, id: \.self) { badge($0, hue: OrionTheme.accent) }
            }
            .padding(.horizontal, 14).padding(.vertical, 6)
            .background(Capsule().fill(Color.white.opacity(hovered == key ? 0.06 : 0)).padding(.horizontal, 5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 ? key : (hovered == key ? nil : hovered) }
        .animation(OrionMotion.hover, value: hovered)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }

    private func badge(_ text: String, hue: Color) -> some View {
        Text(text).font(OrionTheme.mono(8.5, .semibold)).tracking(0.6)
            .foregroundStyle(hue.opacity(0.9)).padding(.horizontal, 7).padding(.vertical, 2)
            .overlay(Capsule().strokeBorder(hue.opacity(0.45), lineWidth: 0.7))
    }
}

/// The closed pill: what is chosen now, with a chevron. Click opens the list in a popover.
struct ProjectPickerPill: View {
    let label: String
    var note: String? = nil
    var noteHue: Color = OrionTheme.textDim
    var missing = false
    var defaultRow: ProjectPickItem? = nil
    let items: [ProjectPickItem]
    let selection: String?
    var emptyText = "Nothing to choose from"
    var onRefresh: (() -> Void)? = nil
    var refreshing = false
    var minWidth: CGFloat = 0
    let onSelect: (String?) -> Void
    @State private var open = false
    @State private var hovering = false

    var body: some View {
        Button { open.toggle() } label: { PillFace(label: label, note: note, noteHue: noteHue, missing: missing, open: open, hovering: hovering, minWidth: minWidth) }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .animation(OrionMotion.hover, value: hovering)
            .animation(OrionMotion.select, value: open)
            .popover(isPresented: $open, arrowEdge: .bottom) {
                ProjectPickList(defaultRow: defaultRow, items: items, selection: selection, emptyText: emptyText,
                                onSelect: { choice in onSelect(choice); open = false },
                                onRefresh: onRefresh, refreshing: refreshing)
            }
    }
}

/// The pill's look, shared with the renders.
struct PillFace: View {
    let label: String
    var note: String? = nil
    var noteHue: Color = OrionTheme.textDim
    var missing = false
    var open = false
    var hovering = false
    var minWidth: CGFloat = 0

    var body: some View {
        let hue = missing ? OrionTheme.orange : OrionTheme.accent
        HStack(spacing: 8) {
            Text(label).font(OrionTheme.mono(11, .medium)).lineLimit(1).truncationMode(.middle)
                .foregroundStyle(OrionTheme.text).layoutPriority(2).help(label)
            if let note { Text(note).font(OrionTheme.mono(9)).foregroundStyle(noteHue).lineLimit(1).truncationMode(.middle).layoutPriority(1) }
            Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
                .foregroundStyle(OrionTheme.textSoft).rotationEffect(.degrees(open ? 180 : 0))
        }
        .frame(minWidth: minWidth, alignment: .leading)
        .padding(.horizontal, 14).padding(.vertical, 7)
        .background(Capsule().fill(hue.opacity(open ? 0.14 : hovering ? 0.08 : 0.04)))
        .overlay(Capsule().strokeBorder(hue.opacity(open ? 0.7 : hovering ? 0.5 : 0.3), lineWidth: 0.8))
        .shadow(color: hue.opacity(open ? 0.3 : 0), radius: 6)
        .contentShape(Capsule())
    }
}
