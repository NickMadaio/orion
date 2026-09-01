//
//  ModelContract.swift
//
//  Which model answers to which role, read from one document instead of
//  compiled into three files.
//
//  ORION owns the contract; OpenClaw and this app execute it. Before Phase 2
//  the app carried its model names as `static let` constants, which meant that
//  trying a different transcriber cost a rebuild, a re-sign, and a reinstall —
//  and that nobody could see, from one place, what this machine was talking to.
//
//  Everything here fails soft and returns the caller's compiled-in default. A
//  missing or malformed contract must never be why Orion cannot hear or speak;
//  the constants that used to be the only answer are still a correct one.
//

import Foundation

enum ModelContract {

    /// Written by the v2 tooling; the same document the Python and TypeScript
    /// sides read. Runtime data, so it lives with the rest of it rather than in
    /// the app bundle — changing a model must not require shipping a build.
    static let path = NSString(string: "~/.openclaw/orion-controlled/model-roles.json")
        .expandingTildeInPath

    /// Cached for the process lifetime. This is read on the speech path, and a
    /// disk read per utterance would be a latency cost for a file that changes
    /// perhaps monthly. Relaunch picks up an edit.
    private static let cached: [String: Any]? = load()

    private static func load() -> [String: Any]? {
        guard let data = FileManager.default.contents(atPath: path),
              let parsed = try? JSONSerialization.jsonObject(with: data),
              let object = parsed as? [String: Any],
              let version = object["schema_version"] as? Int,
              version == 1
        else { return nil }
        return object
    }

    /// The bare model name for a role, or `fallback` when the contract cannot
    /// answer. Bare rather than `provider/model`, because that is what every
    /// client here actually sends.
    ///
    /// A role declared with a null primary — `vision` today — is deliberately
    /// unassigned and returns the fallback. Substituting some other role's model
    /// would produce confident nonsense.
    static func model(role: String, fallback: String) -> String {
        guard let roles = cached?["roles"] as? [String: Any],
              let binding = roles[role] as? [String: Any],
              let reference = binding["primary"] as? String
        else { return fallback }
        guard let slash = reference.firstIndex(of: "/") else { return fallback }
        let model = String(reference[reference.index(after: slash)...])
        return model.isEmpty ? fallback : model
    }

    /// The Keychain item name a provider's credential lives under, when the
    /// contract says it lives in the Keychain at all. Returns nil for a
    /// provider still on a plaintext source, so the caller falls through to its
    /// existing lookup rather than failing.
    static func keychainItem(provider: String) -> String? {
        guard let providers = cached?["providers"] as? [String: Any],
              let binding = providers[provider] as? [String: Any],
              let credential = binding["credential"] as? [String: Any],
              credential["source"] as? String == "keychain",
              let reference = credential["ref"] as? String,
              !reference.isEmpty
        else { return nil }
        return reference
    }
}
