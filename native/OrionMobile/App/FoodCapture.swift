import AVFoundation
import CloudKit
import PhotosUI
import SwiftUI
import UIKit
import MobileCore

/*
 "Log food" (wave 18): one tap opens the camera, no sheet in between. Inside the camera a small library button and a
 "Type it" pill swap the input; after the shot a brief "Sending to ORION" toast says it is on its way. The send is
 the same FoodPhoto record as before (FoodPhotoSender below); ORION Link writes the food inbox and the Mac's
 estimator logs it (FoodPhotoSchema has the contract). Where the camera cannot open (Simulator, permission off) a
 small card says so and offers the library, Settings or typing. The decisions live in MobileCore/FoodLogFlow.
*/
extension View {
    /// Flip `trigger` to true to start logging food. Presents the camera, library, typing card and the toast.
    func foodLogging(trigger: Binding<Bool>, remote: RemoteStore, conversationID: String?) -> some View {
        modifier(FoodLogging(trigger: trigger, remote: remote, conversationID: conversationID))
    }
}

private struct FoodLogging: ViewModifier {
    @Binding var trigger: Bool
    @ObservedObject var remote: RemoteStore
    let conversationID: String?

    @State private var flow = FoodLogFlow()
    @State private var photo: UIImage?
    @State private var picked: PhotosPickerItem?
    @State private var pickerOpen = false
    @State private var typed = ""
    @State private var enteringNumbers = false
    /// False for a beat after the stage changes, so a sheet never opens while the camera cover is still closing.
    @State private var settled = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private func send(_ event: FoodLogFlow.Event) { flow = flow.applying(event) }
    private var hasFallback: Bool { flow.showsLibrary && flow.notice != nil }

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) { toast }
            .onChange(of: trigger) { _, wanted in
                guard wanted else { return }
                trigger = false
                send(.open(Self.access()))
            }
            .onChange(of: flow.stage) { _, stage in
                if stage == .idle { pickerOpen = false }
                settled = false
                Task {
                    try? await Task.sleep(nanoseconds: 450_000_000)
                    settled = true
                    if flow.stage == .library, flow.notice == nil { pickerOpen = true }
                }
            }
            .fullScreenCover(isPresented: stageBinding(flow.showsCamera)) {
                CameraPicker(onPhoto: { taken in photo = taken; send(.gotPhoto); upload() },
                             onLibrary: { send(.switchToLibrary) }, onType: { send(.switchToTyping) },
                             onCancel: { send(.cancel) })
                    .ignoresSafeArea()
            }
            .photosPicker(isPresented: Binding(get: { pickerOpen && !hasFallback && flow.showsLibrary }, set: pickerClosed),
                          selection: $picked, matching: .images)
            .sheet(isPresented: stageBinding(hasFallback && settled)) { fallback }
            .sheet(isPresented: stageBinding(flow.showsTyping && settled)) { typing }
            .onChange(of: picked) { _, item in Task { await load(item) } }
    }

    // MARK: Presentation

    /// A cover or sheet that follows the flow; dragging it away cancels.
    private func stageBinding(_ shown: Bool) -> Binding<Bool> {
        Binding(get: { shown }, set: { if !$0, [.camera, .library, .typing].contains(flow.stage) { send(.cancel) } })
    }

    private func pickerClosed(_ open: Bool) {
        pickerOpen = open
        // Closed without a pick: back out, unless the fallback card is still there to return to.
        if !open, flow.showsLibrary, picked == nil, flow.notice == nil { send(.cancel) }
    }

    private var fallback: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("FOOD").font(Phone.mono(10.5)).tracking(2.2).foregroundStyle(Phone.orange)
            Text(flow.notice ?? "").font(.system(size: 21, design: .serif)).foregroundStyle(Phone.text)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 12) {
                Button { pickerOpen = true } label: { Label("Choose a photo", systemImage: "photo.on.rectangle") }
                    .buttonStyle(PhoneButtonStyle(prominent: true)).accessibilityIdentifier("pickFoodPhoto")
                HStack(spacing: 12) {
                    Button { send(.switchToTyping) } label: { Label("Type it", systemImage: "keyboard") }
                        .buttonStyle(PhoneButtonStyle(tint: Phone.soft))
                    if AVCaptureDevice.authorizationStatus(for: .video) == .denied {
                        Button("Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                        .buttonStyle(PhoneButtonStyle(tint: Phone.soft))
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(24).frame(maxWidth: .infinity, alignment: .leading)
        .background(PhoneBackdrop())
        .photosPicker(isPresented: Binding(get: { pickerOpen && hasFallback }, set: { pickerOpen = $0 }),
                      selection: $picked, matching: .images)
        .presentationDetents([.height(320)])
    }

    private var typing: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("FOOD").font(Phone.mono(10.5)).tracking(2.2).foregroundStyle(Phone.orange)
            Text("What did you eat?").font(.system(size: 24, design: .serif)).foregroundStyle(Phone.text)
            TextField("two eggs on toast, half the rice", text: $typed, axis: .vertical)
                .lineLimit(1...4).font(.system(size: 16)).padding(.horizontal, 18).padding(.vertical, 12)
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Phone.wash(0.16), lineWidth: 1))
                .accessibilityIdentifier("foodNote")
            HStack(spacing: 12) {
                Button { sendTyped() } label: { Label("Send to ORION", systemImage: "arrow.up") }
                    .buttonStyle(PhoneButtonStyle(prominent: true))
                    .disabled(FoodPhotoSchema.cleanNote(typed).isEmpty)
                    .accessibilityIdentifier("sendFoodPhoto")
                Button("Add numbers") { enteringNumbers = true }.buttonStyle(PhoneButtonStyle(tint: Phone.soft))
            }
            Spacer(minLength: 0)
        }
        .padding(24).frame(maxWidth: .infinity, alignment: .leading)
        .background(PhoneBackdrop())
        .presentationDetents([.height(340)])
        .sheet(isPresented: $enteringNumbers) {
            FoodSheet(remote: remote, recents: remote.tracking?.recentFoods ?? [])
        }
    }

    @ViewBuilder private var toast: some View {
        if flow.showsToast {
            HStack(spacing: 10) {
                switch flow.stage {
                case .failed(let why):
                    Image(systemName: "exclamationmark.circle").foregroundStyle(Phone.orange)
                    Text(why).font(.system(size: 13)).foregroundStyle(Phone.text).lineLimit(2)
                    Button("Retry") { send(.retry); upload() }
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Phone.accent).frame(minHeight: 44)
                case .sent:
                    Image(systemName: "checkmark").foregroundStyle(Phone.green)
                    Text("Sent to ORION").font(.system(size: 13, weight: .medium)).foregroundStyle(Phone.text)
                default:
                    ProgressView().controlSize(.small).tint(Phone.accent)
                    Text("Sending to ORION…").font(.system(size: 13, weight: .medium)).foregroundStyle(Phone.text)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 6)
            .background(Capsule().fill(Phone.ink.opacity(0.92)))
            .overlay(Capsule().strokeBorder(Phone.accent.opacity(0.55), lineWidth: 1))
            .shadow(color: Phone.accent.opacity(0.25), radius: 8)
            .padding(.top, 8)
            .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            .accessibilityElement(children: .combine).accessibilityIdentifier("foodToast")
            .task(id: flow.stage) {
                guard flow.stage == .sent || flow.stage != .sending else { return }
                try? await Task.sleep(nanoseconds: flow.stage == .sent ? 1_800_000_000 : 7_000_000_000)
                if !Task.isCancelled { withAnimation(PhoneMotion.spring(PhoneMotion.enter, reduce: reduceMotion)) { send(.dismissToast) } }
            }
        }
    }

    // MARK: Work

    static func access() -> FoodLogFlow.CameraAccess {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { return .unavailable }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .authorized
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        default: return .restricted
        }
    }

    private func load(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        defer { picked = nil }
        guard let data = try? await item.loadTransferable(type: Data.self), let loaded = UIImage(data: data) else {
            flow = FoodLogFlow(stage: .failed("That photo could not be opened."))
            return
        }
        photo = loaded
        pickerOpen = false
        send(.gotPhoto)
        upload()
    }

    private func upload() {
        guard let image = photo else { return }
        let id = UUID().uuidString
        Task {
            let outcome = await FoodPhotoSender.send(image, id: id, note: "")
            if case .failed(let why) = outcome { send(.finished(failure: why)); return }
            photo = nil
            remote.noteFoodPhoto(id: id, note: "", conversation: conversationID)
            send(.finished(failure: nil))
        }
    }

    private func sendTyped() {
        let text = FoodPhotoSchema.cleanNote(typed)
        guard !text.isEmpty else { return }
        send(.sendTyped)
        remote.say("I just ate: \(text). Log it with a calorie and protein estimate.", conversation: conversationID)
        typed = ""
        send(.finished(failure: nil))
    }
}

