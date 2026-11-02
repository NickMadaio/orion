import SessionDomain
import SwiftUI

/// Home (wave 12 redesign, 2026-11-02): a greeting, a spread of proactive cards built from ORION's real data, and
/// the composer. Nick: "the entire home page … the little app shortcuts? all gone. again model the sentientOS UI."
///
/// Three faces, as before: the transcript when he is talking to ORION, the full morning brief when the day has just
/// started (or a card asked for it), and otherwise the scene. The cards and their rules are in Home/HomeCards.swift;
/// this file wires their buttons to the app's existing actions.
struct HomeTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var session: SessionTabModel
    @ObservedObject var writer: NarrativeWriter
    /// Nil until the day's facts have been gathered.
    let brief: BriefFacts?
    let signals: HomeSignals
    @Binding var presentation: BriefPresentation
    /// The height Home has to work with, so the composer can sit at the bottom.
    let availableHeight: CGFloat
    var onOpenTab: (DashboardTab) -> Void
    var onMarkDone: (String) -> Void

    @FocusState private var composerFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if state.chatMode {
                VStack(alignment: .leading, spacing: 0) {
                    InlineAction(title: "BACK TO HOME", systemImage: "arrow.left", tint: OrionTheme.textSoft) {
                        OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) {
                            state.chatMode = false
                            presentation = .parked
                        }
                    }
                    .help("Return to the main Home view; keep this conversation")
                    .padding(.bottom, 10)
                    SharedChatView(state: state).frame(height: max(420, availableHeight - 50))
                        .transition(OrionMotion.rise(reduceMotion: reduceMotion, distance: 14))
                }
                .padding(.horizontal, 24)
                .transition(.opacity)
            } else if presentation == .full, let brief {
                MorningBriefPanel(facts: brief, writer: writer) {
                    OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) { presentation = .parked }
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
                .transition(OrionMotion.rise(reduceMotion: reduceMotion))
            } else {
                scene.transition(.opacity)
            }
        }
        .animation(OrionMotion.resolved(OrionMotion.page, reduceMotion: reduceMotion), value: state.chatMode)
        .onAppear { composerFocused = true }
        // Bumped every time the window is summoned, so a second click on the
        // menu bar re-focuses the field instead of doing nothing visible.
        .onChange(of: state.focusComposerToken) { _, _ in composerFocused = true }
    }

    // MARK: The scene

    private var cards: [HomeCard] { HomeCardBuilder.cards(brief: brief, signals: liveSignals) }

    /// The file-backed signals, plus the focus session as it is right now.
    private var liveSignals: HomeSignals {
        var signals = signals
        signals.focus = HomeFocus(live: session.hasLiveSession, minimized: state.sessionMinimized,
                                  headline: session.task ?? session.headline, remaining: session.remainingLine)
        return signals
    }

    private var scene: some View {
        let clock = brief?.clock ?? BriefClock(now: Date())
        let cards = cards
        return HomeScene(greeting: HomeGreeting.line(clock: clock, name: signals.selfName),
                         subline: HomeGreeting.subline(knowledgeCount: signals.knowledgeCount, cardCount: cards.count, clock: clock),
                         cards: cards, glance: HomeGlance.items(brief: brief, signals: liveSignals), hologram: state.hologram,
                         availableHeight: availableHeight, onAction: perform) {
            HomeComposerBar(text: $state.composer, focus: $composerFocused, listening: state.phase == .listening,
                            line: composerLine, onVoice: toggleVoice, onChat: openChat, onSend: submit)
        }
    }

    // MARK: Card actions — each an action the app already had

    private func perform(_ action: HomeCardAction) {
        switch action {
        case .answer(let id):
            // The same hand-off a tapped question bubble makes: the next turn is the reply to this one.
            OutreachReplyTo.set(id)
            openChat()
        case .openPlan: onOpenTab(.tasks)
        case .openHealth: onOpenTab(.health)
        case .openProject(let id):
            // The Projects tab keeps its selection here; setting it first opens the tab on this run.
            if let id { UserDefaults.standard.set(id, forKey: "orion.projects.selected") }
            onOpenTab(.project)
        case .openFinance: onOpenTab(.finance)
        case .openBrief:
            OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) { presentation = .full }
        case .startFocus(let task):
            session.defaultTask = task ?? "Focus"
            session.perform(SessionTabModel.Action(title: "Start", icon: "play", kind: .start))
            state.sessionMinimized = false
        case .resumeFocus:
            OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) { state.sessionMinimized = false }
        case .markDone(let id): onMarkDone(id)
        case .ask(let prefill):
            state.composer = prefill
            openChat()
        }
    }

    // MARK: Composer

    private var composerLine: HomeComposerLine {
        var line = HomeComposerLine()
        if state.phase != .idle {
            line.phase = HomeComposerLine.Phase(title: phaseTitle, detail: state.statusLine, tint: phaseColor)
        }
        if session.hasLiveSession {
            line.focus = (["FOCUS", session.headline] + (session.remainingLine.map { [$0] } ?? [])).joined(separator: " · ").uppercased()
            line.controls = session.availableActions.map { action in
                HomeComposerLine.Control(title: action.title) { session.perform(action) }
            }
        }
        return line
    }

    private func openChat() {
        OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) { state.chatMode = true }
    }

    private func submit() {
        guard !state.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        state.submitTyped()
        composerFocused = true
    }

    private func toggleVoice() {
        if state.phase == .listening { state.endListening() } else { state.beginListening(handsFree: true) }
    }

    private var phaseTitle: String {
        switch state.phase {
        case .idle: "ORION IS READY"
        case .listening: "LISTENING"
        case .thinking: "THINKING"
        case .speaking: "SPEAKING"
        case .error: "NEEDS ATTENTION"
        }
    }

    private var phaseColor: Color {
        switch state.phase {
        case .idle: OrionTheme.green
        case .listening: OrionTheme.accent
        case .thinking: OrionTheme.violet
        case .speaking: OrionTheme.orange
        case .error: OrionTheme.red
        }
    }
}
