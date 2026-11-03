import MobileCore
import SwiftUI

/*
 Wave 14 (Health): the parts of the day, moved off the page and onto the thing they describe. Hovering a ring (or the
 glance line it belongs to) floats that part's read as bare type over a fading hairline: no plate, the way Knowledge's
 hover card reads.

 Wave 18: the text is `HealthReads`', not the phase-34 section sentences. Those restated the ring's own number as
 provenance ("The available WHOOP recovery reading is 78%." over "Whoop · high history confidence"), so on the
 installed build a hover that fired still looked like it did nothing. A pin no longer outranks hover either.
*/

/// The floating detail for one part. Pure presentation, so a render can draw it directly.
struct HealthPartDetail: View {
    let part: HealthPartRead
    var width: CGFloat = 300

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 10) {
                Kicker(text: part.title, hue: HealthSectionsView.hue(part.section))
                FadingRule().frame(width: 60)
            }
            Text(part.line)
                .font(OrionTheme.serif(16))
                .foregroundStyle(OrionTheme.text)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            if let note = part.note {
                Text(note)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.62))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(width: width, alignment: .leading)
        // The fading hairline down the left edge in place of a plate.
        .padding(.leading, 14)
        .overlay(alignment: .leading) {
            LinearGradient(colors: [.clear, HealthSectionsView.hue(part.section).opacity(0.7), .clear],
                           startPoint: .top, endPoint: .bottom)
                .frame(width: 1)
        }
        .shadow(color: OrionTheme.ink.opacity(0.9), radius: 14)
    }
}

/// Which part of the day the pointer is on, for one hover stage. Entering is immediate; leaving only clears after a
/// short grace, and entering anything else inside it cancels the clear, so moving between neighbouring rings never
/// flashes the stage empty. `exit` only clears if the part it names is still the current one.
@MainActor
final class HealthHoverController: ObservableObject {
    @Published private(set) var hovered: HealthSection?
    /// A click keeps a part open after the pointer leaves.
    @Published private(set) var pinned: HealthSection?
    private var pendingClear: Task<Void, Never>?
    let grace: Duration

    init(grace: Duration = .milliseconds(260)) { self.grace = grace }

    /// What the stage should show: the part under the pointer, else the clicked one. Wave 17 had this the other way
    /// round, so one click made hovering every other ring do nothing until the same ring was clicked again.
    var current: HealthSection? { hovered ?? pinned }

    func enter(_ section: HealthSection) {
        pendingClear?.cancel()
        pendingClear = nil
        // Continuous hover reports every mouse move; only a real change may publish.
        if hovered != section { hovered = section }
    }

    /// Click: pin this part, or unpin it if it is the pinned one.
    func toggle(_ section: HealthSection) {
        pinned = pinned == section ? nil : section
    }

    func exit(_ section: HealthSection) {
        guard hovered == section else { return }
        pendingClear?.cancel()
        pendingClear = Task { [weak self, grace] in
            try? await Task.sleep(for: grace)
            guard !Task.isCancelled else { return }
            self?.hovered = nil
        }
    }
}

/// Where the hover text sits: one fixed block under what it describes, never an overlay, so it cannot cover a ring or
/// the right column and cannot run past the window edge. Its width is the column it lives in, capped for readability.
enum HealthStageLayout {
    static let maxWidth: CGFloat = 560
    static let height: CGFloat = 104

    static func width(column: CGFloat) -> CGFloat {
        max(0, min(maxWidth, column.isFinite ? column : 0))
    }

    /// The main column's width for a window: window minus page padding, the 300pt rail and the gap between them.
    static func mainColumn(window: CGFloat) -> CGFloat { max(0, window - 92 - 300 - 64) }
}

/// The fixed hover area: cross-fades to the hovered part's detail, and back to `rest` (or nothing) when the pointer
/// leaves. `forced` pins a part, for renders.
struct HealthHoverStage: View {
    @ObservedObject var controller: HealthHoverController
    let reads: HealthReads.Inputs
    var rest: String? = nil
    var forced: HealthSection? = nil
    var column: CGFloat = HealthStageLayout.maxWidth
    var height: CGFloat = HealthStageLayout.height

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let active = forced ?? controller.current
        let width = HealthStageLayout.width(column: column)
        ZStack(alignment: .topLeading) {
            if let active, let part = HealthReads.part(active, reads) {
                HealthPartDetail(part: part, width: width - 14)
                    .id(active)
                    .transition(.opacity)
            } else if let rest {
                HealthTodayText(line: rest)
                    .id("rest")
                    .transition(.opacity)
            }
        }
        .frame(width: width, height: height, alignment: .topLeading)
        .animation(reduceMotion ? .easeInOut(duration: 0.12) : .easeInOut(duration: 0.28), value: active)
    }
}

extension View {
    /// Reports the pointer on this view to the stage that shows `section`, and lets a click pin it.
    ///
    /// `onContinuousHover`, on the whole frame (`contentShape`), so a ring's empty interior counts.
    func healthHover(_ section: HealthSection?, _ controller: HealthHoverController) -> some View {
        contentShape(Rectangle())
            .onContinuousHover { phase in
                guard let section else { return }
                switch phase {
                case .active: controller.enter(section)
                case .ended: controller.exit(section)
                }
            }
            .onTapGesture {
                guard let section else { return }
                controller.toggle(section)
            }
    }
}
