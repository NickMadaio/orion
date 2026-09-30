import Foundation
import Security

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

/// API keys: environment, then the Keychain, then the gitignored `.env`.
///
/// A key read here goes straight into a request header and nowhere else. It is
/// never logged, never shown in the UI, never written into `openclaw.json`, and
/// never placed in a URL — URLs end up in logs and proxies.
///
/// The Keychain sits ahead of `.env` on purpose. It makes a migration a no-op
/// switch: seed the item, and this prefers it with no other change, so the
/// plaintext line can be removed once the new source is proven rather than
/// before. Which providers have moved is not decided here — `ModelContract`
/// says, and a provider still on a plaintext source simply falls through.
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
        if let provider = providerForVariable[name],
           let item = ModelContract.keychainItem(provider: provider),
           let fromKeychain = valueFromKeychain(item: item) {
            return fromKeychain
        }
        return valueFromEnvFile(name, path: envPath)
    }

    /// Which provider each variable belongs to, so the contract can be asked
    /// where that provider's credential lives.
    private static let providerForVariable = [
        elevenLabsVariable: "elevenlabs",
        deepgramVariable: "deepgram",
    ]

    /// Reads one generic password from the login Keychain.
    ///
    /// Account `openclaw` matches the items the Phase 0 migration created; a
    /// different account here would silently find nothing. `kSecReturnData`
    /// with a single-item limit means only the value asked for comes back.
    static func valueFromKeychain(item: String) -> String? {
        cacheLock.lock()
        if let cached = keychainCache[item] { cacheLock.unlock(); return cached }
        cacheLock.unlock()
        let value = keychainValueWithoutPrompt(item: item) ?? keychainValueViaSecurityTool(item: item)
        if let value {
            cacheLock.lock(); keychainCache[item] = value; cacheLock.unlock()
        } else {
            OrionLog.write("[secrets] \(item): not readable from the keychain")
        }
        return value
    }

    /*
     Voice broke on 2026-09-29 because of this lookup. ORION is signed with a
     local certificate, so the keychain ties its "always allow" to the exact
     build: every rebuild turned the next key read into a hidden "Orion wants to
     use your confidential information" prompt, on the main thread, at the moment
     Nick pressed talk. The press froze (26 s once), or the read failed ("NO
     KEY"), and by the time listening began the key was already up.

     Now: never prompt (`kSecUseAuthenticationUIFail`); if the item says no, read
     it through /usr/bin/security, which the item already trusts because it was
     created with it; cache the value for the life of the process; and
     `prefetch()` at launch, off the main thread, so no press waits on this.
    */
    private static var keychainCache: [String: String] = [:]
    private static let cacheLock = NSLock()

    private static func keychainValueWithoutPrompt(item: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: item,
            kSecAttrAccount as String: "openclaw",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            if status != errSecItemNotFound { OrionLog.write("[secrets] \(item): keychain said \(status), trying the security tool") }
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// The value stays in memory: stdout is read into a pipe, never logged.
    private static func keychainValueViaSecurityTool(item: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        process.arguments = ["find-generic-password", "-a", "openclaw", "-s", item, "-w"]
        let out = Pipe()
        process.standardOutput = out
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        let trimmed = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Called at launch: resolve the voice keys once, in the background.
    static func prefetch() {
        DispatchQueue.global(qos: .utility).async {
            let found = [deepgramVariable, elevenLabsVariable].filter { value($0) != nil }
            OrionLog.write("[secrets] prefetched \(found.count) of 2 voice keys")
        }
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
