import AppKit
@preconcurrency import ApplicationServices
import Foundation

/// The three permissions Orion actually needs, and honest ways to ask for them.
///
/// Accessibility is the one that cannot be requested from inside the app: macOS
/// only offers a prompt that sends the user to System Settings, and the toggle
/// has to be flipped by hand. So we detect it, say so plainly, and open the
/// exact pane rather than silently doing nothing when Right Option is pressed.
enum Permissions {

    static var accessibilityTrusted: Bool {
        AXIsProcessTrusted()
    }

    /// Shows the system prompt if the user has never been asked. Returns the
    /// current trust state (which is almost always `false` on first call — the
    /// user still has to flip the switch).
    @discardableResult
    static func promptForAccessibility() -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    static func openAccessibilitySettings() {
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
    }

    static func openMicrophoneSettings() {
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
    }

    static func openSpeechRecognitionSettings() {
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition")
    }

    private static func open(_ string: String) {
        guard let url = URL(string: string) else { return }
        NSWorkspace.shared.open(url)
    }
}
