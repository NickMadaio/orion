import SwiftUI
import MobileCore
import OrionViews

/*
 The phone Home, live (wave 16). The screen itself is OrionViews/PhoneHomeView, and the cards come from
 MobileCore/PhoneHomeBuilder. This file only feeds it what the app knows and runs its buttons through the paths the
 app already has: a reply opens the chat bound to that ask (ThreadTarget, the notification-tap path), a quick answer
 and "Not now" are chat replies with `replyTo`, approvals are the same `approve`/`deny` control commands the Control
 sheet sends, Done early is RemoteStore.finishEarly, and +1 water is the AddWaterIntent store (WaterTap + WaterCourier).
*/
struct PhoneHomeScreen: View {
    @ObservedObject var remote: RemoteStore
    @ObservedObject var planner: PlannerStore
    @ObservedObject var routine: NightRoutine
    @ObservedObject private var lock = FocusLock.shared
    let onMenu: () -> Void
    let onOpenChat: () -> Void
    let onOpenSection: (String) -> Void
    var onLogFood: () -> Void = {}

    @State private var decided: [String: Bool] = [:]
    @State private var answered: Set<String> = []
    /// Bumped after a water tap so the count re-reads the store.
    @State private var waterTaps = 0

    var body: some View {
        PhoneHomeView(home: home, status: status, actions: actions)
            .toolbar(.hidden, for: .navigationBar)
            .sensoryFeedback(.success, trigger: waterTaps)
    }

    private var home: PhoneHome {
        _ = waterTaps
        let glance = GlanceWriter.compose(planner: planner, snapshot: remote.snapshot, night: routine.plan, now: remote.now)
        let messages = remote.conversation.map {
            PhoneHomeMessage(id: $0.id, askID: $0.askID, mine: $0.text, orion: $0.reply, sentAt: $0.sentAt)
        }
        return PhoneHomeBuilder.build(.init(now: remote.now, name: "Nick", glance: glance, snapshot: remote.snapshot,
                                            messages: messages, water: GlanceStore.directory.flatMap { WaterTap.today(in: $0)?.water },
                                            phoneLockedUntil: lock.lockedUntil))
    }

    private var status: PhoneHomeStatus {
        PhoneHomeStatus(online: remote.presence == .online, presence: presenceLine, earlyWorking: remote.earlyWorking,
                        earlyFeedback: remote.earlyFeedback, decided: decided, answered: answered)
    }

    private var presenceLine: String {
        switch remote.presence {
        case .online: return "Mac online"
        case .stale: return "Mac slow to respond"
        case .offline: return "Mac offline"
        case .unknown: return "Connecting"
        }
    }

    private var actions: PhoneHomeActions {
        var actions = PhoneHomeActions()
        actions.onMenu = onMenu
        actions.onOpenChat = onOpenChat
        // The notification-tap path: the root switches to the chat, which binds the reply to this ask.
        actions.onReply = { ThreadTarget.open($0) }
        actions.onAnswer = { id, option in reply(option, to: id) }
        actions.onDecline = { id in reply("Not now", to: id) }
        actions.onDecide = { id, approve in
            guard let approval = remote.snapshot?.approvals.first(where: { $0.id == id }) else { return }
            decided = decided.merging([id: approve]) { $1 }
            remote.decide(approval, approve: approve)
        }
        actions.onDoneEarly = remote.finishEarly
        actions.onAddWater = addWater
        actions.onOpenGlance = { kind in onOpenSection(kind == .focus ? "control" : "health") }
        actions.onOpenPlan = { onOpenSection("plan") }
        actions.onLogFood = onLogFood
        return actions
    }

    private func reply(_ text: String, to askID: String) {
        answered = answered.union([askID])
        remote.say(text, conversation: LinkSchema.threadID, replyTo: askID)
    }

    /// The same store the Water widget and the Siri phrase use: queued with an id, sent once, never doubled.
    private func addWater() {
        guard let directory = GlanceStore.directory, (try? WaterTap.record(in: directory)) != nil else {
            remote.log(.water(delta: 1))
            return
        }
        waterTaps += 1
        WaterCourier.reloadSurfaces()
        Task { await WaterCourier.flush(directory: directory) }
    }
}
