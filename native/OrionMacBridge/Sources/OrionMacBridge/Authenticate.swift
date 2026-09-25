import Foundation
import LocalAuthentication

/*
 Owner re-authentication (Phase 43: "requires reauthentication for sensitive
 operations").

 `orion-mac-bridge authenticate --reason "…"` asks macOS to confirm the Mac's
 owner is present -- Touch ID where there is a sensor, the account password
 otherwise -- and exits 0 only on success. The prompt is drawn by the system,
 not by Orion, so nothing Orion can type or click is an answer to it. Exit
 codes are the whole interface: 0 confirmed, 1 refused or cancelled, 2 no way
 to ask (no user session, no password set).
*/
enum OwnerAuthentication {
    static func run(arguments: [String]) async -> Int32 {
        guard let index = arguments.firstIndex(of: "--reason"), index + 1 < arguments.count,
              case let reason = arguments[index + 1].trimmingCharacters(in: .whitespacesAndNewlines),
              !reason.isEmpty, reason.count <= 200 else {
            FileHandle.standardError.write(Data("authenticate needs --reason \"what is being confirmed\" (1-200 characters)\n".utf8))
            return 2
        }
        let context = LAContext()
        context.localizedFallbackTitle = "Use Password"
        var problem: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &problem) else {
            FileHandle.standardError.write(Data("owner authentication unavailable: \(problem?.localizedDescription ?? "unknown")\n".utf8))
            return 2
        }
        do {
            let confirmed = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
            return confirmed ? 0 : 1
        } catch {
            FileHandle.standardError.write(Data("not confirmed: \(error.localizedDescription)\n".utf8))
            return 1
        }
    }
}