/// The system camera, straight away. A library button (top right) and a "Type it" pill (top left) float over it.
struct CameraPicker: UIViewControllerRepresentable {
    let onPhoto: (UIImage) -> Void
    let onLibrary: () -> Void
    let onType: () -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        let overlay = PassthroughView(frame: UIScreen.main.bounds)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.addSubview(context.coordinator.button(symbol: "photo.on.rectangle", title: nil, label: "Choose from library",
                                                      id: "cameraLibrary", action: #selector(Coordinator.library), in: overlay, trailing: true))
        overlay.addSubview(context.coordinator.button(symbol: "keyboard", title: "Type it", label: "Type it instead",
                                                      id: "cameraType", action: #selector(Coordinator.type), in: overlay, trailing: false))
        picker.cameraOverlayView = overlay
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    final class PassthroughView: UIView {
        override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
            let hit = super.hitTest(point, with: event)
            return hit === self ? nil : hit
        }
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(parent: CameraPicker) { self.parent = parent }

        func button(symbol: String, title: String?, label: String, id: String, action: Selector, in view: UIView, trailing: Bool) -> UIButton {
            var config = UIButton.Configuration.plain()
            config.image = UIImage(systemName: symbol)
            config.title = title
            config.imagePadding = 6
            config.baseForegroundColor = .white
            config.background.backgroundColor = UIColor.black.withAlphaComponent(0.45)
            config.background.cornerRadius = 22
            config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 14, bottom: 0, trailing: 14)
            let button = UIButton(configuration: config)
            button.translatesAutoresizingMaskIntoConstraints = false
            button.accessibilityLabel = label
            button.accessibilityIdentifier = id
            button.addTarget(self, action: action, for: .touchUpInside)
            DispatchQueue.main.async {
                guard let superview = button.superview else { return }
                let guide = superview.safeAreaLayoutGuide
                NSLayoutConstraint.activate([
                    button.heightAnchor.constraint(equalToConstant: 44),
                    button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
                    button.topAnchor.constraint(equalTo: guide.topAnchor, constant: 8),
                    trailing ? button.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16)
                             : button.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
                ])
            }
            return button
        }

        @objc func library() { parent.onLibrary() }
        @objc func type() { parent.onType() }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onPhoto(image) } else { parent.onCancel() }
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.onCancel() }
    }
}

