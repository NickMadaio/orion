import AppKit
import OrionViews
import SessionDomain
import SwiftUI

/*
 Wave 14 (Plan tab): the soft round pieces the Plan page is built from, in its own file so the shared Design/ kit
 stays untouched.
   · PlanPulseDot      a small dot with a slow breathing halo: "this is the live thing";
   · PlanNoticeCapsule the access warnings as one quiet capsule that opens to the full sentences.
 Both hold still under Reduce Motion and in renders (orionFrozenMotion).
*/

/// A dot with a halo that breathes out and fades, about once every two seconds.
struct PlanPulseDot: View {
    var hue: Color = OrionTheme.accent
    var size: CGFloat = 7

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.orionFrozenMotion) private var frozen
    @State private var breathing = false

    private var still: Bool { reduceMotion || frozen != nil }

    var body: some View {
        ZStack {
            Circle()
                .fill(hue.opacity(0.35))
                .frame(width: size, height: size)
                .scaleEffect(still ? 1.8 : (breathing ? 2.6 : 1))
                .opacity(still ? 0.45 : (breathing ? 0 : 0.7))
            Circle()
                .fill(hue)
                .frame(width: size, height: size)
                .shadow(color: hue.opacity(0.8), radius: 4)
        }
        .frame(width: size * 2.6, height: size * 2.6)
        .onAppear {
            guard !still else { return }
            withAnimation(.easeOut(duration: 1.9).repeatForever(autoreverses: false)) { breathing = true }
        }
        .accessibilityHidden(true)
    }
}

/// Calendar / Reminders access, said once and quietly: an amber dot and a short line in a hairline capsule.
/// Clicking it opens the full sentences underneath; the settings link sits at the end of the capsule.
struct PlanNoticeCapsule: View {
    let notice: PlanNotice
    var settingsURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"

    @State private var open = false
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 9) {
                Button { OrionMotion.perform(OrionMotion.select, reduceMotion: reduceMotion) { open.toggle() } } label: {
                    HStack(spacing: 8) {
                        Circle().fill(OrionTheme.orange).frame(width: 5, height: 5)
                            .shadow(color: OrionTheme.orange.opacity(0.7), radius: 3)
                        Text(notice.title)
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(OrionTheme.textSoft)
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(OrionTheme.textDim)
                            .rotationEffect(.degrees(open ? 180 : 0))
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(notice.title)
                .accessibilityHint(open ? "Hide the details" : "Show the details")
                if notice.needsSettings {
                    Text("·").foregroundStyle(OrionTheme.textDim)
                    Button {
                        if let url = URL(string: settingsURL) { NSWorkspace.shared.open(url) }
                    } label: {
                        Text("Open Settings").font(.system(size: 11.5, weight: .medium)).foregroundStyle(OrionTheme.accent)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 6)
            .background(Capsule().fill(OrionTheme.orange.opacity(hovering ? 0.07 : 0.04)))
            .overlay(Capsule().strokeBorder(OrionTheme.orange.opacity(hovering ? 0.42 : 0.26), lineWidth: 0.8))
            .onHover { hovering = $0 }
            .animation(OrionMotion.hover, value: hovering)

            if open {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(notice.details, id: \.self) { line in
                        Text(line)
                            .font(.system(size: 11))
                            .foregroundStyle(OrionTheme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.leading, 14)
                .transition(OrionMotion.rise(reduceMotion: reduceMotion, distance: -4))
            }
        }
    }
}

/// Month / Week / Day as one hairline capsule with a soft glowing pill that slides to the chosen one.
struct CalendarGranularityPills: View {
    let selected: CalendarGranularity
    let choose: (CalendarGranularity) -> Void

    @Namespace private var pill
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(CalendarGranularity.allCases, id: \.self) { option in
                Button {
                    OrionMotion.perform(OrionMotion.select, reduceMotion: reduceMotion) { choose(option) }
                } label: {
                    Text(option.title)
                        .font(OrionTheme.mono(10, .semibold))
                        .tracking(1)
                        .foregroundStyle(option == selected ? OrionTheme.text : OrionTheme.textDim)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 5)
                        .background {
                            if option == selected {
                                Capsule()
                                    .fill(OrionTheme.accent.opacity(0.14))
                                    .overlay(Capsule().strokeBorder(OrionTheme.accent.opacity(0.6), lineWidth: 0.8))
                                    .shadow(color: OrionTheme.accent.opacity(0.35), radius: 6)
                                    .matchedGeometryEffect(id: "pill", in: pill)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(option == selected ? .isSelected : [])
            }
        }
        .padding(3)
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.10), lineWidth: 0.8))
    }
}

/// A mask that lets a scrolling column fade out at its top and bottom edges instead of cutting off hard.
struct ColumnFade: View {
    var top: CGFloat = 10
    var bottom: CGFloat = 30

    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: top)
            Color.black
            LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: bottom)
        }
    }
}

/// One column's own vertical scroll, fading at its edges. In a snapshot it is a plain top-aligned stack, because
/// ImageRenderer draws a ScrollView as nothing.
struct ColumnScroll<Content: View>: View {
    var snapshot = false
    @ViewBuilder var content: Content

    var body: some View {
        if snapshot {
            // Color.clear takes whatever height is left, so whatever sits under the column keeps its room.
            Color.clear
                .overlay(alignment: .topLeading) { VStack(alignment: .leading, spacing: 0) { content } }
                .clipped()
        } else {
            ScrollView(.vertical) { content }
                .scrollIndicators(.automatic)
                .mask(ColumnFade())
        }
    }
}
