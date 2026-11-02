import CloudKit
import PhotosUI
import SwiftUI
import UIKit
import MobileCore

/*
 "Log food" with a photo (2026-11-02). Opened from the composer's camera button
 or the drawer. A photo (taken or picked) and an optional note go to the Mac as
 one FoodPhoto record with a CKAsset; ORION Link writes the food inbox and the
 Mac's estimator does the rest (FoodPhotoSchema has the contract). The chat
 shows the photo as sent with "Sent to your Mac for an estimate…".
*/
struct FoodCaptureSheet: View {
    let onSent: (_ id: String, _ note: String, _ result: FoodPhotoSender.Outcome) -> Void
    let onClose: () -> Void

    @State private var picked: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var note = ""
    @State private var showingCamera = false
    @State private var sending = false
    @State private var problem: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var cameraAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            PhoneHeader(eyebrow: "Food", title: "Log food")
            Text("A photo and a few words. ORION on your Mac estimates calories and protein, then logs it.")
                .font(.system(size: 15)).foregroundStyle(Phone.soft)
            photo
            noteField
            if let problem { Text(problem).font(.system(size: 13)).foregroundStyle(Phone.orange) }
            Spacer(minLength: 0)
            HStack(spacing: 12) {
                Button("Cancel", action: onClose).buttonStyle(PhoneButtonStyle(tint: Phone.soft))
                Spacer()
                Button(action: send) {
                    Label(sending ? "Sending…" : "Send to ORION", systemImage: "arrow.up")
                }
                .buttonStyle(PhoneButtonStyle(prominent: true))
                .disabled(image == nil || sending)
                .accessibilityIdentifier("sendFoodPhoto")
            }
        }
        .padding(.horizontal, 22).padding(.top, 24).padding(.bottom, 16)
        .background(Phone.ink.ignoresSafeArea())
        .animation(PhoneMotion.spring(PhoneMotion.enter, reduce: reduceMotion), value: image != nil)
        .onChange(of: picked) { _, item in Task { await load(item) } }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker { taken in image = taken ?? image; showingCamera = false }.ignoresSafeArea()
        }
    }

    @ViewBuilder private var photo: some View {
        if let image {
            Image(uiImage: image).resizable().scaledToFill()
                .frame(width: 168, height: 168).clipShape(Circle())
                .overlay(Circle().stroke(Phone.accent.opacity(0.5), lineWidth: 1))
                .frame(maxWidth: .infinity)
                .transition(.scale(scale: 0.85).combined(with: .opacity))
                .accessibilityLabel("The photo to send")
        }
        HStack(spacing: 18) {
            if cameraAvailable {
                captureButton("camera", image == nil ? "Take photo" : "Retake") { showingCamera = true }
            }
            PhotosPicker(selection: $picked, matching: .images) {
                bubble("photo.on.rectangle", image == nil ? "Choose photo" : "Choose another")
            }
            .buttonStyle(PhonePressStyle())
            .accessibilityIdentifier("pickFoodPhoto")
        }
        .frame(maxWidth: .infinity)
    }

    private func captureButton(_ symbol: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { bubble(symbol, title) }.buttonStyle(PhonePressStyle())
    }

    private func bubble(_ symbol: String, _ title: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.system(size: 22, weight: .light)).foregroundStyle(Phone.accent)
                .frame(width: 64, height: 64)
                .overlay(Circle().stroke(Phone.accent.opacity(0.45), lineWidth: 1.1))
            Text(title).font(.system(size: 13)).foregroundStyle(Phone.soft)
        }
    }

    private var noteField: some View {
        TextField("Note (optional): \"half portion\", \"no rice\"", text: $note, axis: .vertical)
            .lineLimit(1...3).font(.system(size: 16))
            .padding(.horizontal, 18).padding(.vertical, 12)
            .overlay(Capsule().stroke(Phone.wash(0.14), lineWidth: 1))
            .accessibilityIdentifier("foodNote")
    }

    private func load(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let loaded = UIImage(data: data) else {
                problem = "That photo could not be opened."
                return
            }
            image = loaded
            problem = nil
        } catch {
            problem = "That photo could not be opened."
        }
    }

    private func send() {
        guard let image, !sending else { return }
        sending = true
        let id = UUID().uuidString
        let cleaned = FoodPhotoSchema.cleanNote(note)
        Task {
            let outcome = await FoodPhotoSender.send(image, id: id, note: cleaned)
            sending = false
            if case .failed(let why) = outcome { problem = why; return }
            onSent(id, cleaned, outcome)
        }
    }
}

/// The system camera, for "Take photo".
struct CameraPicker: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (UIImage?) -> Void
        init(done: @escaping (UIImage?) -> Void) { self.done = done }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            done(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { done(nil) }
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
