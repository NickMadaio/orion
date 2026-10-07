import Foundation

/*
 Was that said to ORION? (2026-10-07, cost.)

 A follow-up turn, or speech that interrupted ORION, opens the microphone
 without his wake word or key, so whatever the room says gets transcribed.
 Over two days 33 of those reached Claude and came back NO_REPLY — 14% of the
 API bill for answering nobody. A local model (free, ~0.4 s warm) decides
 first. It scored 8/8 on real lines from those nights; llama3.2:3b scored 4/8.

 It never blocks him: no Ollama, a slow answer, or anything but a clear "no"
 sends the turn exactly as before. His wake word in the words always passes.
*/
enum AddressGate {
    static let model = "qwen3.5:9b"
    static let timeout: TimeInterval = 3

    static func prompt(heard: String, lastReply: String) -> String {
        """
        You decide if speech picked up by a voice assistant's microphone was said TO the assistant (named ORION), continuing a conversation with it, or is background: other people talking, Nick talking to someone else, TV, music, fragments.
        ORION's last reply: "\(lastReply.prefix(300))"
        Heard: "\(heard.prefix(400))"
        Answer with one word: yes (said to ORION) or no (background).
        """
    }

    /// Calls back on an arbitrary queue: true/false, or nil when it could not tell.
    static func check(heard: String, lastReply: String, completion: @escaping (Bool?) -> Void) {
        if heard.range(of: #"\borion\b"#, options: [.regularExpression, .caseInsensitive]) != nil { completion(true); return }
        guard let url = URL(string: "http://127.0.0.1:11434/api/generate") else { completion(nil); return }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["model": model, "prompt": prompt(heard: heard, lastReply: lastReply), "stream": false,
                                   "think": false, "keep_alive": "30m", "options": ["temperature": 0, "num_predict": 3]]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let answer = (json["response"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() else {
                completion(nil); return
            }
            completion(answer.hasPrefix("no") ? false : answer.hasPrefix("yes") ? true : nil)
        }.resume()
    }
}
