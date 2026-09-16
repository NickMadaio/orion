import SwiftUI
import Security
import CryptoKit
import MobileCore

@MainActor
final class PhoneDeviceIdentity: ObservableObject {
    @Published private(set) var identifier: String?
    @Published private(set) var status = "Identity not loaded"
    @Published private(set) var verified = false
    private var key: SecKey?
    private var readyStatus = "Identity not loaded"
    private var failureCode: Int?
    private let tag = Data("com.nickmadaio.orion.phone.device-key.v1".utf8)

    init() { load() }

    func load() {
        verified = false
        failureCode = nil
        do {
            let stored = try readKey() ?? createKey()
            guard let attributes = SecKeyCopyAttributes(stored) as? [String: Any],
                  attributes[kSecAttrKeyType as String] as? String == kSecAttrKeyTypeECSECPrimeRandom as String,
                  (attributes[kSecAttrKeySizeInBits as String] as? NSNumber)?.intValue == 256,
                  let publicKey = SecKeyCopyPublicKey(stored),
                  let publicBytes = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
                throw IdentityFailure.invalid
            }
            #if targetEnvironment(simulator)
            let description = "Simulator key · software-backed · not paired"
            #else
            guard attributes[kSecAttrTokenID as String] as? String == kSecAttrTokenIDSecureEnclave as String else {
                throw IdentityFailure.invalid
            }
            let description = "Secure Enclave key · not paired"
            #endif
            key = stored
            identifier = SHA256.hash(data: publicBytes).map { String(format: "%02x", $0) }.joined()
            readyStatus = description
            status = description
        } catch {
            key = nil; identifier = nil
            status = "Identity unavailable · unlock this device and retry" + (failureCode.map { " (\($0))" } ?? "")
        }
    }

    /// Prove local possession only. This does not register a device or approve an action.
    func verifyLocalKey() {
        verified = false
        guard let key, let publicKey = SecKeyCopyPublicKey(key) else { return }
        let challenge = Data("orion-local-key-check-v1|\(UUID().uuidString)".utf8)
        let algorithm = SecKeyAlgorithm.ecdsaSignatureMessageX962SHA256
        guard SecKeyIsAlgorithmSupported(key, .sign, algorithm),
              let signature = SecKeyCreateSignature(key, algorithm, challenge as CFData, nil),
              SecKeyVerifySignature(publicKey, algorithm, challenge as CFData, signature, nil),
              !SecKeyVerifySignature(publicKey, algorithm, Data("different challenge".utf8) as CFData, signature, nil) else {
            status = "Local key verification failed"; return
        }
        status = readyStatus
        verified = true
    }

    /// Only this protocol message is signable; callers cannot supply arbitrary bytes.
    func pairingClaim(pairingID: String, nonce: String) throws -> PairingClaimProof {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        guard (16...96).contains(pairingID.utf8.count), (32...128).contains(nonce.utf8.count),
              pairingID.unicodeScalars.allSatisfy({ allowed.contains($0) }),
              nonce.unicodeScalars.allSatisfy({ allowed.contains($0) }),
              let key, let publicKey = SecKeyCopyPublicKey(key),
              let bytes = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?,
              bytes.count == 65, bytes.first == 4 else { throw IdentityFailure.invalid }
        let wireKey = bytes.base64EncodedString()
        let message = Data(DeviceManagement.pairingClaimMessage(pairingID: pairingID, nonce: nonce, publicKey: wireKey).utf8)
        guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, message as CFData, nil) as Data? else {
            throw IdentityFailure.unavailable
        }
        return PairingClaimProof(pairingID: pairingID, publicKey: wireKey,
                                 algorithm: "p256-sha256-der-v1", signature: signature.base64EncodedString())
    }

    #if targetEnvironment(simulator)
    func pairingConfirmation(_ request: PairingApprovalRequest) throws -> String {
        guard let key, let identifier else { throw IdentityFailure.unavailable }
        // The caller must supply the authenticated account in a production route.
        // Only the isolated test bridge currently invokes this operation.
        try request.validate(expectedOwner: "pairing-test-owner", offeringFingerprint: identifier, now: Date())
        _ = try P256.Signing.PublicKey(x963Representation: Data(base64Encoded: request.joiningPublicKey)!)
        guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256,
                Data(request.confirmationMessage.utf8) as CFData, nil) as Data? else { throw IdentityFailure.unavailable }
        return signature.base64EncodedString()
    }

    @Published var pairingTestStatus = "Awaiting test claim"
    /// Local file bridge for interoperability testing. Never compiled for a physical phone.
    func writeTestPairingProof() {
        guard ProcessInfo.processInfo.arguments.contains("--pairing-proof-test") else { return }
        do {
            let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let requestURL = directory.appendingPathComponent("pairing-test-request.json")
            let responseURL = directory.appendingPathComponent("pairing-test-response.json")
            guard !FileManager.default.fileExists(atPath: responseURL.path),
                  let size = try requestURL.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 4096 else {
                throw IdentityFailure.invalid
            }
            let request = try JSONDecoder().decode(PairingTestRequest.self, from: Data(contentsOf: requestURL))
            let remaining = request.expiresAt - Date().timeIntervalSince1970
            guard request.schema == 1, remaining > 0, remaining <= 120 else { throw IdentityFailure.invalid }
            let proof = try pairingClaim(pairingID: request.pairingID, nonce: request.nonce)
            try JSONEncoder().encode(proof).write(to: responseURL, options: [.atomic, .completeFileProtection])
            pairingTestStatus = "Test claim signed · no account paired"
        } catch { pairingTestStatus = "Test claim refused" }
    }
    private struct PairingTestRequest: Decodable {
        let schema: Int
        let pairingID: String
        let nonce: String
        let expiresAt: Double
    }
    #endif

    private func readKey() throws -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecReturnRef as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let code = SecItemCopyMatching(query as CFDictionary, &result)
        if code == errSecItemNotFound { return nil }
        guard code == errSecSuccess, let result, CFGetTypeID(result) == SecKeyGetTypeID() else {
            failureCode = Int(code)
            print("Device identity lookup failed: OSStatus \(code)")
            throw IdentityFailure.unavailable
        }
        return (result as! SecKey)
    }

    private func createKey() throws -> SecKey {
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                         .privateKeyUsage, nil) else { throw IdentityFailure.unavailable }
        var parameters: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag,
                kSecAttrAccessControl as String: access
            ]
        ]
        #if !targetEnvironment(simulator)
        parameters[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
        #endif
        var failure: Unmanaged<CFError>?
        if let created = SecKeyCreateRandomKey(parameters as CFDictionary, &failure) { return created }
        // Another scene may have created the same persistent key first.
        if let failure {
            let code = CFErrorGetCode(failure.takeRetainedValue())
            if code == errSecDuplicateItem, let existing = try readKey() { return existing }
            failureCode = code
            print("Device identity creation failed: OSStatus \(code)")
        }
        throw IdentityFailure.unavailable
    }
    private enum IdentityFailure: Error { case unavailable, invalid }
}

struct PairingClaimProof: Encodable {
    let pairingID: String
    let publicKey: String
    let algorithm: String
    let signature: String
}
