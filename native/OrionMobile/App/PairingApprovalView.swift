import SwiftUI
import CryptoKit
import MobileCore

/// The screen never claims pairing succeeded: signing is not server acceptance.
struct PairingApprovalView: View {
    let request: PairingApprovalRequest
    let approve: () -> Void
    let reject: () -> Void
    let finished: Bool
    let status: String
    @State private var compared = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let expired = context.date.timeIntervalSince1970 >= request.expiresAt
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Label("Disposable account test", systemImage: "testtube.2")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Text("Allow this device to pair?").font(.title2.bold())
                    Text("Compare this full key fingerprint with the device you are adding. A matching name alone is not enough.")
                    Text("Account: \(request.ownerID)").font(.footnote)
                    Text(request.joiningDeviceID).font(.headline).accessibilityIdentifier("joiningDeviceID")
                    Text(displayFingerprint).font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled).accessibilityLabel(fingerprint).accessibilityIdentifier("joiningFingerprint")
                    Text("This admits a device identity only. It does not approve messages, purchases or remote actions.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Toggle("I compared the key fingerprint", isOn: $compared)
                        .accessibilityIdentifier("comparedPairingKey").disabled(finished || expired)
                    Button("Approve this device", action: approve)
                        .buttonStyle(.borderedProminent)
                        .disabled(!compared || finished || expired).accessibilityIdentifier("approvePairing")
                    Button("Reject pairing", role: .destructive, action: reject)
                        .disabled(finished).accessibilityIdentifier("rejectPairing")
                    Text(expired && !finished ? "Pairing expired · start again" : status)
                        .accessibilityIdentifier("approvalStatus")
                }.padding()
            }
        }.navigationTitle("Review pairing")
    }

    private var displayFingerprint: String {
        let characters = Array(fingerprint)
        let groups = stride(from: 0, to: characters.count, by: 8).map {
            String(characters[$0..<min($0 + 8, characters.count)])
        }
        return groups.prefix(4).joined(separator: " ") + "\n" + groups.dropFirst(4).joined(separator: " ")
    }

    private var fingerprint: String {
        guard let bytes = Data(base64Encoded: request.joiningPublicKey) else { return "Invalid key" }
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}

#if targetEnvironment(simulator)
/// Test transport only. No file request is accepted by physical-device builds.
@MainActor
final class PairingApprovalTestBridge: ObservableObject {
    @Published private(set) var request: PairingApprovalRequest?
    @Published private(set) var finished = false
    @Published private(set) var status = "No pairing request"
    private let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

    func load(identity: PhoneDeviceIdentity) {
        guard request == nil, ProcessInfo.processInfo.arguments.contains("--pairing-approval-test") else { return }
        do {
            let url = directory.appendingPathComponent("pairing-approval-request.json")
            guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 4096,
                  let fingerprint = identity.identifier else { throw PairingApprovalRequest.ApprovalError.invalid }
            let value = try JSONDecoder().decode(PairingApprovalRequest.self, from: Data(contentsOf: url))
            try value.validate(expectedOwner: "pairing-test-owner", offeringFingerprint: fingerprint, now: Date())
            // Structural checks alone cannot establish that an EC point is on-curve.
            _ = try P256.Signing.PublicKey(x963Representation: Data(base64Encoded: value.joiningPublicKey)!)
            request = value
            status = "Awaiting your decision · no real account paired"
        } catch { status = "Pairing request refused" }
    }

    func decide(approve: Bool, identity: PhoneDeviceIdentity) {
        guard !finished, let request else { return }
        finished = true
        do {
            let signature = approve ? try identity.pairingConfirmation(request) : nil
            let response = Response(pairingID: request.pairingID, decision: approve ? "approve" : "reject", signature: signature)
            let url = directory.appendingPathComponent("pairing-approval-response.json")
            guard !FileManager.default.fileExists(atPath: url.path) else { throw PairingApprovalRequest.ApprovalError.invalid }
            try JSONEncoder().encode(response).write(to: url, options: [.atomic, .completeFileProtection])
            status = approve ? "Confirmation signed · awaiting service acceptance" : "Pairing rejected · no confirmation signed"
        } catch { status = "Pairing decision refused · start again" }
    }

    private struct Response: Encodable {
        let pairingID: String
        let decision: String
        let signature: String?
    }
}
#endif
