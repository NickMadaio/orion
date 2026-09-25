import SwiftUI
import Foundation

/*
 Approvals and running actions, in the app (Phase 52).

 Nick (2026-09-25): raw terminal access with "UI confirmation or in app
 confirmation just like chat gpt and claude use (allow this once, allow for this
 chat, etc)". So a request ORION is waiting on appears here with three answers,
 and anything running appears with a Stop.

 The app is a human surface, like orion-approve and Discord. It never writes a
 grant itself: the buttons run scripts/orion-approve, the one sanctioned writer,
 which records the yes as "<user>@app". Stop writes the cancel mark the plugin
 checks (plugin/orion-control/src/cancellation.ts); for a terminal command that
 kills it, for anything else it stops before the next step.
*/
struct PendingApproval: Decodable, Identifiable, Equatable {
    let id: String
    let action: String
    let summary: String
    let context: String
    let expiresAt: String
    let sessionKey: String?

    /// "Allow for this chat" is offered only where the plugin would honour it.
    var chatGrantable: Bool { action == "terminal_run" && sessionKey != nil }
}

struct RunningAction: Decodable, Identifiable, Equatable {
    let taskId: String
    let goal: String
    let actions: [String]
    let startedAt: String
    let commands: [String]?
    var id: String { taskId }
}

enum ApprovalsStore {
    static let home = URL(fileURLWithPath: NSHomeDirectory())
    static let tickets = home.appendingPathComponent(".openclaw/orion-gate/approvals/tickets")
    static let grants = home.appendingPathComponent(".openclaw/orion-gate/approvals/grants")
    static let running = home.appendingPathComponent(".openclaw/orion-controlled/actions/running")
    static let cancel = home.appendingPathComponent(".openclaw/orion-controlled/actions/cancel")
    static let approve = "/Users/nickmadaio/Desktop/ORION/scripts/orion-approve"
    private static let taskID = try! NSRegularExpression(pattern: "^orion-[a-f0-9]{16}$")

    /// Waiting and unexpired, oldest first; a ticket already granted is not waiting.
    static func pending(now: Date = Date(), tickets: URL = tickets, grants: URL = grants) -> [PendingApproval] {
        let granted = Set(names(in: grants).map { ($0 as NSString).deletingPathExtension })
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return names(in: tickets).compactMap { name -> PendingApproval? in
            guard let data = try? Data(contentsOf: tickets.appendingPathComponent(name)),
                  let ticket = try? JSONDecoder().decode(PendingApproval.self, from: data),
                  !granted.contains(ticket.id),
                  let ends = formatter.date(from: ticket.expiresAt), ends > now else { return nil }
            return ticket
        }.sorted { $0.expiresAt < $1.expiresAt }
    }

    static func runningActions(directory: URL = running) -> [RunningAction] {
        names(in: directory).compactMap { name in
            guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)) else { return nil }
            return try? JSONDecoder().decode(RunningAction.self, from: data)
        }.sorted { $0.startedAt < $1.startedAt }
    }

    /// Ask the plugin to stop a run. Only an id the plugin could have minted becomes a path.
    static func stop(_ taskId: String, directory: URL = cancel) throws {
        let range = NSRange(taskId.startIndex..., in: taskId)
        guard taskID.firstMatch(in: taskId, range: range) != nil else { throw CocoaError(.fileWriteInvalidFileName) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data(ISO8601DateFormatter().string(from: Date()).utf8).write(to: directory.appendingPathComponent(taskId))
    }

    enum Answer { case once, chat, deny }

    static func arguments(_ answer: Answer, id: String) -> [String] {
        switch answer {
        case .once: return [id]
        case .chat: return [id, "--chat"]
        case .deny: return ["deny", id]
        }
    }

    static func answer(_ answer: Answer, id: String, completion: @escaping (String?) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: approve)
            process.arguments = arguments(answer, id: id)
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
            environment["ORION_APPROVE_VIA"] = "app"
            process.environment = environment
            let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
            var failure: String?
            do {
                try process.run(); process.waitUntilExit()
                if process.terminationStatus != 0 {
                    failure = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                        .trimmingCharacters(in: .whitespacesAndNewlines) ?? "orion-approve refused"
                }
            } catch { failure = error.localizedDescription }
            DispatchQueue.main.async { completion(failure) }
        }
    }

    private static func names(in directory: URL) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).filter { $0.hasSuffix(".json") }
    }
}

