//
//  The session, on screen.
//
//  Gate 7's requirement is that a session can be run and RECOVERED without
//  voice and without scripts. So everything the command socket can do has a
//  control here, and — more importantly — everything that can be wrong has a
//  sentence here. A tab that shows a tidy phase strip while the clip folder is
//  empty and a sensor is dark is the polished version of this project's worst
//  bug.
//
//  No nested ScrollView. This tab sits inside the dashboard's own, and a second
//  one on the same axis is proposed an unbounded height, grows to its content,
//  and silently stops scrolling. `Tests/run-layout-test.sh` guards that rule and
//  this view is in it.
//

import SwiftUI
import SessionDomain
import SessionService

struct SessionTab: View {

    @ObservedObject var model: SessionTabModel

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            header

            if let problem = model.unreadable {
                trouble(problem)
            }

            phaseStrip

            controls

            FadingRule()

            audioStatus
            enforcementStatus
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(model.headline)
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(OrionTheme.text)

            if let task = model.task {
                Text(task)
                    .font(.system(size: 15))
                    .foregroundStyle(OrionTheme.textSoft)
            }

            if model.approximate {
                // Never present an estimate as a measurement.
                Text("Approximate — the clock moved during this session.")
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
    }

    private func trouble(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 13))
            .foregroundStyle(OrionTheme.orange)
            .padding(.vertical, 8)
    }

    // MARK: The strip

    /// One segment per phase, in order, filled by how much has been served.
    ///
    /// Deliberately not a countdown ring. The thing worth seeing at a glance is
    /// where you are in the SHAPE of the session — which block, how many left —
    /// and a row of segments says that without needing to be read.
    private var phaseStrip: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionRule(title: "session", trailing: model.stripTrailing)

            HStack(spacing: 5) {
                ForEach(model.segments) { segment in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(segment.tint.opacity(segment.isPast ? 0.85 : 0.16))
                        .frame(width: segment.width, height: segment.isFocus ? 12 : 7)
                        .overlay(alignment: .leading) {
                            if segment.isCurrent {
                                RoundedRectangle(cornerRadius: 2, style: .continuous)
                                    .fill(segment.tint)
                                    .frame(width: max(2, segment.width * segment.progress))
                            }
                        }
                }
            }
            .frame(height: 14, alignment: .center)

            if let remaining = model.remainingLine {
                Text(remaining)
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textSoft)
            }
        }
    }

    // MARK: Controls

    private var controls: some View {
        HStack(spacing: 18) {
            ForEach(model.availableActions, id: \.title) { action in
                InlineAction(title: action.title, systemImage: action.icon) {
                    model.perform(action)
                }
            }
        }
    }

    // MARK: Status

    private var audioStatus: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionRule(title: "audio")
            Text(model.audioLine)
                .font(.system(size: 13))
                .foregroundStyle(model.audioIsProblem ? OrionTheme.orange : OrionTheme.textSoft)
        }
    }

    private var enforcementStatus: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionRule(title: "enforcement")

            Text(model.enforcementLine)
                .font(.system(size: 13))
                .foregroundStyle(OrionTheme.textSoft)

            // The honest claim, always visible. It is the one thing about this
            // feature somebody could reasonably be misled by.
            Text("Orion sees which app is frontmost and whether you have been "
                 + "inactive. It cannot see what you are doing inside an app you allowed.")
                .font(.system(size: 11))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)

            if let unavailable = model.sensorsUnavailable {
                Text(unavailable)
                    .font(.system(size: 11))
                    .foregroundStyle(OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if model.canRelease {
                InlineAction(title: "Stop enforcing", systemImage: "hand.raised") {
                    model.release()
                }
            }
        }
    }
}

// MARK: - Segments

struct PhaseSegment: Identifiable {
    let id: Int
    let isFocus: Bool
    let isPast: Bool
    let isCurrent: Bool
    let progress: Double
    let width: CGFloat
    let tint: Color
}
