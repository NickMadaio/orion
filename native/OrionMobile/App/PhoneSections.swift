import SwiftUI
import UserNotifications
import MobileCore

/// Control's "Connection": iCloud, the Mac, and notifications, stated plainly.
struct PhoneConnectionSection: View {
    @ObservedObject var remote: RemoteStore
    @State private var notifications: UNAuthorizationStatus?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionLabel("Connection", tint: Phone.soft)
            StatusDot(text: remote.iCloudReady ? "iCloud connected" : (remote.problem ?? "Connecting to iCloud…"),
                      tint: remote.iCloudReady ? Phone.green : Phone.orange)
            StatusDot(text: macText, tint: remote.presence == .online ? Phone.green : remote.presence == .stale ? Phone.orange : Phone.dim)
            HStack(spacing: 10) {
                StatusDot(text: notificationText, tint: notifications == .authorized ? Phone.green : Phone.orange)
                if notifications == .denied {
                    Button("Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Phone.accent)
                }
            }
            Text("Your iPhone and Mac talk through your own private iCloud. Nothing passes through anyone else’s server, and signing in with the same Apple ID is the only pairing.")
                .font(.footnote).foregroundStyle(Phone.dim)
        }
        .task { await readNotifications() }
    }

    private var macText: String {
        switch remote.presence {
        case .online: return "Your Mac is online"
        case .stale: return "Your Mac is slow to respond"
        case .offline: return "Your Mac is offline · commands wait until it’s back"
        case .unknown: return "Not heard from your Mac yet · is ORION running on it?"
        }
    }

    private var notificationText: String {
        switch notifications {
        case .authorized, .provisional, .ephemeral: return "Approval notifications on"
        case .denied: return "Notifications are off · approvals won’t ping you"
        default: return "Notifications not set up yet"
        }
    }

    private func readNotifications() async {
        notifications = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}


/// One quiet line at the top of a Mac-backed screen: when it last synced, or why it could not, with a Retry.
/// The screen below always shows whatever it has; this never stands in for it.
struct SyncLine: View {
    @ObservedObject var remote: RemoteStore
    @State private var retrying = false

    var body: some View {
        let line = remote.syncLine
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Circle().fill(tint(line.tone)).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
            VStack(alignment: .leading, spacing: 3) {
                Text(line.text).font(Phone.mono(11.5, .medium)).foregroundStyle(line.tone == .problem ? Phone.orange : Phone.soft)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = line.detail { Text(detail).font(Phone.mono(10.5, .regular)).foregroundStyle(Phone.dim) }
            }
            Spacer(minLength: 0)
            if line.tone != .fresh {
                Button(retrying ? "Retrying…" : "Retry") {
                    retrying = true
                    remote.retryLink()
                    Task { try? await Task.sleep(for: .seconds(3)); retrying = false }
                }
                .font(Phone.mono(11.5, .semibold)).foregroundStyle(Phone.accent).disabled(retrying)
                .accessibilityIdentifier("syncRetry")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("syncLine")
    }

    private func tint(_ tone: LinkSyncStatus.Tone) -> Color {
        switch tone {
        case .fresh: return Phone.green
        case .stale, .waiting: return Phone.yellow
        case .problem: return Phone.orange
        }
    }
}
