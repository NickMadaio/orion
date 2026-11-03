import Foundation
import SessionDomain

enum PaletteFocus {
    /// The same blocks `orion-session start --minutes` works out: about 50-minute blocks with 10-minute breaks,
    /// ending when he said.
    static func plan(minutes total: Int) -> SessionPlan {
        let rest = total >= 70 ? 10 : 0
        let blocks = max(1, Int((Double(total + rest) / Double(50 + rest)).rounded()))
        let restMinutes = blocks > 1 ? rest : 0
        let focus = (total - restMinutes * (blocks - 1)) / blocks
        return SessionPlanBuilder.alternating(session: SessionID(from: UUID()), focusBlocks: blocks,
                                              focus: TimeInterval(focus * 60), rest: TimeInterval(restMinutes * 60),
                                              clips: [], task: "Focus")
    }
}
