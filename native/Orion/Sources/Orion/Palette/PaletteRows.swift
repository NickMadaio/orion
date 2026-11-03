//
//  One list row: a round icon bubble, the title and a quiet second line, with the selected row marked by a soft glow
//  pill that slides between rows on a spring (a matched geometry, so Reduce Motion turns it into a fade).
//

import AppKit
import PaletteKit
import SwiftUI

struct PaletteKicker: View {
    let section: PaletteSection

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(section.hue).frame(width: 4, height: 4).shadow(color: section.hue.opacity(0.9), radius: 3)
            Text(section.kicker).font(OrionTheme.mono(8.5, .semibold)).tracking(2.0).foregroundStyle(section.hue.opacity(0.9))
        }
        .padding(.leading, 14).padding(.top, 8).padding(.bottom, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PaletteRow: View {
    let item: PaletteItem
    let selected: Bool
    /// ⌘1…⌘9 label for the first nine rows.
    let quickPick: Int?
    let glow: Namespace.ID

    var body: some View {
        HStack(spacing: 12) {
            bubble
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.system(size: 14, weight: selected ? .medium : .regular))
                    .foregroundStyle(selected ? OrionTheme.text : OrionTheme.text.opacity(0.82))
                    .lineLimit(1)
                if !item.subtitle.isEmpty {
                    Text(item.subtitle).font(.system(size: 11)).foregroundStyle(OrionTheme.textDim).lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            if !item.badge.isEmpty {
                Text(item.badge.uppercased()).font(OrionTheme.mono(7.5, .semibold)).tracking(1.4).foregroundStyle(item.hue.opacity(0.85))
            }
            trailing
        }
        .padding(.horizontal, 10)
        .frame(height: 40)
        .background { if selected { glowPill } }
        .contentShape(Rectangle())
    }

    private var bubble: some View {
        glyph
            .frame(width: 28, height: 28)
            .background(Circle().fill(item.hue.opacity(selected ? 0.16 : 0.07)))
            .overlay(Circle().strokeBorder(item.hue.opacity(selected ? 0.75 : 0.32), lineWidth: 0.9))
    }

    /// An app shows its own icon; everything else a line glyph in its hue.
    @ViewBuilder private var glyph: some View {
        if let path = item.appPath {
            Image(nsImage: NSWorkspace.shared.icon(forFile: path)).resizable().frame(width: 18, height: 18)
        } else {
            Image(systemName: item.symbol)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(selected ? item.hue : item.hue.opacity(0.75))
        }
    }

    @ViewBuilder private var trailing: some View {
        if selected {
            Text("↩").font(.system(size: 12, weight: .medium)).foregroundStyle(OrionTheme.textSoft)
        } else if let quickPick {
            Text("⌘\(quickPick)").font(OrionTheme.mono(9)).foregroundStyle(OrionTheme.textDim)
        }
    }

    private var glowPill: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(LinearGradient(colors: [item.hue.opacity(0.13), item.hue.opacity(0.05)], startPoint: .leading, endPoint: .trailing))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(item.hue.opacity(0.42), lineWidth: 0.9))
            .shadow(color: item.hue.opacity(0.22), radius: 9)
            .matchedGeometryEffect(id: "selection", in: glow)
    }
}

/// The ⌘K menu for the selected row.
struct PaletteSubMenu: View {
    let actions: [PaletteSubAction]
    let selected: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("ACTIONS").font(OrionTheme.mono(8, .semibold)).tracking(1.8).foregroundStyle(OrionTheme.textDim)
                .padding(.horizontal, 10).padding(.top, 4).padding(.bottom, 2)
            ForEach(Array(actions.enumerated()), id: \.offset) { index, action in
                HStack(spacing: 10) {
                    Image(systemName: action.symbol).font(.system(size: 11)).frame(width: 16)
                    Text(action.title).font(.system(size: 12.5))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(index == selected ? OrionTheme.text : OrionTheme.textSoft)
                .padding(.horizontal, 10).frame(height: 30)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(OrionTheme.accent.opacity(index == selected ? 0.14 : 0))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(OrionTheme.accent.opacity(index == selected ? 0.5 : 0), lineWidth: 0.8)))
            }
        }
        .padding(8)
        .frame(width: 230)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(OrionTheme.ink.opacity(0.94)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.white.opacity(0.14), lineWidth: 0.8))
        .shadow(color: .black.opacity(0.5), radius: 14, y: 6)
    }
}
