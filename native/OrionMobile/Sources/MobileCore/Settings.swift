import Foundation

/// Basic settings: a closed key list with typed values.
///
/// Free-form settings dictionaries are how a preference becomes load-bearing
/// without anybody deciding it should be. Adding one here is a deliberate edit.
public enum SettingKey: String, CaseIterable, Sendable {
    case hapticFeedback
    case streamResponses
    case showTimestamps
    case compactTranscript
    case requireBiometricUnlock
}

public enum SettingValue: Sendable, Equatable {
    case on
    case off

    public var isOn: Bool { self == .on }
}

public struct Settings: Sendable, Equatable {
    private var values: [String: SettingValue]

    public static let defaults: [SettingKey: SettingValue] = [
        .hapticFeedback: .on,
        .streamResponses: .on,
        .showTimestamps: .off,
        .compactTranscript: .off,
        // Off by default: a security control somebody did not choose is a
        // security control they will turn off the first time it annoys them.
        .requireBiometricUnlock: .off,
    ]

    public init() {
        values = Dictionary(uniqueKeysWithValues: Settings.defaults.map { ($0.key.rawValue, $0.value) })
    }

    public func value(_ key: SettingKey) -> SettingValue {
        values[key.rawValue] ?? Settings.defaults[key] ?? .off
    }

    public mutating func set(_ key: SettingKey, _ value: SettingValue) {
        values[key.rawValue] = value
    }

    public var isComplete: Bool {
        SettingKey.allCases.allSatisfy { values[$0.rawValue] != nil }
    }
}
