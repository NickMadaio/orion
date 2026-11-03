import CoreGraphics

/*
 The typed summon's layout state machine and geometry, as plain values so both are tested without a window.

 Nick: "when activating him separately and I only want to message without talking, it pulls up the text box ...
 and the hologram above it. Once he actually responds, the hologram moves to the left and the answer text shows up
 to the right. This is all above the text box I type in."

 Stages: dismissed -> idle (hologram centred above the composer) -> thinking -> answered (hologram left, text right)
 -> thinking again on a follow-up (the old answer stays, dimmed) -> answered -> dismissed.
*/

struct TypedSummonFlow: Equatable {
    enum Stage: Equatable { case dismissed, idle, thinking, answered }

    private(set) var stage: Stage = .dismissed
    /// The latest answer. Kept through a follow-up, so the layout does not jump back while he waits.
    private(set) var answer: String?

    var isVisible: Bool { stage != .dismissed }
    /// The hologram sits left of the text from the first answer until the overlay closes.
    var hologramLeft: Bool { answer != nil }
    /// A follow-up is in flight: the previous answer stays but steps back.
    var answerDimmed: Bool { stage == .thinking && answer != nil }

    mutating func present() {
        stage = .idle
        answer = nil
    }

    mutating func sent() {
        guard isVisible else { return }
        stage = .thinking
    }

    mutating func answered(_ text: String) {
        guard stage == .thinking else { return }   // a late reply after dismissing must not reopen anything
        stage = .answered
        answer = text
    }

    /// The turn ended with no answer (cancelled): back to where it was.
    mutating func abandoned() {
        guard stage == .thinking else { return }
        stage = answer == nil ? .idle : .answered
    }

    mutating func dismiss() {
        stage = .dismissed
        answer = nil
    }
}

/// Where everything sits, in a top-left-origin space the size of the screen.
struct TypedSummonGeometry: Equatable {
    let composer: CGRect
    let hologram: CGRect
    /// Empty (zero height) until there is an answer.
    let answer: CGRect

    static let composerHeight: CGFloat = 64
    static let gap: CGFloat = 18
    static let idleDiameter: CGFloat = 280
    static let answeredDiameter: CGFloat = 176
    static let answerMaxHeight: CGFloat = 320
    static let columnGap: CGFloat = 30

    /// `bottomInset` is the distance from the screen bottom to the composer's bottom edge (Dock plus breathing room).
    static func layout(screen: CGSize, bottomInset: CGFloat, hologramLeft: Bool, answerHeight: CGFloat,
                       composerHeight: CGFloat = composerHeight) -> TypedSummonGeometry {
        let width = min(860, max(320, screen.width - 96))
        let composer = CGRect(x: (screen.width - width) / 2, y: screen.height - bottomInset - composerHeight,
                              width: width, height: composerHeight)
        let bottom = composer.minY - gap
        let room = max(80, bottom - 48)

        guard hologramLeft else {
            let side = min(idleDiameter, room)
            let holo = CGRect(x: (screen.width - side) / 2, y: bottom - side, width: side, height: side)
            return TypedSummonGeometry(composer: composer, hologram: holo, answer: CGRect(x: composer.minX, y: bottom, width: composer.width, height: 0))
        }

        let side = min(answeredDiameter, room)
        let text = min(max(answerHeight, 24), answerMaxHeight, room)
        let row = max(side, text)
        let groupWidth = min(composer.width, screen.width - 96)
        let left = (screen.width - groupWidth) / 2
        let top = bottom - row
        let holo = CGRect(x: left, y: top + (row - side) / 2, width: side, height: side)
        let textX = holo.maxX + columnGap
        let answer = CGRect(x: textX, y: top + (row - text) / 2, width: max(120, left + groupWidth - textX), height: text)
        return TypedSummonGeometry(composer: composer, hologram: holo, answer: answer)
    }
}
