import Foundation
import AVFoundation
import Speech
import ApplicationServices

/// A log file, because Orion has been a black box.
///
/// Every microphone diagnosis in this project has been inference from the
/// outside — TCC databases we cannot read, System Settings rows that lie, and
/// permission prompts that never appear. The app knew the answer the whole
/// time and had no way to say it.
///
/// Writes to ~/.openclaw/logs/orion-app.log. Cheap, append-only, and the first
/// thing to read when something is silent.
enum OrionLog {

    private static let path: String = {
        let dir = (NSHomeDirectory() as NSString)
            .appendingPathComponent(".openclaw/logs")
        try? FileManager.default.createDirectory(
            atPath: dir, withIntermediateDirectories: true)
        return (dir as NSString).appendingPathComponent("orion-app.log")
    }()

    private static let queue = DispatchQueue(label: "com.nickmadaio.orion.log")

    private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    static func write(_ message: String) {
        let line = "\(stamp.string(from: Date()))  \(message)\n"
        queue.async {
            guard let data = line.data(using: .utf8) else { return }
            if let handle = FileHandle(forWritingAtPath: path) {
                handle.seekToEndOfFile()
                handle.write(data)
                try? handle.close()
            } else {
                try? data.write(to: URL(fileURLWithPath: path))
            }
        }
    }

    /// Exactly what macOS thinks Orion is allowed to do, in Orion's own words.
    static func permissionSnapshot(_ context: String) {
        let mic: String
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:    mic = "authorized"
        case .denied:        mic = "DENIED"
        case .restricted:    mic = "RESTRICTED"
        case .notDetermined: mic = "not-yet-asked"
        @unknown default:    mic = "unknown"
        }

        let speech: String
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:    speech = "authorized"
        case .denied:        speech = "DENIED"
        case .restricted:    speech = "RESTRICTED"
        case .notDetermined: speech = "not-yet-asked"
        @unknown default:    speech = "unknown"
        }

        let ax = AXIsProcessTrusted() ? "trusted" : "NOT TRUSTED"

        write("[\(context)] accessibility=\(ax)  microphone=\(mic)  speech=\(speech)")

        if mic == "not-yet-asked" || speech == "not-yet-asked" {
            write("  -> not-yet-asked means macOS will prompt on the next press.")
        }
        if mic == "DENIED" || speech == "DENIED" {
            write("  -> DENIED means requestAccess returns false WITHOUT prompting.")
            write("     Reset it:  tccutil reset Microphone com.nickmadaio.orion.app")
        }
        if ax == "NOT TRUSTED" {
            write("  -> Without Accessibility the Right Option monitor never fires,")
            write("     so pressing it produces no event at all. Nothing to see.")
        }
    }
}
