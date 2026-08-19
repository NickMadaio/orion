import AppKit
import SwiftUI
import SessionService

let environment = ProcessInfo.processInfo.environment
let scratch = URL(fileURLWithPath: environment["ORION_FOCUS_RENDER_DIR"]
                  ?? "/private/tmp/orion-focus-ui-harness", isDirectory: true)
let output = URL(fileURLWithPath: environment["ORION_FOCUS_RENDER_OUTPUT"]
                 ?? "/private/tmp/orion-focus-ui.png")
let previewPlayer = environment["ORION_FOCUS_PREVIEW"] == "1"

try? FileManager.default.removeItem(at: scratch)
try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)

let library = ClipLibrary(directory: scratch.appendingPathComponent("clips", isDirectory: true))
_ = library.ensureBuiltInFocusTrack()
let player = ClipPlayer(library: library)
let effects = SessionEffects(clips: player)
let service = SessionService(
    store: SessionStore(url: scratch.appendingPathComponent("state.json")),
    history: SessionHistory(url: scratch.appendingPathComponent("history.jsonl")),
    effects: effects
)
let enforcer = Enforcer()
let model = SessionTabModel(service: service, library: library, clipPlayer: player,
                            music: AppleMusicControl(), enforcer: enforcer, effects: effects)
_ = service.start()

if let start = model.availableActions.first(where: { $0.kind == .start }) {
    model.perform(start)
}

let firstRemaining = model.phaseRemainingSeconds
RunLoop.main.run(until: Date().addingTimeInterval(1.15))
let secondRemaining = model.phaseRemainingSeconds
guard firstRemaining - secondRemaining >= 0.8 else {
    fputs("focus clock did not advance between service heartbeats\n", stderr)
    exit(1)
}
guard model.shouldOfferAudioChoices, !model.mediaIsPlaying else {
    fputs("silent session did not present a truthful audio choice\n", stderr)
    exit(1)
}
guard model.guardSetupRequest != nil else {
    fputs("dashboard-started session did not request an app allowlist\n", stderr)
    exit(1)
}
// The allowlist sheet has its own interaction test in the installed app. This
// render captures the sharpened dashboard and its truthful empty audio state.
model.dismissGuardSetup()

let hologram = HologramModel()
let view = FocusSessionHome(hologram: hologram, model: model, isPreview: previewPlayer)
    .frame(width: 1600, height: 1000)

let hosting = NSHostingView(rootView: view)
hosting.frame = CGRect(x: 0, y: 0, width: 1600, height: 1000)
let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless],
                      backing: .buffered, defer: false)
window.contentView = hosting

for _ in 0..<20 {
    hosting.layoutSubtreeIfNeeded()
    RunLoop.main.run(until: Date().addingTimeInterval(0.025))
}

guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
    fputs("focus UI render did not produce a bitmap\n", stderr)
    exit(1)
}
hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("focus UI render could not encode PNG\n", stderr)
    exit(1)
}
try png.write(to: output, options: .atomic)
service.stop()
print(String(format: "PASS: focus clock moved %.2fs; silent audio chooser and app request both appeared",
             firstRemaining - secondRemaining))
print("Rendered \(output.path) (\(png.count) bytes)")
