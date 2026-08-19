//
//  One gesture, one line, one typed command.
//
//  Two rules shape this, both from the plan and both about not lying.
//
//  PROVENANCE IS TYPED, NOT INFERRED. A sentence produced by a keystroke is not
//  automatically trusted user speech. The Console sends a `Command` with
//  `origin: .console` and its own request id, and that origin travels through
//  authorization and into the ledger unchanged. Deriving prose for the model to
//  read is fine; letting the prose become the provenance is not, because then
//  anything that can put words in front of the gateway can impersonate Nick.
//
//  NEVER A ONE-KEYSTROKE BUTTON FOR SOMETHING THAT NEEDS APPROVAL. The capability
//  tiers are AUTO, NOTIFY, APPROVAL and NEVER (see `scripts/orion-authority`).
//  Only the first two may appear here. A Console that offers a one-key shortcut
//  for an APPROVAL action has quietly converted "ask first" into "press this",
//  which is the entire safety property of the gate, deleted by a convenience
//  feature.
//

import AppKit
import SwiftUI
import SessionDomain
import SessionService

/// What the Console is allowed to offer.
enum ConsoleTier: String {
    case auto = "AUTO"
    case notify = "NOTIFY"
    case approval = "APPROVAL"
    case never = "NEVER"

    /// The filter. Deliberately a whitelist rather than "not never" — a new tier
    /// added later must be excluded until somebody decides it belongs, not
    /// included because nobody remembered to exclude it.
    var mayAppearInConsole: Bool { self == .auto || self == .notify }
}

struct ConsoleCommand: Identifiable, Equatable {
    let id: String
    let title: String
    let hint: String
    let tier: ConsoleTier
    let kind: Kind

    enum Kind: Equatable {
        case session(CommandKind)
        case releaseEnforcement
    }
}

final class ConsoleController: ObservableObject {

    @Published private(set) var isVisible = false
    @Published var query = ""

    /// What the hotkey registration had to say. Shown in the Console itself,
    /// because a shortcut that silently does nothing reads as Orion being broken.
    @Published private(set) var hotKeyProblem: String?

    private var panel: NSPanel?
    private let hotKey = GlobalHotKey()
    private var previousApp: NSRunningApplication?

    private let service: SessionService
    private let enforcer: Enforcer
    var onLog: ((String) -> Void)?

    init(service: SessionService, enforcer: Enforcer) {
        self.service = service
        self.enforcer = enforcer
    }

    // MARK: Wiring

    func install(_ combination: HotKeyCombination = .optionTab) {
        hotKey.onLog = { [weak self] line in self?.onLog?(line) }
        hotKey.onFire = { [weak self] in self?.toggle() }

        let registration = hotKey.register(combination)
        hotKeyProblem = registration.disclosure
    }

    func teardown() {
        hotKey.unregister()
        hide()
    }

    // MARK: Showing

    func toggle() { isVisible ? hide() : show() }

    func show() {
        guard panel == nil else { return }
        previousApp = NSWorkspace.shared.frontmostApplication

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 320),
            styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = NSHostingView(rootView: ConsoleView(controller: self))

