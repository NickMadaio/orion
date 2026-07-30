import Foundation

/*
 Which voice Orion speaks with, and which ears it listens through.

 Both are swappable, both default to the local engine, and both fall back to the
 local engine the moment the cloud one is unavailable. The rule this file exists
 to enforce: these providers carry AUDIO ONLY. Speech in, text out; text in,
 speech out. Nothing here ever carries a user request to a model or touches the
 gateway — `GatewayClient` is the only path to the agent, and it stays that way.

 The user's choice lives in UserDefaults. What is ACTUALLY serving is a separate
 thing, published by `AppState`, because a configured provider that silently
 fell back is exactly the failure this project has been bitten by before.
 */

enum TTSProvider: String, CaseIterable, Identifiable {
    case local
    case elevenlabs

    var id: String { rawValue }

    var label: String {
        switch self {
        case .local: return "Local (MLX)"
        case .elevenlabs: return "ElevenLabs"
        }
    }

    /// The `provider` value the TTS daemon understands.
    var daemonProvider: String { rawValue }

    var requiredKey: String? {
        switch self {
        case .local: return nil
        case .elevenlabs: return Secrets.elevenLabsKey
        }
    }
}

enum STTProvider: String, CaseIterable, Identifiable {
    case apple
    case deepgram

    var id: String { rawValue }

    var label: String {
        switch self {
        case .apple: return "Apple (on-device)"
        case .deepgram: return "Deepgram"
        }
    }

    var requiredKey: String? {
        switch self {
        case .apple: return nil
        case .deepgram: return Secrets.deepgramKey
        }
    }
}

/// Persisted provider choice. Plain UserDefaults — this is a preference, not a
/// secret, and `defaults read com.nickmadaio.orion.app` is how `orion-doctor`
/// reads it back.
enum VoiceSettings {
    static let ttsKey = "OrionTTSProvider"
    static let sttKey = "OrionSTTProvider"

    static var tts: TTSProvider {
        get {
            guard
                let raw = UserDefaults.standard.string(forKey: ttsKey),
                let value = TTSProvider(rawValue: raw)
            else { return .local }
            return value
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: ttsKey) }
    }

    static var stt: STTProvider {
        get {
            guard
                let raw = UserDefaults.standard.string(forKey: sttKey),
                let value = STTProvider(rawValue: raw)
            else { return .apple }
            return value
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: sttKey) }
    }
}

/// API keys: environment first, then the gitignored `.env` beside the repo.
///
/// A key read here goes straight into a request header and nowhere else. It is
/// never logged, never shown in the UI, never written into `openclaw.json`, and
/// never placed in a URL — URLs end up in logs and proxies.
enum Secrets {

    static let envPath = "/Users/nickmadaio/Desktop/ORION/.env"

    static let elevenLabsVariable = "ELEVENLABS_API_KEY"
    static let deepgramVariable = "DEEPGRAM_API_KEY"

    /// Reads one named variable. Only the key that was asked for is returned,
    /// so a caller cannot sweep up unrelated secrets by accident.
    static func value(_ name: String, envPath: String = Secrets.envPath) -> String? {
        if let fromEnvironment = ProcessInfo.processInfo.environment[name],
           !fromEnvironment.trimmingCharacters(in: .whitespaces).isEmpty {
            return fromEnvironment.trimmingCharacters(in: .whitespaces)
        }
        return valueFromEnvFile(name, path: envPath)
    }

    static func valueFromEnvFile(_ name: String, path: String) -> String? {
        guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            return nil
        }
        for rawLine in contents.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            guard let separator = line.firstIndex(of: "=") else { continue }
            let key = line[line.startIndex..<separator].trimmingCharacters(in: .whitespaces)
            guard key == name else { continue }
            var value = String(line[line.index(after: separator)...])
                .trimmingCharacters(in: .whitespaces)
            if value.count >= 2,
               (value.hasPrefix("\"") && value.hasSuffix("\""))
                || (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            }
            return value.isEmpty ? nil : value
        }
        return nil
    }

    /// Presence only. This is the only thing the UI or a diagnostic may report.
    static func isPresent(_ name: String) -> Bool { value(name) != nil }

    static var elevenLabsKey: String? { value(elevenLabsVariable) }
    static var deepgramKey: String? { value(deepgramVariable) }
}
