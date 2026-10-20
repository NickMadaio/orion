import Foundation

/// The "Done early" button, shared by the Mac app, the phone and the phone link on the Mac.
///
/// One button tells ORION that what is happening right now is finished: a class, a task or to-do block, the gym,
/// anything. What it does with each is decided by `orion-reschedule early`; this type owns the words the button
/// shows (label, VoiceOver text, symbol) and how a press is turned into that command, so every surface says and
/// runs the same thing.
public enum DoneEarly {
    /// The button's label. It used to read "I'm out early", which only fit a class.
    public static let label = "Done early"
    /// A checkmark: finished, not "leaving".
    public static let symbol = "checkmark.circle"
    /// The check-in action the phone sends (a LinkLog.checkin): the Mac works out what is current itself.
    public static let linkAction = "early-auto"

    /// VoiceOver label: the button's name, plus what it would end when that is known.
    public static func accessibilityLabel(for context: EarlyFinishContext?) -> String {
        switch context?.kind {
        case "block": return "\(label): \(context?.title ?? "current block")"
        case "after-class": return "\(label): \(context?.classTitle ?? "class")"
        default: return label
        }
    }

    /// VoiceOver hint: what a press does, per kind. With nothing on, it still works and says so.
    public static func accessibilityHint(for context: EarlyFinishContext?) -> String {
        switch context?.kind {
        case "block": return "Ends it now, checks it off your to-do list and pulls the rest of your day forward."
        case "after-class": return "Ends the class now and reserves your trip home."
        default: return "Nothing is on right now. ORION will tell you what is next."
        }
    }

    /// A check-in's own id (`ci-` and hex), the only shape a Done may carry.
    public static func isCheckinID(_ id: String) -> Bool {
        id.hasPrefix("ci-") && (4...16).contains(id.count) && id.dropFirst(3).allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }

    /// The link action for a check-in's Done: "done:<id>" when the check-in is known, else plain "done".
    public static func checkinDone(id: String?) -> String {
        if let id, isCheckinID(id) { return "done:\(id)" }
        return "done"
    }

    /// The check-in a "done:<id>" action is about.
    public static func checkinID(fromLinkAction action: String) -> String? {
        guard action.hasPrefix("done:") else { return nil }
        let id = String(action.dropFirst(5))
        return isCheckinID(id) ? id : nil
    }

    /// Is this a check-in Done (with or without its check-in's id)?
    public static func isCheckinDone(_ action: String) -> Bool { action == "done" || checkinID(fromLinkAction: action) != nil }

    /// The `orion-reschedule` arguments for a phone link action. A check-in's Done acts on THAT check-in's own block
    /// (`--checkin <id>`, or the latest open one when the surface did not know the id), never on whatever is current.
    public static func rescheduleArguments(forLinkAction action: String) -> [String]? {
        if isCheckinDone(action) { return ["early", "block", "--checkin", checkinID(fromLinkAction: action) ?? "latest"] }
        switch action {
        case "early-block": return ["early", "block"]
        case "early-out-of-class": return ["early", "out-of-class"]
        case linkAction: return ["early"]
        default: return nil
        }
    }

    /// The `orion-reschedule` arguments for the Mac app's button ("auto" lets the planner see what is current).
    public static func rescheduleArguments(mode: String) -> [String]? {
        switch mode {
        case "auto": return ["early"]
        case "block", "out-of-class": return ["early", mode]
        default: return nil
        }
    }

    /// The one short line he reads: the planner's first line (the rest is detail for the log).
    public static func summary(from output: String) -> String {
        let first = output.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty }
        return first.map { String($0.prefix(240)) } ?? "Done."
    }
}