/// Downscale on the phone (less to upload; the Mac downscales again regardless)
/// and save one FoodPhoto record. The record name is the id, so a retry is one entry.
enum FoodPhotoSender {
    enum Outcome: Equatable { case sent, failed(String) }

    static func jpeg(_ image: UIImage) -> Data? {
        let fitted = FoodPhotoSchema.fittedSize(width: Int(image.size.width * image.scale), height: Int(image.size.height * image.scale))
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let size = CGSize(width: fitted.width, height: fitted.height)
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return resized.jpegData(compressionQuality: FoodPhotoSchema.jpegQuality)
    }

    static func send(_ image: UIImage, id: String, note: String, at: Date = Date()) async -> Outcome {
        guard let data = jpeg(image), data.count <= FoodPhotoSchema.maxBytes else { return .failed("That photo could not be prepared.") }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("food-\(id).jpg")
        do { try data.write(to: file, options: .atomic) } catch { return .failed("That photo could not be prepared.") }
        defer { try? FileManager.default.removeItem(at: file) }
        let zone = CKRecordZone.ID(zoneName: LinkSchema.zoneName, ownerName: CKCurrentUserDefaultName)
        let record = CKRecord(recordType: FoodPhotoSchema.recordType, recordID: CKRecord.ID(recordName: id, zoneID: zone))
        record[FoodPhotoSchema.photo] = CKAsset(fileURL: file)
        record[FoodPhotoSchema.at] = at as CKRecordValue
        record[FoodPhotoSchema.note] = note as CKRecordValue
        record[FoodPhotoSchema.status] = LinkCommandStatus.pending.rawValue as CKRecordValue
        record[FoodPhotoSchema.device] = "iphone" as CKRecordValue
        do {
            let (results, _) = try await CKContainer(identifier: LinkSchema.containerID).privateCloudDatabase
                .modifyRecords(saving: [record], deleting: [])
            for result in results.values { _ = try result.get() }
            return .sent
        } catch let error as CKError where error.code == .serverRecordChanged {
            return .sent
        } catch {
            return .failed("Not sent: iCloud didn't take it. Check your connection and try again.")
        }
    }
}
