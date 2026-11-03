//
//  The palette's observable state (w18): the typed text, the ranked rows with their keyboard state, what the glance
//  strip says and whatever the palette is showing inline (ORION's answer, a plan waiting for Enter, a result).
//  No panel, no scripts, no AppKit windows: the controller owns those, and renders build one of these directly.
//

import Foundation
import PaletteKit

/// What the preview pane shows when a row has been run inline.
enum PaletteOutput: Equatable {
    case thinking(question: String)
    case answer(question: String, text: String)
    case planning
    /// `orion-apps quit-unused --dry-run`: what it would close, waiting for Enter.
    case plan(say: String, closes: [String])
    case working(String)
    case result(String)

    var isPlan: Bool { if case .plan = self { return true } else { return false } }
}

/// What the strip above the field says, from `scripts/orion-quick`.
struct QuickGlance: Decodable, Equatable {
    struct Now: Decodable, Equatable { let title: String; let until: String }
    struct Next: Decodable, Equatable { let title: String; let at: String; let inMinutes: Int }
    let now: Now?
    let next: Next?
    let focusToday: String?
    let phone: String?
}

/// The live session, as one line of facts.
struct QuickSession: Equatable {
    let running: Bool
    let paused: Bool
    let onBreak: Bool
    let remaining: TimeInterval
    /// When the phase ends, for a clock that counts down; nil while paused.
    let endsAt: Date?
    let label: String

    func remaining(at date: Date) -> TimeInterval { endsAt.map { $0.timeIntervalSince(date) } ?? remaining }
}

final class PaletteModel: ObservableObject {
    @Published var query = "" {
        didSet {
            guard query != oldValue else { return }
            output = nil
            recompute(keepSelection: false)
        }
    }
    @Published private(set) var nav = PaletteNav(rows: [])
    @Published var output: PaletteOutput?
    @Published var glance: QuickGlance?
    @Published var session: QuickSession?
    @Published var hotKeyProblem: String?
    /// Bumped on every show, so the entrance replays.
    @Published private(set) var showCount = 0

    var context: PaletteContext { didSet { recompute(keepSelection: true) } }
    var frecency: Frecency { didSet { recompute(keepSelection: true) } }
    var now: () -> Date

    init(context: PaletteContext = PaletteModel.emptyContext, frecency: Frecency = Frecency(), now: @escaping () -> Date = Date.init) {
        self.context = context; self.frecency = frecency; self.now = now
        recompute(keepSelection: false)
    }

    static let emptyContext = PaletteContext(session: nil, muted: false, mouseShortcutsOn: true, nextFocusMinutes: nil,
                                             todos: [], installed: [], running: [])

    var input: PaletteInput { PaletteInput.parse(query) }

    func recompute(keepSelection: Bool) {
        let rows = PaletteRanker.results(input: input, context: context, frecency: frecency, now: now())
        nav = keepSelection ? nav.replacingRows(rows) : PaletteNav(rows: rows)
    }

    func reset() {
        output = nil
        if query.isEmpty { recompute(keepSelection: false) } else { query = "" }
        showCount += 1
    }

    // MARK: Keyboard

    func move(_ step: Int) { nav = nav.moved(by: step) }
    func cycleSection(backward: Bool = false) { nav = nav.cycledSection(backward: backward) }
    func select(_ index: Int) { nav = nav.selecting(index) }
    func openSubMenu() { nav = nav.selectedItem == nil ? nav : (nav.subMenu == nil ? nav.openingSubMenu() : nav.closingSubMenu()) }
    func closeSubMenu() { nav = nav.closingSubMenu() }
}
