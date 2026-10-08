import AppKit
import IOKit.pwr_mgt
import SwiftUI

/*
 The morning screen (2026-10-08). Nick: "orion … turns on my screen to a UI
 with a nicer view of my day BIG on one side of the screen, and on the other
 side the weather". Put up by scripts/orion-morning (orion://morning-screen)
 when he is actually up, from orion-controlled/morning-view.json.

 It wakes the display; it cannot unlock the Mac (nothing can without his
 password, and ORION does not hold it), so on a locked Mac it is waiting the
 moment he unlocks. Escape, a click, or 30 minutes puts it away.
*/

struct MorningView: Decodable, Equatable {
    struct Event: Decodable, Equatable { let title: String; let start: String; let half: String; let end: String; let kind: String }
    struct Hour: Decodable, Equatable { let label: String; let temp: Int; let rain: Int; let symbol: String }
    struct Sky: Decodable, Equatable { let now: Int; let high: Int; let low: Int; let symbol: String; let line: String?; let hours: [Hour] }
    let greeting: String
    let date: String
    let events: [Event]
    let leaveBy: String?
    let due: [String]
    let top: [String]
    let weather: Sky?

    static func load() -> MorningView? {
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/morning-view.json")
        return (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(MorningView.self, from: $0) }
    }
}

/// Borderless panels refuse key status by default; this one needs Escape.
private final class MorningPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    var onEscape: (() -> Void)?
    override func cancelOperation(_ sender: Any?) { onEscape?() }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onEscape?() } else { super.keyDown(with: event) }
    }
}

final class MorningScreen {
    static let shared = MorningScreen()
    private var panel: MorningPanel?
    private var autoClose: DispatchWorkItem?

    func show() {
        guard let view = MorningView.load(), let screen = NSScreen.main else {
            OrionLog.write("[morning] no morning-view.json to show")
            return
        }
        dismiss()
        wakeDisplay()
        brightness.raise()
        let panel = MorningPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        // Frosted, not solid (Nick: "the one solid background is suffocating"):
        // the desktop shows through, blurred, under a dark tint.
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.onEscape = { [weak self] in self?.dismiss() }
        let glass = NSVisualEffectView(frame: screen.frame)
        glass.material = .fullScreenUI
        glass.blendingMode = .behindWindow
        glass.state = .active
        let host = NSHostingView(rootView: MorningScreenView(view: view, onClose: { [weak self] in self?.dismiss() }))
        host.frame = glass.bounds
        host.autoresizingMask = [.width, .height]
        glass.addSubview(host)
        panel.contentView = glass
        panel.setFrame(screen.frame, display: true)
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.panel = panel
        let work = DispatchWorkItem { [weak self] in self?.dismiss() }
        autoClose = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 30 * 60, execute: work)
        OrionLog.write("[morning] screen up — \(view.events.count) event(s), weather \(view.weather == nil ? "missing" : "shown")")
    }

    func dismiss() {
        autoClose?.cancel()
        autoClose = nil
        guard let panel else { return }
        panel.orderOut(nil)
        self.panel = nil
        brightness.restore()
        if keepOn != 0 { IOPMAssertionRelease(keepOn); keepOn = 0 }
    }

    private let brightness = DisplayBrightness()
    private var keepOn: IOPMAssertionID = 0

    /// Declaring user activity turns a sleeping display on, as a key press would;
    /// the assertion keeps it on while the screen is up.
    private func wakeDisplay() {
        var id: IOPMAssertionID = 0
        IOPMAssertionDeclareUserActivity("ORION morning screen" as CFString, kIOPMUserActiveLocal, &id)
        if keepOn == 0 {
            IOPMAssertionCreateWithName(kIOPMAssertPreventUserIdleDisplaySleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                        "ORION morning screen" as CFString, &keepOn)
        }
    }
}

/// The built-in display's brightness, through DisplayServices (the private
/// framework the brightness keys use; there is no public API on Apple
/// silicon). Full while the morning screen is up, his level back after.
final class DisplayBrightness {
    private typealias Get = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
    private typealias Set = @convention(c) (UInt32, Float) -> Int32
    private let get: Get?
    private let set: Set?
    private var saved: Float?

    init() {
        let handle = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY)
        get = handle.flatMap { dlsym($0, "DisplayServicesGetBrightness") }.map { unsafeBitCast($0, to: Get.self) }
        set = handle.flatMap { dlsym($0, "DisplayServicesSetBrightness") }.map { unsafeBitCast($0, to: Set.self) }
    }

    private var display: UInt32 { CGMainDisplayID() }

    func current() -> Float? {
        var level: Float = 0
        guard let get, get(display, &level) == 0 else { return nil }
        return level
    }

    func raise() {
        if saved == nil { saved = current() }
        guard let set else { return OrionLog.write("[morning] brightness control unavailable") }
        let result = set(display, 1.0)
        OrionLog.write("[morning] brightness \(saved.map { String(format: "%.2f", $0) } ?? "?") → 1.00\(result == 0 ? "" : " (failed \(result))")")
    }

    func restore() {
        guard let saved, let set else { return }
        _ = set(display, saved)
        self.saved = nil
    }
}

struct MorningScreenView: View {
    let view: MorningView
    let onClose: () -> Void

