//
//  What a chosen palette row does. Rows that are quick (open, switch, toggle) close the palette and hand focus back;
//  rows that have something to say (ORION's answer, the plan for closing apps, a logged glass of water) stay open
//  and say it in the preview pane. Slow work always runs off the main thread.
//

import AppKit
import PaletteKit
import SessionDomain

extension ConsoleController {

    func run(_ item: PaletteItem) {
        perform(item.action, id: item.id)
    }

    /// ⌘↩: whatever is typed goes to ORION, even when it matches a row.
    func askTyped() {
        let typed: String
        switch model.input {
        case .ask(let text), .search(let text): typed = text
        default: typed = model.query.trimmingCharacters(in: .whitespaces)
        }
        guard !typed.isEmpty else { return }
        perform(.ask(typed), id: "ask")
    }

    func quitSelectedApp() {
        guard let item = model.nav.selectedItem, case .switchApp(_, let name, _) = item.action else { return }
        perform(.quitApp(name: name), id: nil)
    }

    func perform(_ action: PaletteAction, id: String?) {
        guard action.tier.mayAppearInConsole else { return }
        if let id { learn(id) }
        switch action {
        case .noop: break
        case .setQuery(let text): model.query = text
        case .ask(let text): askInline(text)
        case .addTodo(let title): addTodo(title)
        case .logWater:
            inline("Logging a bottle…") { PaletteScripts.run("orion-log", ["water"]) } done: { r in
                r.ok ? "Logged +1 water." : "Could not log water just now."
            }
        case .logFood(let what, let kcal):
            inline("Logging \(what)…") { PaletteScripts.run("orion-log", ["food", what, String(kcal)]) } done: { r in
                r.ok ? "Logged \(what), \(kcal) kcal." : "Could not log that just now."
            }
        case .todoDone(let title): markDone(title)
        case .gameReady:
            inline("Getting your Mac game ready…", timeout: 120) { PaletteScripts.run("orion-apps", ["game-prep", "--now", "--json"], timeout: 120) } done: { r in
                PaletteScripts.say(r, fallback: "Could not get game mode ready just now.")
            }
        case .closeUnused: planCloseUnused()
        case .quitApp(let name): quit(name)
        case .copy(let text):
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            hide()
        default: perform(closing: action)
        }
    }

