import MobileCore
import OrionViews
import SwiftUI

/*
 Wave 14 (Plan tab): the day's blocks as a flow. One vertical line runs down the left; each block hangs off it on
 a round node coloured by what kind of time it is (class, movement, task, free, travel), and the block itself is
 a soft bubble beside the node. The rows spring in one after another. The block happening now glows, and its node
 breathes. The task actions (done, more time, pin) wait until the pointer is on the row, so the column reads as a
 day and not as a toolbar; VoiceOver gets them as row actions all the time.
*/
struct PlanTimeline: View {
    let blocks: [TodayPlanBlock]
    let now: Date
    let isProposal: Bool
    let time: (Date) -> String
    var finish: (String) -> Void
    var moreTime: (String) -> Void
    var togglePin: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
                PlanTimelineRow(block: block, now: now, isProposal: isProposal, time: time,
                                isFirst: index == 0, isLast: index == blocks.count - 1,
                                nextHue: index + 1 < blocks.count ? Self.hue(blocks[index + 1]) : nil,
                                finish: finish, moreTime: moreTime, togglePin: togglePin)
                    .orionEntrance(order: index, distance: 10)
            }
        }
    }

    static func hue(_ block: TodayPlanBlock) -> Color { PlanBlockFamily.of(kind: block.kind, title: block.title).hue }
}

private struct PlanTimelineRow: View {
    let block: TodayPlanBlock
    let now: Date
    let isProposal: Bool
    let time: (Date) -> String
    let isFirst: Bool
    let isLast: Bool
    let nextHue: Color?
    var finish: (String) -> Void
    var moreTime: (String) -> Void
    var togglePin: (String) -> Void

    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hue: Color { PlanTimeline.hue(block) }
    private var live: Bool { block.contains(now) }
    private var past: Bool { block.end <= now }
    private var actionable: String? {
        guard block.kind == .task, let id = block.sourceID, !isProposal, !past else { return nil }
        return id
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(time(block.start))
                .font(OrionTheme.mono(10))
                .foregroundStyle(live ? hue : OrionTheme.textDim)
                .frame(width: 38, alignment: .trailing)
            node
            // The bubble hugs its own words, so the column reads as a flow of different lengths, not a table.
            bubble.frame(minWidth: 210, alignment: .leading).fixedSize(horizontal: true, vertical: false)
            Spacer(minLength: 0)
        }
        // Every column takes the row's natural height, so the node's flow line runs edge to edge.
        .fixedSize(horizontal: false, vertical: true)
        .opacity(past ? 0.42 : 1)
        .onHover { hovering = $0 }
        .animation(OrionMotion.resolved(OrionMotion.select, reduceMotion: reduceMotion), value: hovering)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(live ? .isSelected : [])
        .modifier(RowActions(id: actionable, pinned: block.pinned, finish: finish, moreTime: moreTime, togglePin: togglePin))
    }

    /// The flow line through this row, and the node on it. The line takes the next block's hue on its lower
    /// half, so the colour flows from one kind of time into the next instead of stepping.
    private var node: some View {
        ZStack {
            VStack(spacing: 0) {
                Rectangle().fill(isFirst ? Color.clear : hue.opacity(0.28)).frame(width: 1.2)
                Rectangle()
                    .fill(isLast ? AnyShapeStyle(Color.clear)
                                 : AnyShapeStyle(LinearGradient(colors: [hue.opacity(0.28), (nextHue ?? hue).opacity(0.28)],
                                                                startPoint: .top, endPoint: .bottom)))
                    .frame(width: 1.2)
            }
            if live {
                PlanPulseDot(hue: hue, size: 9)
            } else {
                Circle()
                    .fill(past ? hue.opacity(0.55) : OrionTheme.ink)
                    .frame(width: 9, height: 9)
                    .overlay(Circle().strokeBorder(hue.opacity(0.85), lineWidth: 1.2))
            }
        }
        .frame(width: 24)
        .frame(maxHeight: .infinity)
    }

    private var bubble: some View {
        let shape = RoundedRectangle(cornerRadius: 17, style: .continuous)
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(block.title)
                    .font(.system(size: 12.5, weight: live ? .semibold : .medium))
                    .foregroundStyle(OrionTheme.text)
                    .lineLimit(1)
                Text(meta)
                    .font(.system(size: 10))
                    .foregroundStyle(OrionTheme.textDim)
                    .lineLimit(1)
            }
            Spacer(minLength: 14)
            if let id = actionable, hovering {
                HStack(spacing: 6) {
                    PlanRoundAction(symbol: "checkmark", help: "Mark done in this plan", hue: hue) { finish(id) }
                    PlanRoundAction(symbol: "plus", help: "15 more minutes", hue: hue) { moreTime(id) }
                    PlanRoundAction(symbol: block.pinned ? "pin.fill" : "pin",
                                    help: block.pinned ? "Unpin" : "Keep this slot", hue: hue) { togglePin(id) }
                }
                .transition(.opacity.combined(with: .scale(scale: reduceMotion ? 1 : 0.85, anchor: .trailing)))
            } else if block.pinned {
                Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(hue.opacity(0.7))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(shape.fill(hue.opacity(live ? 0.11 : (hovering ? 0.07 : 0.035))))
        .overlay(shape.strokeBorder(hue.opacity(live ? 0.62 : (hovering ? 0.34 : 0.16)), lineWidth: live ? 1 : 0.8))
        .shadow(color: hue.opacity(live ? 0.32 : 0), radius: live ? 12 : 0)
        .scaleEffect(hovering && !reduceMotion ? 1.008 : 1, anchor: .leading)
        .padding(.vertical, 4)
    }

    private var meta: String {
        let kind: String
        switch block.kind {
        case .free: kind = " · yours"
        case .commitment: kind = " · calendar"
        default: kind = ""
        }
        return "\(block.minutes) min\(kind)\(block.pinned ? " · pinned" : "")"
    }
}

/// A small round outline button for a row action.
struct PlanRoundAction: View {
    let symbol: String
    let help: String
    var hue: Color = OrionTheme.accent
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(hovering ? OrionTheme.text : hue)
                .frame(width: 24, height: 24)
                .background(Circle().fill(hue.opacity(hovering ? 0.22 : 0.08)))
                .overlay(Circle().strokeBorder(hue.opacity(hovering ? 0.8 : 0.4), lineWidth: 0.8))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(help)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
    }
}

/// The task actions as VoiceOver row actions, so hiding them until hover hides nothing from a screen reader.
private struct RowActions: ViewModifier {
    let id: String?
    let pinned: Bool
    var finish: (String) -> Void
    var moreTime: (String) -> Void
    var togglePin: (String) -> Void

    func body(content: Content) -> some View {
        if let id {
            content
                .accessibilityAction(named: "Mark done in this plan") { finish(id) }
                .accessibilityAction(named: "15 more minutes") { moreTime(id) }
                .accessibilityAction(named: pinned ? "Unpin" : "Keep this slot") { togglePin(id) }
        } else {
            content
        }
    }
}