    var body: some View {
        GeometryReader { geo in
            ZStack {
                background
                HStack(alignment: .top, spacing: 0) {
                    day.frame(width: geo.size.width * 0.58, alignment: .topLeading)
                    LinearGradient(colors: [.clear, Color.white.opacity(0.12), .clear], startPoint: .top, endPoint: .bottom)
                        .frame(width: 1)
                        .padding(.vertical, 90)
                    sky.frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(.top, 70)   // offset, not aligned: the two halves are not a grid
                }
                .padding(.horizontal, 90)
                .frame(maxHeight: geo.size.height * 0.78)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Text("esc to close").font(OrionTheme.mono(10, .medium)).tracking(1.5).foregroundStyle(OrionTheme.textDim)
                    }
                }
                .padding(28)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onClose)
    }

    private var background: some View {
        ZStack {
            OrionTheme.ink.opacity(0.58)
            RadialGradient(colors: [OrionTheme.orange.opacity(0.22), .clear], center: .topLeading, startRadius: 0, endRadius: 1000)
            RadialGradient(colors: [OrionTheme.accent.opacity(0.14), .clear], center: .bottomTrailing, startRadius: 0, endRadius: 900)
        }
        .ignoresSafeArea()
    }

    private func label(_ text: String) -> some View {
        Text(text).font(OrionTheme.mono(11, .semibold)).tracking(2.5).foregroundStyle(OrionTheme.textDim)
    }

    // MARK: The day

    private var day: some View {
        VStack(alignment: .leading, spacing: 0) {
            label(view.date.uppercased())
            Text(view.greeting)
                .font(.system(size: 46, weight: .light))
                .foregroundStyle(OrionTheme.text)
                .padding(.top, 10)
                .padding(.bottom, 44)
            if view.events.isEmpty {
                Text("Nothing on the calendar.")
                    .font(.system(size: 64, weight: .ultraLight))
                    .foregroundStyle(OrionTheme.text)
            } else {
                ForEach(Array(view.events.enumerated()), id: \.offset) { index, event in
                    eventRow(event, first: index == 0)
                }
            }
            if let leave = view.leaveBy {
                HStack(spacing: 10) {
                    Image(systemName: "figure.walk")
                    Text("Leave by \(leave)")
                }
                .font(.system(size: 24, weight: .regular))
                .foregroundStyle(OrionTheme.orange)
                .padding(.top, 34)
            }
            let list = view.due.isEmpty ? view.top : view.due
            if !list.isEmpty {
                label(view.due.isEmpty ? "ON YOUR LIST" : "DUE TODAY").padding(.top, 40).padding(.bottom, 10)
                ForEach(list, id: \.self) { item in
                    Text(item).font(.system(size: 22, weight: .light)).foregroundStyle(OrionTheme.textSoft).padding(.vertical, 3)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func eventRow(_ event: MorningView.Event, first: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 26) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(event.start).font(.system(size: first ? 92 : 54, weight: .ultraLight, design: .rounded)).monospacedDigit()
                Text(event.half).font(OrionTheme.mono(first ? 15 : 12, .medium)).foregroundStyle(OrionTheme.textDim)
            }
            .foregroundStyle(OrionTheme.text)
            .frame(width: 320, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                Text(event.title).font(.system(size: first ? 34 : 26, weight: .regular)).foregroundStyle(OrionTheme.text).lineLimit(2)
                Text("until \(event.end)").font(.system(size: 14)).foregroundStyle(OrionTheme.textDim)
            }
        }
        .padding(.vertical, first ? 6 : 10)
        .overlay(alignment: .bottom) {
            LinearGradient(colors: [Color.white.opacity(0.10), .clear], startPoint: .leading, endPoint: .trailing).frame(height: 1)
        }
    }

    // MARK: The weather

    @ViewBuilder private var sky: some View {
        if let w = view.weather {
            VStack(alignment: .leading, spacing: 0) {
                label("WEATHER")
                HStack(alignment: .center, spacing: 24) {
                    Image(systemName: w.symbol).symbolRenderingMode(.multicolor).font(.system(size: 84, weight: .light))
                    Text("\(w.now)°").font(.system(size: 150, weight: .ultraLight, design: .rounded)).foregroundStyle(OrionTheme.text)
                }
                .padding(.top, 16)
                Text("High \(w.high)°  ·  Low \(w.low)°").font(.system(size: 20, weight: .light)).foregroundStyle(OrionTheme.textSoft)
                if let line = w.line {
                    Text(line).font(.system(size: 20, weight: .light)).foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true).padding(.top, 14).frame(maxWidth: 420, alignment: .leading)
                }
                HStack(alignment: .top, spacing: 0) {
                    ForEach(Array(w.hours.enumerated()), id: \.offset) { _, hour in
                        VStack(spacing: 10) {
                            Text(hour.label).font(OrionTheme.mono(12, .medium)).foregroundStyle(OrionTheme.textDim)
                            Image(systemName: hour.symbol).symbolRenderingMode(.multicolor).font(.system(size: 22))
                            Text("\(hour.temp)°").font(.system(size: 20, weight: .light)).foregroundStyle(OrionTheme.text)
                            Text(hour.rain >= 20 ? "\(hour.rain)%" : " ").font(.system(size: 12)).foregroundStyle(OrionTheme.blue)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(.top, 48)
                .frame(maxWidth: 560)
                Spacer(minLength: 0)
            }
            .padding(.leading, 70)
        } else {
            VStack(alignment: .leading) {
                label("WEATHER")
                Text("Couldn't get the forecast.").font(.system(size: 22, weight: .light)).foregroundStyle(OrionTheme.textSoft).padding(.top, 16)
            }
            .padding(.leading, 70)
        }
    }
}
