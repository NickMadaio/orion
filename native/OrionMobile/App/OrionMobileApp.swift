import SwiftUI
import Security
import CryptoKit
import MobileCore

@main
struct OrionMobileApp: App {
    var body: some Scene { WindowGroup { PhoneRootView() } }
}

struct PhoneRootView: View {
    @StateObject private var reader = PhoneTodayReader()
    @StateObject private var identity = PhoneDeviceIdentity()
    #if targetEnvironment(simulator)
    @StateObject private var pairingApproval = PairingApprovalTestBridge()
    @State private var reviewedSetup: PhoneHTTPReadSession.Bootstrap?
    @State private var setupStatus = "Review the local connection before loading a reading."
    @State private var connectionTask: Task<Void, Never>?
    @State private var rememberConnection = false
    @AppStorage("orion.rememberedLocalConnection.v1") private var rememberedConnectionData = Data()
    private var rememberedConnection: RememberedLocalConnection? {
        guard let fingerprint = identity.identifier else { return nil }
        return try? RememberedLocalConnection.decode(rememberedConnectionData, expectedFingerprint: fingerprint)
    }
    private var reviewsConnection: Bool { ProcessInfo.processInfo.arguments.contains("--review-http-session") }
    #endif
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
        .task {
            #if targetEnvironment(simulator)
            if reviewsConnection {
                do { reviewedSetup = try PhoneHTTPReadSession.loadSetup() }
                catch { setupStatus = "Connection setup is unavailable. Start a new preview on your Mac." }
            } else if ProcessInfo.processInfo.arguments.contains("--http-session-test") {
                await PhoneHTTPReadSession.connect(identity: identity, reader: reader)
            }
            #endif
            await reader.refresh()
        }
    }

    #if targetEnvironment(simulator)
    private var connectionSetup: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let setup = reviewedSetup {
                Text("Review local connection").font(.headline)
                Text("This Simulator can read the saved plan shared by the local service on this Mac. It cannot change your plan.")
                Text("Local address: 127.0.0.1:\(setup.port)")
                    .font(.caption.monospaced()).accessibilityIdentifier("setupAddress")
                Text("Temporary test account · access lasts up to five minutes. No account is signed in. Disconnect from Control to clear the reading.")
                    .font(.footnote).foregroundStyle(.secondary)
                Toggle("Remember this connection", isOn: $rememberConnection)
                    .accessibilityIdentifier("rememberReadConnection")
                Text("Saves connection details only. A fresh approval is still needed to connect again.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Connect and read plan") {
                    let shouldRemember = rememberConnection
                    reviewedSetup = nil
                    setupStatus = "Connecting to the local service…"
                    connectionTask = Task {
                        await PhoneHTTPReadSession.connect(identity: identity, reader: reader, reviewedSetup: setup)
                        if !Task.isCancelled {
                            await reader.refresh()
                            if !Task.isCancelled {
                                setupStatus = "Start a new preview on your Mac to connect again."
                                if shouldRemember, reader.available, let fingerprint = identity.identifier {
                                    do {
                                        let value = try RememberedLocalConnection(port: setup.port, ownerID: setup.owner,
                                            deviceID: setup.device, phoneFingerprint: fingerprint)
                                        rememberedConnectionData = try JSONEncoder().encode(value)
                                    } catch { setupStatus = "Reading loaded, but connection details could not be saved." }
                                }
                                connectionTask = nil
                            }
                        }
                    }
                }.accessibilityIdentifier("approveReadConnection")
                Button("Not now", role: .cancel) {
                    reviewedSetup = nil
                    setupStatus = "Connection declined · no reading loaded"
                }.accessibilityIdentifier("declineReadConnection")
            } else {
                Text(setupStatus).accessibilityIdentifier("setupStatus")
                if connectionTask != nil {
                    Button("Cancel connection", role: .cancel) {
                        connectionTask?.cancel(); connectionTask = nil
                        reader.disconnect()
                        setupStatus = "Connection cancelled · no reading loaded"
                    }.accessibilityIdentifier("cancelReadConnection")
                }
            }
        }
    }
    #endif

    private var today: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                connectionNotice
                #if targetEnvironment(simulator)
                if reviewsConnection && (!reader.configured || connectionTask != nil) { connectionSetup }
                #endif
                if reader.configured {
                    connectedReading
                } else if let sample {
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
                if reader.configured {
                    connectedReading
                } else if let sample {
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
            Section("Device identity") {
                Text(identity.status).accessibilityIdentifier("deviceIdentityStatus")
                if let identifier = identity.identifier {
                    Text(identifier).font(.caption.monospaced()).textSelection(.enabled)
                        .accessibilityIdentifier("deviceIdentityID")
                    Button("Verify local key") { identity.verifyLocalKey() }
                        .accessibilityIdentifier("verifyDeviceKey")
                    if identity.verified {
                        Text("Local key verified · no account paired")
                            .accessibilityIdentifier("deviceKeyVerified")
                    }
                } else {
                    Button("Retry identity") { identity.load() }
                }
            }
            #if targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--read-session-test") {
                Section("Device session test") {
                    Text("Disposable account · local read access only")
                    Button("Sign read-session challenge") { identity.writeTestReadSessionProof() }
                        .accessibilityIdentifier("signReadSession")
                    Text(identity.readSessionTestStatus).accessibilityIdentifier("readSessionProofStatus")
                }
            }
            if ProcessInfo.processInfo.arguments.contains("--pairing-approval-test") {
                Section("Pairing test") {
                    if let request = pairingApproval.request {
                        NavigationLink("Review pairing request") {
                            PairingApprovalView(request: request,
                                approve: { pairingApproval.decide(approve: true, identity: identity) },
                                reject: { pairingApproval.decide(approve: false, identity: identity) },
                                finished: pairingApproval.finished, status: pairingApproval.status)
                        }.accessibilityIdentifier("reviewPairing")
                    } else { Text(pairingApproval.status).accessibilityIdentifier("approvalLoadStatus") }
                }.onAppear { pairingApproval.load(identity: identity) }
            }
            if ProcessInfo.processInfo.arguments.contains("--pairing-proof-test") {
                Section("Disposable pairing test") {
                    Text("Test account only · no real account will be paired")
                    Button("Sign test pairing claim") { identity.writeTestPairingProof() }
                        .accessibilityIdentifier("signTestPairing")
                    Text(identity.pairingTestStatus).accessibilityIdentifier("pairingTestStatus")
                }
            }
            #endif
            #if targetEnvironment(simulator)
            if !rememberedConnectionData.isEmpty {
                Section("Remembered connection") {
                    if let saved = rememberedConnection {
                        Text("Local preview · 127.0.0.1:\(saved.port)")
                            .accessibilityIdentifier("rememberedConnectionAddress")
                        Text("Temporary test account. Remembered details do not grant access or reconnect automatically.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Text("Saved connection details cannot be verified for this phone.")
                    }
                    Button("Forget connection", role: .destructive) {
                        connectionTask?.cancel(); connectionTask = nil
                        reader.disconnect()
                        rememberedConnectionData = Data()
                        reviewedSetup = nil; rememberConnection = false
                        setupStatus = "Connection forgotten · start a new preview to connect again."
                    }.accessibilityIdentifier("forgetReadConnection")
                }
            }
            #endif
            Section("Connection") {
                Text(reader.message)
                if reader.cancelledPendingRead {
                    Text("Pending refresh cancelled").accessibilityIdentifier("cancelledPendingRead")
                }
                if reader.configured {
                    Button("Disconnect this reading", role: .destructive) { reader.disconnect() }
                        .accessibilityIdentifier("disconnectReading")
                    Text("Clears this phone’s reading and local access token. It does not remove the device from an account.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Text("Mac availability is unknown. A Simulator-only local read connection can be configured for development; physical-device pairing is not available.").foregroundStyle(.secondary)
            }
            Section("On this phone") {
                Text("No account signed in")
                Text(reader.configured ? "Local development snapshot · memory only" : "No personal records loaded")
                Text("Sample data is temporary and clears when the app closes.").foregroundStyle(.secondary)
            }
            Section("Build scope") {
                Text("Simulator foundation · read-only sample")
                Text("Pairing, sync, chat, notifications and remote actions are not available yet.").foregroundStyle(.secondary)
            }
        }.navigationTitle("Control")
    }

    private var connectionNotice: some View {
        Label(reader.message, systemImage: "link.badge.plus")
            .font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("connectionStatus")
    }
    private var connectedReading: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("LOCAL DEVELOPMENT CONNECTION").font(.caption.bold())
            Button(reader.loading ? "Refreshing…" : "Refresh reading") { Task { await reader.refresh() } }
                .disabled(reader.loading).accessibilityIdentifier("refreshReading")
            TimelineView(.periodic(from: .now, by: 10)) { context in
                VStack(alignment: .leading, spacing: 12) {
                    if let snapshot = reader.snapshot {
                        let current = reader.available && snapshot.isCurrent(at: context.date)
                        Text(current ? "Recent plan reading" : "Stale plan reading · refresh sources on your Mac")
                            .accessibilityIdentifier("readingFreshness")
                        Text("Revision \(snapshot.revision)").accessibilityIdentifier("readingRevision")
                        if let plan = snapshot.plan {
                            Text(plan.reason).accessibilityIdentifier("readingReason")
                            Text("Plan created \(plan.generatedAt.formatted(date: .abbreviated, time: .shortened))")
                                .font(.footnote).foregroundStyle(.secondary)
                            ForEach(plan.blocks) { block in
                                VStack(alignment: .leading) {
                                    Text(block.title)
                                    Text("\(block.minutes) minutes").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        } else { Text("No accepted plan in this snapshot") }
                    } else { Text("No verified reading loaded") }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
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

/// Explicit Simulator development connection. No bootstrap reader exists on physical iOS.
@MainActor
final class PhoneTodayReader: ObservableObject {
    struct Bootstrap: Decodable { let port: Int; let owner: String; let token: String }
    @Published private(set) var snapshot: TodayReadSnapshot?
    @Published private(set) var message = "Not connected to your Mac"
    @Published private(set) var loading = false
    @Published private(set) var available = false
    @Published private(set) var cancelledPendingRead = false
    private var bootstrap: Bootstrap?
    private var history = TodayReadHistory()
    private var connectionGeneration = UUID()
    private var activeRead: URLSession?
    var configured: Bool { bootstrap != nil }

    init() {
        #if targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--local-today"),
           !ProcessInfo.processInfo.arguments.contains("--http-session-test"),
           !ProcessInfo.processInfo.arguments.contains("--review-http-session"),
           let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
           let data = try? Data(contentsOf: directory.appendingPathComponent("local-today.json")), data.count < 4096,
           let value = try? JSONDecoder().decode(Bootstrap.self, from: data),
           (1...65535).contains(value.port), !value.owner.isEmpty,
           value.token.count >= 32, value.token.count <= 128,
           value.token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) {
            bootstrap = value
            message = "Local development source · not checked"
        } else { bootstrap = nil }
        #else
        bootstrap = nil
        #endif
    }
    #if targetEnvironment(simulator)
    func useDeviceSession(port: Int, owner: String, token: String) throws {
        guard (1...65535).contains(port), !owner.isEmpty, (32...128).contains(token.count),
              token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { throw TodayPlanError.invalidInput }
        disconnect()
        cancelledPendingRead = false
        bootstrap = Bootstrap(port: port, owner: owner, token: token)
        message = "Local device session · not checked"
    }
    func refuseDeviceSession() {
        disconnect()
        cancelledPendingRead = false
        message = "Device session could not be verified"
    }
    #endif

    func disconnect() {
        // Invalidates already-delivered bytes as well as cancelling transport.
        cancelledPendingRead = loading
        connectionGeneration = UUID()
        activeRead?.invalidateAndCancel(); activeRead = nil
        bootstrap = nil; history.clear(); snapshot = nil
        available = false; loading = false
        message = "Reading disconnected"
    }

    func refresh() async {
        guard let bootstrap, !loading else { return }
        let generation = connectionGeneration
        loading = true
        defer { if generation == connectionGeneration { loading = false; activeRead = nil } }
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 5; config.timeoutIntervalForResource = 8
        let session = URLSession(configuration: config, delegate: NoReadRedirect(), delegateQueue: nil)
        activeRead = session
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(bootstrap.port)/plan")!)
        request.setValue("Bearer \(bootstrap.token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard generation == connectionGeneration else { return }
            guard let http = response as? HTTPURLResponse else { throw TodayPlanError.invalidInput }
            if http.statusCode == 401 { history.clear(); snapshot = nil; available = false; message = "Access expired or revoked"; return }
            if http.statusCode == 404 { snapshot = nil; available = false; message = "No published plan"; return }
            guard http.statusCode == 200 else { throw URLError(.badServerResponse) }
            guard http.mimeType == "application/json", response.expectedContentLength <= 1_100_000 else { throw TodayPlanError.invalidInput }
            var data = Data()
            for try await byte in bytes {
                guard data.count < 1_100_000 else { throw TodayPlanError.invalidInput }
                data.append(byte)
            }
            guard generation == connectionGeneration else { return }
            let incoming = try TodayReadSnapshot.decodeResponse(data, expectedOwner: bootstrap.owner)
            try history.receive(incoming)
            snapshot = incoming; available = true; message = "Read from local development service"
        } catch is URLError {
            guard generation == connectionGeneration else { return }
            available = false; message = "Source unavailable · last reading may be out of date"
        } catch {
            guard generation == connectionGeneration else { return }
            snapshot = nil; available = false; message = "Plan response could not be verified"
        }
    }
}

final class NoReadRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

// Platform adapter kept outside MobileCore. No private-key bytes are exported.