        if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: frame.midX - 280, y: frame.midY - 40))
        }

        // The Console DOES take key focus, unlike the break surface: it has a
        // text field, and a text field nobody can type into is not a console.
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        self.panel = panel
        isVisible = true
    }

    func hide() {
        panel?.orderOut(nil)
        panel = nil
        isVisible = false
        query = ""

        // Hand focus back to whatever he was in. Without this, dismissing the
        // Console leaves Orion frontmost and he has to click his editor again —
        // every time, which is enough to stop using it.
        if let previousApp, previousApp.bundleIdentifier != Bundle.main.bundleIdentifier {
            previousApp.activate()
        }
        previousApp = nil
    }

    // MARK: Commands

    /// Only AUTO and NOTIFY, filtered here rather than at the call site so
    /// there is exactly one place the rule lives.
    var commands: [ConsoleCommand] {
        let all: [ConsoleCommand] = [
            ConsoleCommand(id: "start", title: "Start focus session",
                           hint: "three 50-minute blocks with 10-minute breaks", tier: .auto,
                           kind: .session(.start(plan: SessionPlanBuilder.alternating(
                               session: SessionID(from: UUID()),
                               focusBlocks: 3,
                               focus: 50 * 60,
                               rest: 10 * 60,
                               clips: [],
                               task: "Focus"
                           )))),
            ConsoleCommand(id: "pause", title: "Pause the session",
                           hint: "stops the clock", tier: .auto,
                           kind: .session(.pause)),
            ConsoleCommand(id: "resume", title: "Resume the session",
                           hint: "starts it again", tier: .auto,
                           kind: .session(.resume)),
            ConsoleCommand(id: "skip", title: "Skip the break",
                           hint: "straight to the next block", tier: .auto,
                           kind: .session(.skipRest)),
            ConsoleCommand(id: "finish", title: "Finish the session",
                           hint: "archived as a success", tier: .notify,
                           kind: .session(.finishEarly)),
            ConsoleCommand(id: "release", title: "Stop enforcing",
                           hint: "Orion stops mentioning drift", tier: .auto,
                           kind: .releaseEnforcement)
        ]
        return all.filter(\.tier.mayAppearInConsole)
    }

    var matches: [ConsoleCommand] {
        let trimmed = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty else { return commands }
        return commands.filter {
            $0.title.lowercased().contains(trimmed) || $0.id.contains(trimmed)
        }
    }

    /// Run one, with typed provenance.
    func run(_ command: ConsoleCommand) {
        switch command.kind {
        case .releaseEnforcement:
            enforcer.release()
            onLog?("[console] released enforcement")

        case .session(let kind):
            // `origin: .console` — typed, and carried through unchanged. This is
            // not speech and must never be recorded as speech.
            let outcome = service.send(Command(
                requestID: RequestID(from: UUID()),
                origin: .console,
                issuedAt: Date(),
                kind: kind
            ))
            if let rejection = outcome.rejection, !outcome.wasDuplicate {
                onLog?("[console] \(command.title): \(rejection.message)")
            } else {
                onLog?("[console] \(command.title)")
            }
        }
        hide()
    }
}

// MARK: - The view

struct ConsoleView: View {
    @ObservedObject var controller: ConsoleController
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField("What do you want?", text: $controller.query)
                .textFieldStyle(.plain)
                .font(.system(size: 20, weight: .light))
                .foregroundStyle(OrionTheme.text)
                .focused($focused)
                .padding(.horizontal, 22)
                .padding(.vertical, 18)
                .onSubmit {
                    if let first = controller.matches.first { controller.run(first) }
                }

            if let problem = controller.hotKeyProblem {
                Text(problem)
                    .font(.system(size: 11))
                    .foregroundStyle(OrionTheme.orange)
                    .padding(.horizontal, 22)
                    .padding(.bottom, 10)
                    .fixedSize(horizontal: false, vertical: true)
            }

            FadingRule()

            VStack(alignment: .leading, spacing: 2) {
                ForEach(controller.matches) { command in
                    Button { controller.run(command) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(command.title)
                                    .font(.system(size: 14))
                                    .foregroundStyle(OrionTheme.text)
                                Text(command.hint)
                                    .font(.system(size: 11))
                                    .foregroundStyle(OrionTheme.textDim)
                            }
                            Spacer()
                            Text(command.tier.rawValue)
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(OrionTheme.textDim)
                        }
                        .padding(.horizontal, 22)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 8)

            Spacer(minLength: 0)
        }
        .frame(width: 560, height: 320, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(OrionTheme.ink.opacity(0.97))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(OrionTheme.line, lineWidth: 1)
                )
        )
        .onAppear { focused = true }
        .onExitCommand { controller.hide() }
    }
}