    /// The quick ones: close the palette first, so focus goes back where it was, then do the thing.
    private func perform(closing action: PaletteAction) {
        hide()
        switch action {
        case .talk: actions.listen()
        case .typeOverlay: NSWorkspace.shared.open(URL(string: "orion://type")!)
        case .openChat: actions.openChat()
        case .toggleMute: actions.toggleMute()
        case .mouseSetup: NSWorkspace.shared.open(URL(string: "orion://mouse-setup")!)
        case .toggleMouse: MouseController.shared.toggleMouseShortcuts()
        case .finishEarly: actions.finishEarly()
        case .openTab(let raw): if let tab = DashboardTab(rawValue: raw) { actions.openTab(tab) }
        case .openApp(let path):
            NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: NSWorkspace.OpenConfiguration())
            onLog?("[console] opened \(URL(fileURLWithPath: path).lastPathComponent)")
        case .switchApp(let bundleID, _, let path):
            if let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first {
                running.activate()
            } else {
                NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: NSWorkspace.OpenConfiguration())
            }
        case .revealInFinder(let path): NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
        case .startFocus(let minutes): send(.start(plan: PaletteFocus.plan(minutes: minutes)), title: "focus \(minutes)")
        case .sessionOp(let op):
            switch op {
            case .release: enforcer.release(); onLog?("[console] released enforcement")
            case .pause: send(.pause, title: "pause")
            case .resume: send(.resume, title: "resume")
            case .finish: send(.finishEarly, title: "finish")
            case .skipBreak: send(.skipRest, title: "skip break")
            }
        default: break
        }
    }

    /// Session commands, with typed provenance: `origin: .console`, never speech.
    private func send(_ kind: CommandKind, title: String) {
        let outcome = service.send(Command(requestID: RequestID(from: UUID()), origin: .console, issuedAt: Date(), kind: kind))
        if let rejection = outcome.rejection, !outcome.wasDuplicate {
            onLog?("[console] \(title): \(rejection.message)")
            actions.say(rejection.message)
        } else {
            onLog?("[console] \(title)")
        }
    }

    // MARK: Learning

    private func learn(_ id: String) {
        let next = model.frecency.recording(id, query: model.query, now: Date())
        model.frecency = next
        persistQueue.async { try? FrecencyFile.standard.save(next) }
    }

    // MARK: Ask, inline

    private func askInline(_ text: String) {
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        if actions.isThinking() {
            model.output = .result("ORION is still on your last message. Try again in a moment.")
            return
        }
        model.output = .thinking(question: question)
        askedAfter = actions.lastTurnID()
        onLog?("[console] ask")
        actions.ask(question)
    }

    /// Called by AppState whenever the turns or the phase change: lands ORION's answer in the preview pane.
    func ingest(turns: [Turn], thinking: Bool) {
        guard case .thinking(let question)? = model.output else { return }
        let fresh: ArraySlice<Turn>
        if let askedAfter, let index = turns.firstIndex(where: { $0.id == askedAfter }) { fresh = turns[(index + 1)...] }
        else { fresh = turns[...] }
        guard !thinking, let reply = fresh.last(where: { $0.role == .orion || $0.role == .system }) else { return }
        model.output = .answer(question: question, text: reply.text)
    }

    // MARK: Inline scripts

    private func addTodo(_ title: String) {
        inline("Adding to your to-dos…") { PaletteScripts.run("orion-tasks", ["add", title]) } done: { r in
            r.ok ? "Added “\(title)” to your to-dos." : "Could not add “\(title)” to your to-dos."
        }
    }

    private func markDone(_ title: String) {
        inline("Ticking it off…") { PaletteScripts.run("orion-tasks", ["done", title], timeout: 40) } done: { r in
            if r.ok { self.todos = self.todos.filter { $0.title != title }; self.rebuildContext() }
            return r.ok ? "Done: “\(title)”." : "Could not tick off “\(title)”."
        }
    }

    private func quit(_ name: String) {
        inline("Closing \(name)…", timeout: 30) { PaletteScripts.run("orion-apps", ["quit", name, "--json"], timeout: 30) } done: { r in
            self.rebuildContext()
            return PaletteScripts.say(r, fallback: "Could not close \(name) just now.")
        }
    }

    private func planCloseUnused() {
        model.output = .planning
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let r = PaletteScripts.run("orion-apps", ["quit-unused", "--dry-run", "--json"], timeout: 30)
            let object = PaletteScripts.json(r.text)
            let would = ((object?["would"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
            let say = PaletteScripts.say(r, fallback: "I could not work out what to close just now.")
            DispatchQueue.main.async {
                guard case .planning? = self?.model.output else { return }
                self?.model.output = would.isEmpty ? .result(say) : .plan(say: say, closes: would)
            }
        }
    }

    func confirmCloseUnused() {
        guard model.output?.isPlan == true else { return }
        inline("Closing them…", timeout: 90) { PaletteScripts.run("orion-apps", ["quit-unused", "--json"], timeout: 90) } done: { r in
            self.rebuildContext()
            return PaletteScripts.say(r, fallback: "Could not close those just now.")
        }
    }

    /// Show `label`, run `work` off the main thread, show what `done` makes of it.
    private func inline(_ label: String, timeout: TimeInterval = 30, work: @escaping () -> PaletteScripts.Result,
                        done: @escaping (PaletteScripts.Result) -> String) {
        model.output = .working(label)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = work()
            DispatchQueue.main.async {
                guard let self, case .working? = self.model.output else { return }
                self.model.output = .result(done(result))
            }
        }
    }
}
