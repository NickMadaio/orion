import Foundation

// `StrainTarget` lives in WhoopSeries.swift alongside the chart series, which
// pulls in SwiftUI. Only its two bounds matter to `StrainPosition`, so it is
// stubbed here with the same shape rather than dragging the UI layer into a
// harness that asserts a text property.
//
// The real one's `forRecovery` mapping is not reproduced, because nothing here
// depends on WHERE the band sits -- only on whether a reading falls under, in or
// over it, which is the whole of what crosses the boundary.
struct StrainTarget: Equatable {
    let low: Double
    let high: Double
    let headline: String

    static func forRecovery(_ recovery: Int?) -> StrainTarget {
        StrainTarget(low: 8, high: 14, headline: "stub")
    }
}
