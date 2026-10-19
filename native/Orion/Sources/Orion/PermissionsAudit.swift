import AppKit
import AVFoundation
import Contacts
import EventKit
import Foundation
import Speech
import SwiftUI

/*
 Every permission Orion needs, what it is actually for, and its real state.

 Written because "check Orion's perms" had no answer short of reading a log
 file. macOS scatters these across four panes of System Settings and reports
 several of them only through APIs that must be called from inside the signed
 app, so nothing outside Orion can tell you the truth about them.

 One distinction runs through the whole list and is the reason it exists:
 SOME OF THESE CAN BE ASKED FOR AND SOME CANNOT. Microphone, Speech, Calendars,
 Reminders and Contacts all raise a prompt. Accessibility can only be nudged
 toward System Settings. Full Disk Access cannot even be nudged — there is no
 API, no entitlement and no prompt, and an app that appears to be "requesting"
 it is really just opening a settings pane and hoping. Saying which is which is
 most of the value here.
*/

struct PermissionState: Identifiable {
    enum Status: Equatable {
        case granted
        case denied
        case notAsked
        case unavailable(String)
    }

    let id: String
    let name: String
    /// What breaks without it, in the user's terms rather than the API's.
    let purpose: String
    let status: Status
    /// False for the two macOS will not let an app request.
    let requestable: Bool
    let settingsURL: String

    var tint: Color {
        switch status {
        case .granted: OrionTheme.green
        case .denied: OrionTheme.red
        case .notAsked: OrionTheme.orange
        case .unavailable: OrionTheme.textDim
        }
    }

    var label: String {
        switch status {
        case .granted: "granted"
        case .denied: "denied"
        case .notAsked: requestable ? "not asked yet" : "not granted"
        case .unavailable(let why): why
        }
    }
}

enum PermissionsAudit {

    /// Accessibility is listed only when push-to-talk is on, since the key
    /// monitor is the only thing that needs it.
    static func all(messages: MessagesReader.Access,
                    pushToTalkEnabled: Bool = PushToTalkSettings.load().enabled) -> [PermissionState] {
        let list = [microphone, speech, accessibility, calendars, reminders, contacts, fullDisk(messages)]
        return pushToTalkEnabled ? list : list.filter { $0.id != "accessibility" }
    }

    private static var microphone: PermissionState {
        let status: PermissionState.Status
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: status = .granted
        case .denied, .restricted: status = .denied
        default: status = .notAsked
        }
        return PermissionState(
            id: "microphone",
            name: "Microphone",
            purpose: "Hearing you when you use push-to-talk, and the wake word.",
            status: status,
            requestable: true,
            settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        )
    }

    private static var speech: PermissionState {
        let status: PermissionState.Status
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: status = .granted
        case .denied, .restricted: status = .denied
        default: status = .notAsked
        }
        return PermissionState(
            id: "speech",
            name: "Speech recognition",
            purpose: "Turning what you say into text, on this Mac.",
            status: status,
            requestable: true,
            settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
        )
    }

    /// The one that has to be flipped by hand, and the reason push-to-talk
    /// silently does nothing when it is off.
    private static var accessibility: PermissionState {
        PermissionState(
            id: "accessibility",
            name: "Accessibility",
            purpose: "Watching for the push-to-talk key. Without it the key press never reaches Orion at all.",
            status: Permissions.accessibilityTrusted ? .granted : .notAsked,
            requestable: false,
            settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        )
    }

    private static var calendars: PermissionState {
        let status: PermissionState.Status
        if #available(macOS 14.0, *) {
            switch EKEventStore.authorizationStatus(for: .event) {
            case .fullAccess: status = .granted
            case .denied, .restricted: status = .denied
            case .writeOnly: status = .unavailable("write-only — Orion needs to read")
            default: status = .notAsked
            }
        } else {
            status = EKEventStore.authorizationStatus(for: .event) == .authorized ? .granted : .notAsked
        }
        return PermissionState(
            id: "calendars",
            name: "Calendars",
            purpose: "The day timeline, and creating events. Google arrives through here too.",
            status: status,
            requestable: true,
            settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
        )
    }

    private static var reminders: PermissionState {
        let status: PermissionState.Status
        if #available(macOS 14.0, *) {
            switch EKEventStore.authorizationStatus(for: .reminder) {
            case .fullAccess: status = .granted
            case .denied, .restricted: status = .denied
            default: status = .notAsked
            }
        } else {
            status = EKEventStore.authorizationStatus(for: .reminder) == .authorized ? .granted : .notAsked
        }
        return PermissionState(
            id: "reminders",
            name: "Reminders",
            purpose: "The task list. Orion reads and writes one list called Orion, and nothing else.",
            status: status,
            requestable: true,
            settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders"
        )
    }

    private static var contacts: PermissionState {
        let status: PermissionState.Status
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized: status = .granted
        case .denied, .restricted: status = .denied
        default: status = .notAsked
        }
        return PermissionState(
            id: "contacts",
            name: "Contacts",
            purpose: "Showing a message from a person's name instead of their phone number.",
            status: status,
            requestable: true,
            settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts"
        )
    }

    /// The one macOS will not let anything ask for.
    ///
    /// Its state is inferred from whether the Messages database actually
    /// opened, because there is no API that reports it. That is not a
    /// shortcut — attempting the read IS the only test.
    private static func fullDisk(_ messages: MessagesReader.Access) -> PermissionState {
        let status: PermissionState.Status
        switch messages {
        case .granted: status = .granted
        case .needsFullDisk: status = .denied
        case .noDatabase: status = .unavailable("no Messages database on this Mac")
        case .failed(let why): status = .unavailable(why)
        case .unknown: status = .notAsked
        }
        return PermissionState(
            id: "fulldisk",
            name: "Full Disk Access",
            purpose: "Reading iMessage. There is no Messages API — the only source is a protected database, and this is the only key to it.",
            status: status,
            requestable: false,
            settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
        )
    }

    static func open(_ url: String) {
        guard let target = URL(string: url) else { return }
        NSWorkspace.shared.open(target)
    }

    /// Where Orion is on disk, because granting Full Disk Access means dragging
    /// the app into a list and people go looking in the wrong folder.
    static var bundlePath: String {
        Bundle.main.bundleURL.path
    }
}
