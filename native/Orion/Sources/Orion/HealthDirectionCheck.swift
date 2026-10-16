import Foundation

/// Does a generated health sentence get the direction right for the case that
/// made `llama3.2:3b` unusable: strain 8.4 against a suggested band of 14-18,
/// which is BELOW the band, and was written up as "pushing yourself too hard".
///
/// Lives in the app target so the unit tests and
/// `Tests/run-local-model-direction.sh` judge model output the same way.
enum HealthDirectionCheck {
    static func isCorrect(_ text: String) -> Bool {
        let t = text.lowercased()
        let says = ["below", "under the", "lower than", "less than", "short of", "has room", "room to", "undertrain", "low strain"]
        let wrong = ["pushing yourself too hard", "too hard", "above the", "within the band",
                     "within that band", "within the suggested", "too much strain"]
        return says.contains(where: t.contains) && !wrong.contains(where: t.contains)
    }
}
