import Foundation

/// The part of a turn the pill cares about.
enum NotchTurnPhase: Equatable {
    case idle, listening, thinking, speaking

    init(_ phase: OrionPhase) {
        switch phase {
        case .idle, .error: self = .idle
        case .listening: self = .listening
        case .thinking: self = .thinking
        case .speaking: self = .speaking
        }
    }
    var isTurnInFlight: Bool { self == .thinking || self == .speaking }
}

enum NotchPillMode: Equatable {
    case hidden, thinking, speaking, preview
}

enum NotchPillEvent: Equatable {
    /// He clicked away from the panel, or pressed Esc while it was open.
    case dismissRequested(hasSpeech: Bool, phase: NotchTurnPhase)
    case phaseChanged(NotchTurnPhase)
    case answerChanged(String)
    case previewElapsed
    case hoverChanged(Bool)
    case clicked
    /// The little x, or a swipe up.
    case cancelRequested
}

enum NotchPillEffect: Equatable {
    case dismissPanel
    case dockPanel
    case reopenPanel(answer: String)
    case cancelTurn
    case retract
    case schedulePreviewEnd(seconds: Double)
    case cancelPreviewTimer
}

/// Pure state machine for the notch pill. No AppKit, no clocks: it returns effects and the controller runs them.
struct NotchPillState: Equatable {
    static let previewSeconds = 6.0
    static let hoverGraceSeconds = 1.5
    static let statusWordCount = 6

    var mode: NotchPillMode = .hidden
    var answer = ""
    var hovering = false
    /// The preview timer fired while he was hovering; retract soon after he leaves.
    var retractDeferred = false

    static func reduce(_ state: NotchPillState, _ event: NotchPillEvent) -> (NotchPillState, [NotchPillEffect]) {
        var next = state
        switch event {
        case let .dismissRequested(hasSpeech, phase):
            guard state.mode == .hidden else { return (state, []) }
            guard hasSpeech, phase.isTurnInFlight else { return (state, [.dismissPanel]) }
            next.mode = phase == .thinking ? .thinking : .speaking
            next.answer = ""
            next.hovering = false
            next.retractDeferred = false
            return (next, [.dockPanel])

        case let .answerChanged(text):
            next.answer = text
            return (next, [])

        case let .phaseChanged(phase):
            guard state.mode != .hidden else { return (state, []) }
            switch phase {
            case .thinking, .speaking:
                next.mode = phase == .thinking ? .thinking : .speaking
                next.retractDeferred = false
                return (next, state.mode == .preview ? [.cancelPreviewTimer] : [])
            case .listening:
                return (reset(next), [.cancelPreviewTimer, .retract])
            case .idle:
                guard state.mode != .preview else { return (state, []) }
                if state.mode == .thinking, state.answer.isEmpty {
                    // Ended with nothing to show: cancelled or failed.
                    return (reset(next), [.retract])
                }
                next.mode = .preview
                return (next, [.schedulePreviewEnd(seconds: previewSeconds)])
            }

        case .previewElapsed:
            guard state.mode == .preview else { return (state, []) }
            if state.hovering {
                next.retractDeferred = true
                return (next, [])
            }
            return (reset(next), [.retract])

        case let .hoverChanged(inside):
            guard state.mode != .hidden else { return (state, []) }
            next.hovering = inside
            if !inside, state.retractDeferred, state.mode == .preview {
                next.retractDeferred = false
                return (next, [.schedulePreviewEnd(seconds: hoverGraceSeconds)])
            }
            return (next, [])

        case .clicked:
            guard state.mode != .hidden else { return (state, []) }
            return (reset(next), [.cancelPreviewTimer, .reopenPanel(answer: state.answer)])

        case .cancelRequested:
            guard state.mode != .hidden else { return (state, []) }
            let live = state.mode == .thinking || state.mode == .speaking
            return (reset(next), live ? [.cancelPreviewTimer, .cancelTurn, .retract] : [.cancelPreviewTimer, .retract])
        }
    }

    private static func reset(_ state: NotchPillState) -> NotchPillState {
        var next = state
        next.mode = .hidden
        next.hovering = false
        next.retractDeferred = false
        return next
    }

    // MARK: Words

    var statusLine: String {
        switch mode {
        case .hidden: return ""
        case .thinking: return "Thinking…"
        case .speaking: return answer.isEmpty ? "Speaking…" : Self.firstWords(answer, count: Self.statusWordCount)
        case .preview: return "Done"
        }
    }

    /// The finished answer as the preview shows it.
    var previewText: String { answer.trimmingCharacters(in: .whitespacesAndNewlines) }

    var size: NotchPillSize {
        if hovering, mode != .hidden { return .expanded }
        return mode == .preview ? .preview : .compact
    }

    static func firstWords(_ text: String, count: Int) -> String {
        let words = text.split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return "" }
        let head = words.prefix(count).joined(separator: " ")
        return words.count > count ? head + "…" : head
    }
}
