import Foundation

/// What the phone's offline signal queue keeps when it is full (review 11, 2026-10-16). A place event (entering or leaving a place
/// he confirmed) is rare and is what the Mac's awareness reacts to; a plain motion sample is one of many. So when the queue is over
/// its limit the oldest plain samples go first, and a place event is dropped only when nothing but place events is left.
public enum SignalQueuePolicy {
    public static func isPlace(_ entry: LinkLog) -> Bool {
        // A place event or a wake signal is worth more than a plain sample (the morning brief waits on the latter).
        switch entry {
        case .place, .sleep: return true
        default: return false
        }
    }

    /// `items` oldest first; the result keeps their order and at most `limit` of them.
    public static func trim<T>(_ items: [T], limit: Int, isPlace: (T) -> Bool) -> [T] {
        var drop = items.count - limit
        guard drop > 0 else { return items }
        var keep = Array(items.enumerated())
        // plain samples, oldest first
        for (index, element) in items.enumerated() where drop > 0 && !isPlace(element) {
            keep.removeAll { $0.offset == index }; drop -= 1
        }
        // only place events left over the limit: the oldest of them
        while drop > 0, !keep.isEmpty { keep.removeFirst(); drop -= 1 }
        return keep.map(\.element)
    }
}
