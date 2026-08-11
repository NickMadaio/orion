//
//  The session, on the home page, small.
//
//  It was a tab, and a tab was the wrong shape for it. A focus session is not a
//  place you go — it is a thing that is either running or not, and when it is
//  running you want to see it without navigating to it. So it sits under the
//  composer on Home: one line when nothing is happening, a phase strip and two
//  controls when something is.
//
//  Everything that could be wrong still gets a sentence. A card is smaller than
//  a tab; it is not permission to hide the failure states, which are the whole
//  reason the tab was readable in the first place.
//

import SwiftUI
import SessionDomain
import SessionService

struct SessionCard: View {

    @ObservedObject var model: SessionTabModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header

            if model.snapshot.session != nil {
                strip
            }

            if let problem = model.unreadable {
                line(problem, tint: OrionTheme.orange)
            }
            if model.audioIsProblem {
                line(model.audioLine, tint: OrionTheme.orange)
            }
            if let sensors = model.sensorsUnavailable {
                line(sensors, tint: OrionTheme.orange)
            }

            controls
        }
        .padding(.vertical, 4)
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            Circle()
                .fill(model.snapshot.isRunning ? OrionTheme.accent : OrionTheme.textDim)
                .frame(width: 5, height: 5)

            Text(model.headline.uppercased())
                .font(OrionTheme.mono(8, .semibold))
                .tracking(2.2)
                .foregroundStyle(OrionTheme.textSoft)

            if let task = model.task {
                Text(task)
                    .font(OrionTheme.mono(8))
                    .foregroundStyle(OrionTheme.textDim)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if let remaining = model.remainingLine {
                Text(remaining)
                    .font(OrionTheme.mono(8))
                    .foregroundStyle(OrionTheme.textDim)
                    .lineLimit(1)
            }
        }
    }

    // MARK: The strip

    /// The same proportional segments the tab had, at a third of the height.
    /// It is the one thing worth seeing at a glance — where you are in the shape
    /// of the session — and it survives the shrink better than any number does.
    private var strip: some View {
        HStack(spacing: 3) {
            ForEach(model.segments) { segment in
                RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                    .fill(segment.tint.opacity(segment.isPast ? 0.85 : 0.16))
                    .frame(width: segment.width * 0.55, height: segment.isFocus ? 6 : 4)
                    .overlay(alignment: .leading) {
                        if segment.isCurrent {
                            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                                .fill(segment.tint)
                                .frame(width: max(1.5, segment.width * 0.55 * segment.progress))
                        }
                    }
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Controls

    private var controls: some View {
        HStack(spacing: 14) {
            ForEach(model.availableActions, id: \.title) { action in
                InlineAction(title: action.title, systemImage: action.icon) {
                    model.perform(action)
                }
            }

            if model.canRelease {
                InlineAction(title: "Stop enforcing", systemImage: "hand.raised",
                             tint: OrionTheme.textSoft) {
                    model.release()
                }
            }

            Spacer(minLength: 0)
        }
    }

    private func line(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.system(size: 10))
            .foregroundStyle(tint)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
