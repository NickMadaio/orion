//
//  Evaluation mode, as the Mac app sees it.
//
//  A harness run drives the REAL app through the real socket, and on
//  2026-11-01 a scenario's focus session quit Nick's own apps. The marker
//  ~/.openclaw/orion-controlled/eval-mode already stops every script from
//  sending anything to a person; this is the same marker read from Swift so a
//  session under evaluation reviews distractions but closes none.
//
//  The rule mirrors scripts/lib/eval-mode.mjs EXACTLY, and must keep doing so:
//    · path: $ORION_EVAL_MARKER, else ($ORION_CONTROLLED_DIR or
//      ~/.openclaw/orion-controlled)/eval-mode — an empty variable counts as
//      unset, as JavaScript's `||` does;
//    · active: now − mtime < 2 hours (a forgotten marker cannot disarm Orion
//      for good). A missing or unreadable marker is not active.
//
//  It is a test-safety seam, not routing: nothing decides what to DO from it,
//  only whether a destructive step may run.
//

import Foundation

public enum EvalMode {

    /// How long a marker stays fresh. Same two hours as eval-mode.mjs.
    public static let freshness: TimeInterval = 2 * 3600

    /// Where the marker lives for this environment.
    public static func markerURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        home: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> URL {
        if let explicit = environment["ORION_EVAL_MARKER"], !explicit.isEmpty {
            return URL(fileURLWithPath: explicit)
        }
        let controlled: URL
        if let dir = environment["ORION_CONTROLLED_DIR"], !dir.isEmpty {
            controlled = URL(fileURLWithPath: dir)
        } else {
            controlled = home.appendingPathComponent(".openclaw/orion-controlled")
        }
        return controlled.appendingPathComponent("eval-mode")
    }

    /// The pure half of the rule, so it can be tested without a filesystem.
    public static func isFresh(modifiedAt: Date?, now: Date) -> Bool {
        guard let modifiedAt else { return false }
        return now.timeIntervalSince(modifiedAt) < freshness
    }

    /// True while a fresh marker exists.
    public static func isActive(
        now: Date = Date(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        home: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> Bool {
        let url = markerURL(environment: environment, home: home)
        let modified = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
        return isFresh(modifiedAt: modified, now: now)
    }
}
