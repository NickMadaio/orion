import Foundation

/*
 Cache keys for written paragraphs.

 The morning brief once told Nick his sleep score was 81% and recovery 55% while
 the tiles beside it read 27% and 12. Both were real numbers; the prose was just
 written earlier in the day, before Whoop had synced the night he actually had,
 and then cached under a key that only named the day. Nothing invalidated it,
 so a paragraph about a good night's sleep sat under the numbers from a bad one.

 The fix is to key a paragraph by what it SAYS, not by when it was written. If
 the facts change, the key changes, the stale text is dropped and a new
 paragraph is written. If they do not, the cached one stands and no model runs.

 `String.hashValue` cannot do this job: Swift seeds it randomly per process, so
 it returns a different value every launch. Using it would change the key on
 every app start, rewrite every paragraph, and quietly turn a once-a-day local
 completion into a once-a-launch one. Hence an explicit, boring, stable hash.
*/

extension String {

    /// FNV-1a, 64-bit. Deterministic across processes and releases, which is the
    /// entire requirement — this identifies a cache entry, it is not security.
    var stableDigest: String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in self.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return String(hash, radix: 36)
    }
}

enum NarrativeKey {

    /// A key that changes exactly when the paragraph would need rewriting.
    ///
    /// `facts` should be the prompt text itself wherever possible. Deriving the
    /// digest from the very string handed to the model means the two can never
    /// drift apart — add a fact to a prompt and its cache key starts tracking it
    /// automatically, with nothing to remember and nothing to keep in sync.
    static func make(_ scope: String, facts: String) -> String {
        "\(scope).\(facts.stableDigest)"
    }
}
