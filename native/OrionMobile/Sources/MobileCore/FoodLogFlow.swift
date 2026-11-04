import Foundation

/*
 "Log food" as one flow (wave 18). Tapping Log food opens the camera at once; inside it a small library button and
 a "type it instead" option swap the input, and once there is something to send a brief "Sending to ORION" toast
 stands in for a sheet. This is only the decision table; the views read `stage` and the app does the sending
 (FoodPhotoSender, unchanged) and the permission lookup.
*/
public struct FoodLogFlow: Equatable {
    public enum Stage: Equatable { case idle, camera, library, typing, sending, sent, failed(String) }
    public enum CameraAccess: Equatable { case authorized, notDetermined, denied, restricted, unavailable }
    public enum Event: Equatable {
        case open(CameraAccess)
        case switchToLibrary, switchToTyping
        /// A photo came back from the camera or the library.
        case gotPhoto
        case sendTyped
        case cancel
        case finished(failure: String?)
        case retry
        case dismissToast
    }

    public let stage: Stage
    /// A plain line to show over the library when the camera could not open.
    public let notice: String?

    public init(stage: Stage = .idle, notice: String? = nil) { self.stage = stage; self.notice = notice }

    public var showsCamera: Bool { stage == .camera }
    public var showsLibrary: Bool { stage == .library }
    public var showsTyping: Bool { stage == .typing }
    public var showsToast: Bool {
        switch stage { case .sending, .sent, .failed: return true; default: return false }
    }

    public func applying(_ event: Event) -> FoodLogFlow {
        switch (stage, event) {
        case (.idle, .open(let access)), (.sent, .open(let access)), (.failed, .open(let access)):
            return Self.opening(access)
        case (.camera, .switchToLibrary), (.typing, .switchToLibrary):
            return FoodLogFlow(stage: .library)
        case (.camera, .switchToTyping), (.library, .switchToTyping):
            return FoodLogFlow(stage: .typing)
        case (.camera, .gotPhoto), (.library, .gotPhoto), (.typing, .sendTyped):
            return FoodLogFlow(stage: .sending)
        case (.camera, .cancel), (.library, .cancel), (.typing, .cancel):
            return FoodLogFlow()
        case (.sending, .finished(let failure)):
            return FoodLogFlow(stage: failure.map { .failed($0) } ?? .sent)
        case (.failed, .retry):
            return FoodLogFlow(stage: .sending)
        case (.sent, .dismissToast), (.failed, .dismissToast):
            return FoodLogFlow()
        default:
            return self
        }
    }

    private static func opening(_ access: CameraAccess) -> FoodLogFlow {
        switch access {
        case .authorized, .notDetermined:
            return FoodLogFlow(stage: .camera)
        case .denied, .restricted:
            return FoodLogFlow(stage: .library, notice: "The camera is off for ORION. Choose a photo instead, or turn the camera on in Settings.")
        case .unavailable:
            return FoodLogFlow(stage: .library, notice: "This device has no camera. Choose a photo instead.")
        }
    }
}
