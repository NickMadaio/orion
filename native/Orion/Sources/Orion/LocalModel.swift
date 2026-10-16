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
    /// 2026-10-16 (speed audit, docs/audits/2026-10-16-local-speed.md): this was
    /// `gpt-oss:20b` (13 GiB), fired at mic press and on refresh. Ollama sizes a
    /// load against FREE system memory, so loading it evicted the two voice
    /// models (qwen3.5:4b and :9b) and the voice turn in flight queued behind the
    /// swap: 15 gpt-oss loads and 13 9B reloads in a day, 6.3 s lost on one 11 s
    /// worker call, and a 15 s TTS (normally 6.5 s). Narratives now run on
    /// `qwen3.5:9b`, which is already resident, so nothing is evicted.
    ///
    /// The reason gpt-oss was here still stands and was re-checked rather than
    /// assumed. `llama3.2:3b` was given up because it was WRONG, not bland:
    /// handed a strain of 8.4 against a suggested band of 14-18 it wrote "you
    /// may be pushing yourself too hard", the exact inverse of the number. The
    /// 9B was run on that same case three times (Ollama, think off, num_ctx
    /// 32768) and said "well below the band" 3 of 3. See
    /// `Tests/run-local-model-direction.sh`, which repeats that check live.
    ///
    /// The model name still comes from the contract, under its own role
    /// ("narrative") rather than "local", so that nothing else reading the
    /// "local" role is changed and editing the contract can still pick another.
    static let defaultModel = ModelContract.model(role: "narrative", fallback: fallbackModel)

    /// The voice worker's model, resident with keep_alive 24h.
    static let fallbackModel = "qwen3.5:9b"

    /// Models Ollama already keeps loaded for voice, with the options they are
    /// loaded with. Asking for a different num_ctx makes Ollama RELOAD the model,
    /// so this must equal FORM_OPTIONS.num_ctx in
    /// plugin/orion-control/src/schedule-flow.ts.
    static let residentNumCtx = 32768

    /// How a request for `model` is shaped.
    ///
    /// A resident model keeps its context, stays loaded for 24h like the plugin
    /// sets it (an omitted keep_alive would reset it to Ollama's 5 minutes) and
    /// does not think: the answer is a few sentences or a JSON id, and 1.9 s of
    /// decode is the whole job. Any other model (gpt-oss through the contract)
    /// may be big enough to evict the voice models, so it is unloaded the moment
    /// it answers, and gets headroom for its scratchpad.
    struct Profile: Equatable {
        let resident: Bool
        let numCtx: Int?
        let keepAlive: String
        let think: Bool?
        let budgetMultiplier: Int
    }

    static func profile(for model: String) -> Profile {
        if model.hasPrefix("qwen3.5:") {
            return Profile(resident: true, numCtx: residentNumCtx, keepAlive: "24h", think: false, budgetMultiplier: 1)
        }
        return Profile(resident: false, numCtx: nil, keepAlive: "0", think: nil, budgetMultiplier: 4)
    }

    /// Enough for a three-sentence paragraph or a one-key JSON object on a model
    /// that does not think. A reasoning model gets `budgetMultiplier` times this
    /// (it spends the budget on a scratchpad first: at 200 it returned an empty
    /// string, at 900 it was cut off mid-sentence, so 4x of 400).
    static let defaultMaxTokens = 400

    static func requestBody(prompt: String, model: String, maxTokens: Int, temperature: Double) -> [String: Any] {
        let profile = profile(for: model)
        var options: [String: Any] = [
            "temperature": temperature,
            "num_predict": maxTokens * profile.budgetMultiplier,
        ]
        if let numCtx = profile.numCtx { options["num_ctx"] = numCtx }
        var body: [String: Any] = [
            "model": model,
            "prompt": prompt,
            "stream": false,
            "keep_alive": profile.keepAlive,
            "options": options,
        ]
        if let think = profile.think { body["think"] = think }
        return body
    }

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
        request.httpBody = try JSONSerialization.data(
            withJSONObject: requestBody(prompt: prompt, model: model, maxTokens: maxTokens, temperature: temperature))

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
        guard let body else { throw LocalModelError.unreachable }
        return try responseText(body, requireSentenceEnding: requireSentenceEnding)
    }

    /// Shared by the actual transport and boundary regressions. A structured
    /// consumer validates its own schema rather than a prose punctuation rule.
    static func responseText(_ body: Data, requireSentenceEnding: Bool) throws -> String {
        guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
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
