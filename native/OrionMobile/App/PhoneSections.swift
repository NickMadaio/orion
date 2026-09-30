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
