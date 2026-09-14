import SwiftUI
import MobileCore

@main
struct OrionMobileApp: App {
    var body: some Scene { WindowGroup { PhoneRootView() } }
}

struct PhoneRootView: View {
    @State private var sample: TodayPlan?
    @State private var sampleError: String?
    private let sampleNow = Date(timeIntervalSince1970: 1_788_948_000) // 2026-09-09 10:00 UTC

    var body: some View {
        TabView {
            NavigationStack { today }.tabItem { Label("Today", systemImage: "sun.max") }
            NavigationStack { plan }.tabItem { Label("Plan", systemImage: "calendar") }
            NavigationStack {
                unavailable("Your conversation", icon: "waveform", detail: "Connect your Mac before starting a conversation. Messaging is not available in this build.")
                    .navigationTitle("ORION")
            }.tabItem { Label("ORION", systemImage: "waveform") }
            NavigationStack {
                unavailable("No health sources connected", icon: "heart", detail: "This phone has not read any health records. Your Mac’s readings are not synced here yet.")
                    .navigationTitle("Health")
            }.tabItem { Label("Health", systemImage: "heart") }
            NavigationStack { control }.tabItem { Label("Control", systemImage: "slider.horizontal.3") }
        }
        .tint(.indigo)
    }

    private var today: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                connectionNotice
                if let sample {
                    sampleNotice
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Room for what matters").font(.title2.bold())
                        Text("A sample day with focused work, a fixed commitment and time left open.").foregroundStyle(.secondary)
                    }
                    summary("NOW · SAMPLE", value: sample.current(at: sampleNow)?.title ?? "Open time")
                    summary("NEXT COMMITMENT · SAMPLE", value: sample.nextCommitment(at: sampleNow)?.title ?? "None in this example")
                    summary("FREE TIME · SAMPLE", value: "\(sample.freeMinutes(after: sampleNow)) minutes in this example")
                    Button("Close sample", role: .cancel) { self.sample = nil }.accessibilityIdentifier("closeSample")
                } else {
                    unavailable("Your day will appear here", icon: "sun.max", detail: "Your Mac’s calendar, tasks and saved plan are not connected to this phone yet.")
                    Button("Explore a sample day", action: loadSample)
                        .buttonStyle(.borderedProminent).accessibilityIdentifier("openSample")
                    Text("Example data only. No account or permissions needed.").font(.footnote).foregroundStyle(.secondary)
                }
                if let sampleError { Text(sampleError).foregroundStyle(.red) }
            }.padding()
        }.navigationTitle("Today")
    }

    private var plan: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                connectionNotice
                if let sample {
                    sampleNotice
                    Text("Wednesday, 9 September · London time").font(.headline)
                    ForEach(sample.blocks) { block in
                        HStack(alignment: .top, spacing: 16) {
                            Text(time(block.start)).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(block.title).font(.headline)
                                Text("\(block.minutes) min · \(block.kind.rawValue)").font(.caption).foregroundStyle(.secondary)
                            }
                        }.accessibilityElement(children: .combine)
                        Divider()
                    }
                    ForEach(sample.warnings, id: \.self) { Text($0).font(.footnote) }
                } else {
                    unavailable("No plan loaded", icon: "calendar", detail: "Connect a source in a future build, or explore the sample day from Today.")
                }
            }.padding()
        }.navigationTitle("Plan")
    }

    private var control: some View {
        List {
            Section("Connection") {
                Label("Not connected", systemImage: "link.badge.plus")
                Text("Mac availability is unknown. This build has no pairing or network connection.").foregroundStyle(.secondary)
            }
            Section("On this phone") {
                Text("No account signed in")
                Text("No personal records loaded")
                Text("Sample data is temporary and clears when the app closes.").foregroundStyle(.secondary)
            }
            Section("Build scope") {
                Text("Simulator foundation · read-only sample")
                Text("Pairing, sync, chat, notifications and remote actions are not available yet.").foregroundStyle(.secondary)
            }
        }.navigationTitle("Control")
    }

    private var connectionNotice: some View {
        Label("Not connected to your Mac", systemImage: "link.badge.plus")
            .font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("connectionStatus")
    }
    private var sampleNotice: some View {
        Label("SAMPLE DATA · Not your real day", systemImage: "info.circle")
            .font(.subheadline.bold()).padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(.indigo.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityIdentifier("sampleNotice")
    }
    private func summary(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold))
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func unavailable(_ title: String, icon: String, detail: String) -> some View {
        ContentUnavailableView(title, systemImage: icon, description: Text(detail))
    }
    private func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = TimeZone(identifier: "Europe/London")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
    private func loadSample() {
        do {
            sample = try TodayPlanScheduler.propose(
                now: sampleNow, timeZone: "Europe/London", preferences: TodayPlanPreferences(),
                tasks: [TodayPlanTask(id: "example-reading", title: "Read for tomorrow’s seminar", minutes: 45, priority: 2),
                        TodayPlanTask(id: "example-outline", title: "Outline a project idea", minutes: 30, priority: 1)],
                commitments: [TodayPlanCommitment(id: "example-seminar", title: "Afternoon seminar", start: sampleNow.addingTimeInterval(4 * 3600), end: sampleNow.addingTimeInterval(5 * 3600))],
                reason: "Example day for exploring the phone app", sourceFingerprint: "phone-sample-v1")
            sampleError = nil
        } catch { sampleError = "The sample could not be loaded." }
    }
}
