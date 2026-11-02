import Foundation

/// The tie-breaker for a borderline follow-up (`FollowUpAddressGate` scored 0):
/// one question to the resident local 4B model, strict JSON back, a short
/// timeout, and anything other than an unambiguous `{"addressed": true}` is
/// "not addressed".
///
/// This can only ADD turns. A borderline line is refused without it, so the
/// model being slow, down, or confused costs nothing that the deterministic gate
/// would have kept — which is the 2026-10-08 failure (a model gate dropping real
/// follow-ups) designed out.
enum AddressJudge {
    static let model = "qwen3.5:4b-q4_K_M"
    static let timeout: TimeInterval = 2.5
    static let maxQuoted = 400

    static func prompt(utterance: String, orionLast: String) -> String {
        """
        You decide whether a voice assistant named ORION should reply to a line its microphone heard.
        ORION just said: "\(clip(orionLast))"
        Then the microphone heard (the user's name was not said): "\(clip(utterance))"
        Was that line plausibly said TO the assistant, as a reply or a request, rather than to another person, \
        a TV, or the room? When unsure, answer false.
        Answer with only this JSON and nothing else: {"addressed": true} or {"addressed": false}
        """
    }

    private static func clip(_ text: String) -> String {
        let flat = text.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\n", with: " ")
        return flat.count > maxQuoted ? String(flat.prefix(maxQuoted)) + "…" : flat
    }

    /// True only for a JSON object whose `addressed` is the boolean true. A
    /// markdown fence around it is tolerated; anything else around it is not.
    static func parse(_ raw: String) -> Bool {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("```") {
            text = text.replacingOccurrences(of: "```json", with: "").replacingOccurrences(of: "```", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard text.hasPrefix("{"), text.hasSuffix("}"),
              let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let value = object["addressed"] as? NSNumber,
              CFGetTypeID(value) == CFBooleanGetTypeID() else { return false }
        return value.boolValue
    }

    /// Runs `complete` off the main thread and calls back on the main thread.
    static func judge(
        utterance: String, orionLast: String,
        complete: @escaping (String) throws -> String = { prompt in
            try LocalModel.complete(prompt: prompt, model: AddressJudge.model, maxTokens: 20, temperature: 0,
                                    timeout: AddressJudge.timeout, requireSentenceEnding: false)
        },
        completion: @escaping (Bool) -> Void
    ) {
        let question = prompt(utterance: utterance, orionLast: orionLast)
        DispatchQueue.global(qos: .userInitiated).async {
            let verdict = (try? complete(question)).map(parse) ?? false
            DispatchQueue.main.async { completion(verdict) }
        }
    }
}
