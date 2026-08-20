import AppKit
import SwiftUI

/*
 Look at the break screen without serving a fifty-minute focus block first.

 The sanctuary is the one surface that cannot be inspected the normal way: it
 only appears during a rest phase, it covers every display, and it has no
 dismiss control by design. Waiting out a real session to review a gradient is
 not a workflow, and shipping a full-screen takeover nobody has looked at
 closely is how you discover at 3pm that the timer is unreadable.

 So: the real view, at a real size, with a running clock — and Escape quits,
 because this is the harness and not the feature. The absence of that key is
 the whole point of the real one.

   Tests/run-break-preview.sh              ten minutes, guided
   Tests/run-break-preview.sh --short      three minutes
   Tests/run-break-preview.sh --unguided   no breathing circle
   Tests/run-break-preview.sh --window     in a window rather than full screen
*/

let arguments = CommandLine.arguments
let isShort = arguments.contains("--short")
let guided = !arguments.contains("--unguided")
let windowed = arguments.contains("--window")
let silent = arguments.contains("--silent")
let ambience: Ambience = {
    if silent { return .none }
    if arguments.contains("--waves") { return .waves }
    if arguments.contains("--wind") { return .wind }
    return .rain
}()
let total: TimeInterval = isShort ? 180 : 600

final class Harness: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var started = Date()
    private var timer: Timer?
    private let ambient = AmbientSound()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // The FULL screen, including the strip behind the menu bar and the Dock.
        //
        // `NSScreen.frame` is the whole display; `visibleFrame` is what is left
        // after the menu bar and Dock, and using it produces a window that looks
        // full screen until you notice the wallpaper along two edges. A break
        // surface with a visible seam is a break surface you can see past.
        let screen = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1512, height: 982)
        let frame = windowed
            ? NSRect(x: 0, y: 0, width: 1100, height: 720)
            : screen

        let window = NSWindow(
            contentRect: frame,
            styleMask: windowed ? [.titled, .closable, .resizable] : [.borderless],
            backing: .buffered, defer: false
        )
        window.title = "Break preview"
        window.isOpaque = true
        window.backgroundColor = .black
        if !windowed {
            window.level = .screenSaver
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        }
        window.contentView = NSHostingView(rootView: content())
        if windowed {
            window.makeKeyAndOrderFront(nil)
            window.center()
        } else {
            // Borderless windows do not become key by asking politely, and a
            // full-screen surface that is not key does not receive the hold
            // gesture — the exact control that stops it being a trap.
            window.setFrame(frame, display: true)
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
        }
        self.window = window

        print("window frame: \(Int(window.frame.width))×\(Int(window.frame.height)) "
              + "· screen: \(Int(screen.width))×\(Int(screen.height)) "
              + "· \(windowed ? "windowed (asked for)" : "FULL SCREEN")")

        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self, let hosting = self.window?.contentView as? NSHostingView<BreakSanctuaryView>
            else { return }
            hosting.rootView = self.content()
        }

        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53 { NSApp.terminate(nil) }   // Escape — harness only
            return event
        }

        ambient.onLog = { print($0) }
        ambient.start(ambience)

        print("break preview — \(Int(total / 60)) minute\(total > 300 ? "s" : "s"), "
              + "\(guided ? "guided" : "unguided"). Escape quits (the real one has no such key).")
    }

    private func content() -> BreakSanctuaryView {
        let elapsed = Date().timeIntervalSince(started)
        return BreakSanctuaryView(
            remaining: max(0, total - elapsed),
            progress: min(1, elapsed / total),
            prompt: "Look at something twenty feet away. Let your shoulders drop.",
            guided: guided,
            presence: "Camera is checking you are resting, not scrolling.",
            onHoldExit: {
                print("held to leave — the real one would log the early exit")
                NSApp.terminate(nil)
            }
        )
    }
}

let app = NSApplication.shared
let harness = Harness()
app.delegate = harness
app.run()
