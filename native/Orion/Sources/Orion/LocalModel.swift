import Foundation

/*
 A local model, spoken to directly.

 The obvious route for this was `GatewayClient` — Orion's brain is already there
 and the CLI takes `--model`, so a local override looked like one flag. It was
 measured instead of assumed, and the measurement killed the idea:

     openclaw agent --model ollama/llama3.2:3b   44.7s, stopReason "toolUse"
     ollama /api/generate directly                1.1s, three clean sentences

 The gateway routes correctly — the run really did go to Ollama with no
 fallback. But it runs an AGENT: the model is handed Orion's whole toolset and a
 durable session, and a 3B model given tools reaches for them. It spent
 forty-four seconds deciding to call one and never wrote the paragraph.

 Which is the lesson worth keeping: an agent and a text transform are different
 jobs. Writing three sentences over numbers Orion has already computed needs no
 tools, no memory of yesterday, and no conversation. It needs a completion.

 So this is a plain HTTP call to Ollama on loopback. Nothing leaves the machine,
 there is no gateway to be up, no session to accumulate, and it is forty times
 faster. When Ollama is not running, it fails — which is fine, because
 everything that uses this is designed to be complete without it.
*/

enum LocalModelError: LocalizedError {
    case unreachable
    case empty
    case truncated

    var errorDescription: String? {
        switch self {
        case .unreachable: return "Ollama is not answering on 127.0.0.1:11434."
        case .empty: return "The local model returned nothing."
        case .truncated: return "The local model ran out of room mid-sentence."
        }
    }
}

enum LocalModel {

    /// The model everything local runs on. One constant, so swapping it is one
    /// edit.
    ///
    /// `llama3.2:3b` was the first choice and it had to be given up, for a
    /// reason worth recording because it is not the usual one. It was not too
    /// bland. It was WRONG. Handed a strain of 8.4 against a suggested band of
    /// 14–18, it wrote "you may be pushing yourself too hard" — the exact
    /// inverse of what the number says. On the brief it invented a
    /// "parasympathetic response" and claimed he had been pushing hard lately,
    /// under a green recovery.
    ///
    /// A summary that misreads the data is worse than no summary, because the
    /// numbers are right there beside it and the prose quietly contradicts
    /// them. So the size is not a quality preference here, it is a correctness
    /// floor.
    ///
    /// Measured on this Mac, the same health prompt:
    ///
    ///   llama3.2:3b    2.4s   "pushing yourself too hard"   — inverted
    ///   gpt-oss:20b   13.1s   "strain is below the band"    — correct
    ///
    /// Both are local and cost nothing. Every caller writes once, caches, and
    /// never blocks the screen, so the seconds are spent while the numbers are
    /// already being read.
    static let defaultModel = "gpt-oss:20b"

    /// Generous, and that is not arbitrary.
    ///
    /// Reasoning models — `gpt-oss:20b`, `qwen3:30b` — spend this budget on a
    /// `thinking` field BEFORE writing anything into `response`. At 200 the
    /// budget was gone before the answer started and both returned an empty
    /// string, which looks exactly like the model being broken. At 900 the
    /// answer started and was cut off mid-sentence. It is not wasted on a
    /// smaller model: generation still stops at the end of the answer.
    static let defaultMaxTokens = 1600

    private static let endpoint = URL(string: "http://127.0.0.1:11434/api/generate")!

    /// Blocking. Always call from a background queue.
    ///
    /// `timeout` is deliberately short. A local completion either comes back in
    /// a couple of seconds or something is wrong, and every caller here would
    /// rather show nothing than wait.
    ///
    /// `requireSentenceEnding` is the prose guard below, and callers that want
    /// something other than prose have to switch it off. JSON ends in `]`, so
    /// leaving it on would reject every well-formed answer as truncated.
    static func complete(
        prompt: String,
        model: String = LocalModel.defaultModel,
        maxTokens: Int = LocalModel.defaultMaxTokens,
        temperature: Double = 0.4,
        timeout: TimeInterval = 90,
        requireSentenceEnding: Bool = true
    ) throws -> String {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = timeout
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": model,
            "prompt": prompt,
            "stream": false,
            "options": [
                "temperature": temperature,
                "num_predict": maxTokens,
            ],
        ])

        // Synchronous by design: the callers already run on a background queue
        // and a semaphore here is simpler than threading a completion handler
        // through code whose whole job is "produce a string or do not".
        let semaphore = DispatchSemaphore(value: 0)
        var body: Data?
        var failure: Error?

        URLSession.shared.dataTask(with: request) { data, _, error in
            body = data
            failure = error
            semaphore.signal()
        }.resume()

        guard semaphore.wait(timeout: .now() + timeout + 2) == .success else {
            throw LocalModelError.unreachable
        }
        if failure != nil { throw LocalModelError.unreachable }
        guard let body,
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let text = json["response"] as? String
        else { throw LocalModelError.unreachable }

        // `thinking` is deliberately NOT used as a fallback. A reasoning
        // model's scratchpad is not its answer — it is full of "we need to
        // write 2-3 sentences" and half-formed drafts, and showing it would be
        // worse than showing nothing.
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw LocalModelError.empty }

        // A completion that ran out of budget stops mid-word. Half a sentence
        // reads as a bug in the app rather than as a limit in the model, and
        // every caller here would rather show nothing.
        guard !requireSentenceEnding else {
            guard let last = trimmed.last, ".!?\"".contains(last) else {
                throw LocalModelError.truncated
            }
            return trimmed
        }
        return trimmed
    }
}
