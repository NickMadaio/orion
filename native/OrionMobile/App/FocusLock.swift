import FamilyControls
import ManagedSettings
import SwiftUI

/*
 Locking distracting apps when Nick keeps ignoring ORION (2026-09-29).

 From his statement: "If I keep ignoring it, the intervention should escalate …
 and, where technically possible and explicitly permitted by me, temporarily
 restricting distracting apps." So:

 - Off until he turns it on here, and he picks the apps himself (Apple's own
   picker; ORION never sees which apps, only opaque tokens).
 - It engages only when a check-in has been ignored past its third nudge.
 - It releases the moment he taps Started or Done, and on its own after 45
   minutes (checked whenever ORION next runs — opening the app releases an
   expired lock). It can always be released here by hand.

 Uses Screen Time (Family Controls, individual authorization).
*/
@MainActor
final class FocusLock: ObservableObject {
    static let shared = FocusLock()

    /// Shared with the Screen Time monitor extension (ScreenMonitor), which
    /// nudges and locks from the same choices while ORION is not running.
    static let shared_defaults = UserDefaults(suiteName: "group.com.nickmadaio.orion")

    @Published var enabled = UserDefaults.standard.bool(forKey: "orion.focuslock.enabled") {
        didSet {
            UserDefaults.standard.set(enabled, forKey: "orion.focuslock.enabled")
            Self.shared_defaults?.set(enabled, forKey: "orion.focuslock.enabled")
            if !enabled { release() }
        }
    }
    @Published var selection = FocusLock.loadSelection() {
        didSet {
            if let data = try? PropertyListEncoder().encode(selection) {
                UserDefaults.standard.set(data, forKey: "orion.focuslock.selection")
                Self.shared_defaults?.set(data, forKey: "orion.focuslock.selection")
            }
        }
    }

    /// Copy the current choices where the extension can read them (on launch).
    func mirror() {
        Self.shared_defaults?.set(enabled, forKey: "orion.focuslock.enabled")
        if let data = try? PropertyListEncoder().encode(selection) { Self.shared_defaults?.set(data, forKey: "orion.focuslock.selection") }
    }
    @Published private(set) var lockedUntil: Date? = {
        let t = UserDefaults.standard.double(forKey: "orion.focuslock.until"); return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }()
    @Published private(set) var problem: String?

    private let store = ManagedSettingsStore(named: .init("orion.focus"))

    private static func loadSelection() -> FamilyActivitySelection {
        guard let data = UserDefaults.standard.data(forKey: "orion.focuslock.selection"),
              let value = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data) else { return FamilyActivitySelection() }
        return value
    }

    var hasApps: Bool { !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty }

    func authorize() async -> Bool {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            problem = nil
            return true
        } catch {
            problem = "Screen Time access wasn't granted, so ORION can't lock apps."
            enabled = false
            return false
        }
    }

    /// An ignored check-in at level 3+: lock the chosen apps for a while.
    func engage(minutes: Int) {
        guard enabled, hasApps, AuthorizationCenter.shared.authorizationStatus == .approved else { return }
        store.shield.applications = selection.applicationTokens
        store.shield.applicationCategories = .specific(selection.categoryTokens)
        let until = Date().addingTimeInterval(Double(minutes * 60))
        lockedUntil = until
        UserDefaults.standard.set(until.timeIntervalSince1970, forKey: "orion.focuslock.until")
    }

    func release() {
        store.clearAllSettings()
        lockedUntil = nil
        UserDefaults.standard.removeObject(forKey: "orion.focuslock.until")
    }

    /// Called whenever ORION runs: a lock past its time comes off.
    func releaseIfExpired(now: Date = Date()) {
        if let lockedUntil, now >= lockedUntil { release() }
    }
}

/// Control ▸ Focus lock.
struct FocusLockSection: View {
    @ObservedObject var lock: FocusLock
    @State private var picking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Focus lock", tint: Phone.soft)
            Toggle(isOn: Binding(get: { lock.enabled }, set: { value in
                if value { Task { if await lock.authorize() { lock.enabled = true; if !lock.hasApps { picking = true } } } }
                else { lock.enabled = false }
            })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Lock distracting apps when I ignore ORION").font(.system(size: 15, weight: .medium))
                    Text("Only after a check-in has been ignored three times. Tapping Started or Done unlocks them; otherwise they unlock after 45 minutes.")
                        .font(.system(size: 12)).foregroundStyle(Phone.dim)
                }
            }
            .tint(Phone.accent)
            if lock.enabled {
                Button { picking = true } label: {
                    Label(lock.hasApps ? "Change which apps (\(lock.selection.applicationTokens.count) apps, \(lock.selection.categoryTokens.count) categories)" : "Choose apps to lock", systemImage: "apps.iphone")
                }
                .buttonStyle(PhoneButtonStyle())
            }
            if let until = lock.lockedUntil {
                HStack {
                    Text("Locked until \(until.formatted(date: .omitted, time: .shortened))").font(.system(size: 13)).foregroundStyle(Phone.orange)
                    Spacer()
                    Button("Unlock now") { lock.release() }.font(.system(size: 13, weight: .semibold))
                }
            }
            if let problem = lock.problem { Text(problem).font(.footnote).foregroundStyle(Phone.orange) }
        }
        .familyActivityPicker(isPresented: $picking, selection: $lock.selection)
    }
}
