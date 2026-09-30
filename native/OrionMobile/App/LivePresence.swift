import ActivityKit
import Foundation
import UIKit
import MobileCore

/*
 ORION's presence on the lock screen (2026-09-29).

 "persistence and reaching out": a Live Activity that shows what matters now
 without opening anything — the check-in he is chasing (with Started / 10 min
 / Done), the block that is on with its time running down, or what starts in
 the next hour. One at a time; it is updated in place and ended when there is
 nothing worth showing.

 iOS only lets an app START a Live Activity while it is in the foreground (a
 push can start one only through Apple's push service, which this setup does
 not have). So it starts whenever ORION is opened and something qualifies, and
 from then on background pushes and the refresh task keep it current.
*/
@MainActor
final class LivePresence: ObservableObject {
    static let shared = LivePresence()
    @Published var enabled: Bool = UserDefaults.standard.object(forKey: "orion.presence.enabled") as? Bool ?? true {
        didSet { UserDefaults.standard.set(enabled, forKey: "orion.presence.enabled"); if !enabled { endAll() } }
    }

    /// What should be on the lock screen at `now`, if anything.
    static func state(for glance: OrionGlance, now: Date) -> OrionActivityAttributes.ContentState? {
        let mood = glance.mood(at: now).rawValue
        let next = glance.upcoming(after: now, limit: 2)
        // The card stays up for the whole follow-up: iOS will not let the app start
        // a new one from the background, so ending it on a snooze would lose it.
        if let checkin = glance.checkin, checkin.phase == "deferred" || checkin.phase == "active" {
            let snoozed = checkin.phase == "deferred"
            let back = checkin.nextCheck ?? now.addingTimeInterval(snoozed ? 600 : 1500)
            return .init(mode: snoozed ? "snoozed" : "active", title: checkin.what,
                         detail: snoozed ? "Snoozed · back at \(OrionGlance.clock(back))" : "On it · ORION checks in at \(OrionGlance.clock(back))",
                         kind: "orion", start: snoozed ? now : (checkin.due ?? now), end: back, level: 0,
                         nextTitle: next.first?.title, nextAt: next.first?.start, mood: mood)
        }
        if let checkin = glance.checkin, checkin.chasing {
            let due = checkin.due ?? now
            return .init(mode: "checkin", title: checkin.what,
                         detail: checkin.level >= 2 ? "You said you'd start this. Start now." : "Time to start.",
                         kind: "orion", start: due, end: due.addingTimeInterval(3600), level: checkin.level,
                         nextTitle: next.first?.title, nextAt: next.first?.start, mood: mood)
        }
        if let current = glance.current(at: now) {
            let after = next.first { $0.start >= current.end.addingTimeInterval(-60) } ?? next.first
            return .init(mode: "now", title: current.title,
                         detail: current.location ?? "until \(OrionGlance.clock(current.end))",
                         kind: current.kind, start: current.start, end: current.end, level: 0,
                         nextTitle: after?.title, nextAt: after?.start, mood: mood)
        }
        if let first = next.first, first.start.timeIntervalSince(now) <= 60 * 60 {
            return .init(mode: "next", title: first.title,
                         detail: "at \(OrionGlance.clock(first.start))" + (first.location.map { " · \($0)" } ?? ""),
                         kind: first.kind, start: first.start, end: first.end, level: 0,
                         nextTitle: next.dropFirst().first?.title, nextAt: next.dropFirst().first?.start, mood: mood)
        }
        return nil
    }

    func sync(_ glance: OrionGlance, now: Date = Date()) {
        guard enabled, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let desired = Self.state(for: glance, now: now)
        let running = Activity<OrionActivityAttributes>.activities
        guard let desired else { endAll(); return }
        let content = ActivityContent(state: desired, staleDate: desired.mode == "next" ? desired.start.addingTimeInterval(300) : desired.end.addingTimeInterval(300),
                                      relevanceScore: desired.mode == "checkin" ? 100 : 50)
        if let activity = running.first {
            guard activity.content.state != desired else { return }
            Task { await activity.update(content) }
            for extra in running.dropFirst() { Task { await extra.end(nil, dismissalPolicy: .immediate) } }
        } else if UIApplication.shared.applicationState == .active {
            _ = try? Activity.request(attributes: OrionActivityAttributes(), content: content, pushType: nil)
        }
    }

    func endAll() {
        for activity in Activity<OrionActivityAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }
}

import SwiftUI

/// Control ▸ Lock screen: the switch for ORION's Live Activity.
struct PresenceSection: View {
    @ObservedObject var presence: LivePresence
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Lock screen", tint: Phone.soft)
            Toggle(isOn: $presence.enabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("ORION on the lock screen").font(.system(size: 15, weight: .medium))
                    Text("While something is on, starting within the hour, or a check-in is waiting: a live card on the lock screen and in the Dynamic Island, with Started and Done on it. It starts when you open ORION and keeps itself up to date.")
                        .font(.system(size: 12)).foregroundStyle(Phone.dim)
                }
            }
            .tint(Phone.accent)
        }
    }
}