/// Polls on its own timer. Hung off an empty view, `.onAppear`/`.onReceive`
/// never attached -- nothing is drawn while nothing is waiting, so SwiftUI had
/// no view to attach them to, and the panel never refreshed (found by putting
/// a real request in front of the installed app, 2026-09-26).
@MainActor
final class ApprovalsModel: ObservableObject {
    @Published var pending: [PendingApproval] = []
    @Published var running: [RunningAction] = []
    private var timer: Timer?

    init() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    deinit { timer?.invalidate() }

    func refresh() {
        let nextPending = ApprovalsStore.pending(), nextRunning = ApprovalsStore.runningActions()
        if nextPending != pending { pending = nextPending }
        if nextRunning != running { running = nextRunning }
    }
}

/// Floats over the dashboard. Nothing is drawn while nothing is waiting or running.
struct ApprovalsOverlay: View {
    @StateObject private var model = ApprovalsModel()
    @State private var busy: String?
    @State private var problem: String?
    private var pending: [PendingApproval] { model.pending }
    private var running: [RunningAction] { model.running }

    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            ForEach(pending) { request in approval(request) }
            ForEach(running) { run in runningRow(run) }
            if let problem {
                Text(problem).font(.system(size: 11)).foregroundStyle(OrionTheme.orange).frame(maxWidth: 360, alignment: .trailing)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: pending)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: running)
    }

    private func refresh() { model.refresh() }

    private func approval(_ request: PendingApproval) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Circle().fill(OrionTheme.orange).frame(width: 7, height: 7)
                Text(request.action == "terminal_run" ? "ORION WANTS TO RUN A COMMAND" : "ORION IS ASKING")
                    .font(OrionTheme.mono(9, .semibold)).tracking(1.2).foregroundStyle(OrionTheme.orange)
                Spacer()
                Text(request.id).font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
            }
            // The whole of what will run, never cut: a hidden tail is where a
            // bad command would sit (review, 2026-09-26). Long ones scroll.
            ScrollView {
                Text(request.summary).font(.system(size: 13, weight: .semibold, design: request.action == "terminal_run" ? .monospaced : .default))
                    .foregroundStyle(OrionTheme.text).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxHeight: 180)
            // The goal line is ORION's own description, so it is labelled as his.
            Text("ORION says: \(request.context)").font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft).lineLimit(2)
            HStack(spacing: 8) {
                answerButton("Allow once", request, .once, prominent: true)
                if request.chatGrantable { answerButton("Allow for this chat", request, .chat) }
                Spacer()
                answerButton("Deny", request, .deny)
            }
        }
        .padding(14)
        .frame(width: 380, alignment: .leading)
        .background(OrionTheme.ink.opacity(0.94), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(OrionTheme.orange.opacity(0.45), lineWidth: 1))
        .shadow(color: .black.opacity(0.4), radius: 18, y: 8)
        .transition(.move(edge: .trailing).combined(with: .opacity))
    }

    private func answerButton(_ title: String, _ request: PendingApproval, _ answer: ApprovalsStore.Answer, prominent: Bool = false) -> some View {
        let tint = answer == .deny ? OrionTheme.red : OrionTheme.accent
        return Button {
            busy = request.id; problem = nil
            ApprovalsStore.answer(answer, id: request.id) { failure in
                busy = nil; problem = failure; refresh()
            }
        } label: {
            Text(title).font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 12).padding(.vertical, 6)
                .foregroundStyle(prominent ? Color.white : tint)
                .background(Capsule().fill(tint.opacity(prominent ? 0.32 : 0.06)))
                .overlay(Capsule().stroke(tint.opacity(0.6), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(busy != nil)
    }

    private func runningRow(_ run: RunningAction) -> some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small)
            VStack(alignment: .leading, spacing: 2) {
                Text(run.commands?.first ?? run.goal).font(.system(size: 12, weight: .medium, design: run.commands?.isEmpty == false ? .monospaced : .default))
                    .foregroundStyle(OrionTheme.text).lineLimit(1)
                Text("running · \(run.actions.joined(separator: ", "))").font(.system(size: 10)).foregroundStyle(OrionTheme.textDim)
            }
            Spacer()
            Button("Stop") {
                do { try ApprovalsStore.stop(run.taskId) } catch { problem = "Could not ask it to stop." }
            }
            .buttonStyle(.plain).font(.system(size: 12, weight: .semibold)).foregroundStyle(OrionTheme.red)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(width: 380)
        .background(OrionTheme.ink.opacity(0.94), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.1), lineWidth: 1))
        .transition(.move(edge: .trailing).combined(with: .opacity))
    }
}
