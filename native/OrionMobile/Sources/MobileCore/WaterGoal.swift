import Foundation

/*
 The day's water goal, in bottles (2026-11-04).

 Nick: "make it so if I right click the water I can change the 'out of' number."
 It was a 9 written in four places. It now lives once, as `water` inside the
 health log's `nutritionGoals` (next to calories and protein), and every reader
 -- the Mac Health tab, Link's snapshot and replies, the phone, the widgets
 through the glance, ORION's chat and scripts -- takes it from there through
 this type. A missing, non-numeric or out-of-range value reads as something
 sane rather than as zero, because a goal of 0 divides every ring by zero.
*/
public enum WaterGoal {
    public static let range = 1...30
    public static let `default` = 9
    /// The quick picks both menus offer.
    public static let picks = [6, 8, 9, 10, 12]

    public static func clamped(_ bottles: Int) -> Int {
        min(range.upperBound, max(range.lowerBound, bottles))
    }

    /// The goal in a `nutritionGoals` dictionary; the default when it is not there.
    public static func value(from goals: [String: Any]?) -> Int {
        guard let number = goals?["water"] as? NSNumber, number !== kCFBooleanTrue, number !== kCFBooleanFalse else { return `default` }
        return clamped(number.intValue)
    }

    /// One bottle more or fewer, held inside the range.
    public static func stepped(_ current: Int, by delta: Int) -> Int { clamped(current + delta) }

    /// What he typed into "Custom…": a whole number, clamped to the range; nil when it is not a number at all.
    public static func parse(_ text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 6, trimmed.allSatisfy({ $0.isASCII && $0.isNumber }), let number = Int(trimmed) else { return nil }
        return clamped(number)
    }
}
