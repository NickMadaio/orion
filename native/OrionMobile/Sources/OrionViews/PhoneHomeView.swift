import MobileCore
import SwiftUI
import ThinkingOrbsKit

/*
 The phone Home screen (wave 16): the Mac Home at phone size. A greeting with a mono subline and a small hologram,
 the glance row, then a short column of tilted outline cards: what's next, ORION's open question, approvals, and
 the Done early pill near the thumb. A "Message ORION" bar at the bottom keeps the chat one tap away.

 Plain values in, closures out (PhoneHomeActions), so the app wires it to RemoteStore and renders draw it from fixtures.
 Cards deal in with SoftReveal on the shared schedule; Reduce Motion fades only.
*/

public struct PhoneHomeActions {
    public var onMenu: () -> Void = {}
    public var onOpenChat: () -> Void = {}
    /// Opens the chat with this ask bound as the reply target.
    public var onReply: (String) -> Void = { _ in }
    /// A quick answer: (askID, option).
    public var onAnswer: (String, String) -> Void = { _, _ in }
    public var onDecline: (String) -> Void = { _ in }
    /// (approvalID, approve).
    public var onDecide: (String, Bool) -> Void = { _, _ in }
    public var onDoneEarly: () -> Void = {}
    public var onAddWater: () -> Void = {}
    public var onOpenGlance: (PhoneHome.GlanceItem.Kind) -> Void = { _ in }
    public var onOpenPlan: () -> Void = {}
    public init() {}
}

/// What the app knows about things in flight.
public struct PhoneHomeStatus: Equatable {
    public var online: Bool
    public var presence: String
    public var earlyWorking: Bool
    public var earlyFeedback: String?
    /// Approvals already answered on this screen, by id: true approved, false denied.
    public var decided: [String: Bool]
    /// Asks already answered here.
    public var answered: Set<String>
    public init(online: Bool = true, presence: String = "Mac online", earlyWorking: Bool = false, earlyFeedback: String? = nil,
                decided: [String: Bool] = [:], answered: Set<String> = []) {
        self.online = online; self.presence = presence; self.earlyWorking = earlyWorking; self.earlyFeedback = earlyFeedback
        self.decided = decided; self.answered = answered
    }
}

public struct PhoneHomeView: View {
    let home: PhoneHome
    let status: PhoneHomeStatus
    let actions: PhoneHomeActions
    /// Renders only: a fixed moment of the hologram.
    var orbFrameTime: Double?
    /// Renders only: ImageRenderer draws nothing inside a ScrollView, so a render lays the column out flat.
    var scrolls = true

    @Environment(\.colorScheme) private var scheme
    @State private var confirmingEarly = false

    public init(home: PhoneHome, status: PhoneHomeStatus, actions: PhoneHomeActions, orbFrameTime: Double? = nil, scrolls: Bool = true) {
        self.home = home; self.status = status; self.actions = actions; self.orbFrameTime = orbFrameTime; self.scrolls = scrolls
    }

    public var body: some View {
        let ink = PhoneHomeInk(scheme)
        VStack(spacing: 0) {
            topBar(ink)
            if scrolls { ScrollView { column(ink) } } else { column(ink); Spacer(minLength: 0) }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .safeAreaInset(edge: .bottom, spacing: 0) { messageBar(ink) }
        .background(backdrop(ink).ignoresSafeArea())
        .confirmationDialog(home.doneEarly.title, isPresented: $confirmingEarly, titleVisibility: .visible) {
            Button("Yes, I'm done") { actions.onDoneEarly() }
            Button("Cancel", role: .cancel) {}
        } message: { Text(home.doneEarly.hint) }
    }

    private func column(_ ink: PhoneHomeInk) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            header(ink).softReveal(delay: 0.05)
            if !home.glance.isEmpty {
                PhoneHomeGlanceRow(items: home.glance, onAddWater: actions.onAddWater, onOpen: actions.onOpenGlance)
                    .softReveal(delay: 0.15)
            }
            cards.padding(.top, 6)
        }
        .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 28)
    }

    // MARK: Top

    private func topBar(_ ink: PhoneHomeInk) -> some View {
        HStack {
            barButton("line.3.horizontal", label: "Menu", id: "openDrawer", ink: ink, action: actions.onMenu)
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(status.online ? PhoneHomeHue.done : ink.dim).frame(width: 5, height: 5)
                Text(status.presence).font(.system(size: 11)).foregroundStyle(ink.dim)
            }
            Spacer()
            barButton("bubble.left", label: "Chat with ORION", id: "homeOpenChat", ink: ink, action: actions.onOpenChat)
        }
        .padding(.horizontal, 8).frame(height: 48)
    }

    private func barButton(_ symbol: String, label: String, id: String, ink: PhoneHomeInk, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 18)).foregroundStyle(ink.text)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(HomePressStyle()).accessibilityLabel(label).accessibilityIdentifier(id)
    }

    private func header(_ ink: PhoneHomeInk) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 9) {
                Text(home.greeting).font(.system(size: 30, weight: .medium, design: .rounded)).foregroundStyle(ink.text)
                    .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                Text(home.subline).font(.system(size: 10, weight: .medium, design: .monospaced)).tracking(2.8)
                    .foregroundStyle(ink.dim)
            }
            Spacer(minLength: 0)
            ZStack {
                Circle().strokeBorder(ink.text.opacity(0.14), lineWidth: 0.8).shadow(color: PhoneHomeHue.accent.opacity(0.35), radius: 8)
                OrionThinkingHologram(state: home.ask != nil || !home.approvals.isEmpty ? .listening : .breathing,
                                      brightness: 0.85, frameTime: orbFrameTime)
                    .padding(8)
            }
            .frame(width: 78, height: 78)
            .accessibilityHidden(true)
        }
        .padding(.top, 6)
    }

    // MARK: Cards

    private var cards: some View {
        VStack(alignment: .leading, spacing: 22) {
            let list = cardOrder
            ForEach(Array(list.enumerated()), id: \.element) { index, card in
                view(for: card, tilt: Self.tilts[index % Self.tilts.count])
                    .padding(.leading, Self.nudges[index % Self.nudges.count])
                    .padding(.trailing, -Self.nudges[index % Self.nudges.count])
                    .deal(order: index, rise: 18)
            }
        }
    }

    private enum Card: Hashable { case next, empty, ask, approval(String), early }

    private var cardOrder: [Card] {
        var cards: [Card] = [home.next == nil ? .empty : .next]
        if let ask = home.ask, !status.answered.contains(ask.id) { cards.append(.ask) }
        cards += home.approvals.map { .approval($0.id) }
        cards.append(.early)
        return cards
    }

    // Hand-tuned, as on the Mac spread but smaller: phones are narrow.
    private static let tilts: [Double] = [-0.8, 0.6, -0.4, 0.7, -0.6]
    private static let nudges: [CGFloat] = [0, 6, -4, 4, -2]

    @ViewBuilder private func view(for card: Card, tilt: Double) -> some View {
        switch card {
        case .next: nextCard(tilt: tilt)
        case .empty:
            PhoneHomeCard(hue: PhoneHomeHue.event, kicker: ["WHAT'S NEXT"], title: "Your day shows here once Calendar or your Mac is connected.",
                          tilt: tilt) { EmptyView() }
        case .ask: askCard(tilt: tilt)
        case .approval(let id): if let approval = home.approvals.first(where: { $0.id == id }) { approvalCard(approval, tilt: tilt) }
        case .early: earlyCard(tilt: tilt)
        }
    }

    @ViewBuilder private func nextCard(tilt: Double) -> some View {
        if let next = home.next {
            PhoneHomeCard(hue: PhoneHomeHue.event, kicker: next.kicker, title: next.title,
                          lines: [next.now, next.after].compactMap { $0 }, tilt: tilt) {
                PhoneHomePill(title: "Open my day", hue: PhoneHomeHue.event, symbol: "calendar", action: actions.onOpenPlan)
            }
            .accessibilityIdentifier("homeNext")
        }
    }

    @ViewBuilder private func askCard(tilt: Double) -> some View {
        if let ask = home.ask {
            PhoneHomeCard(hue: PhoneHomeHue.question, kicker: ask.kicker, title: ask.text, tilt: tilt) {
                VStack(alignment: .leading, spacing: 12) {
                    if !ask.options.isEmpty {
                        HStack(spacing: 8) {
                            ForEach(ask.options, id: \.self) { option in
                                PhoneHomePill(title: option, hue: PhoneHomeHue.question, symbol: "arrow.turn.down.right") {
                                    actions.onAnswer(ask.id, option)
                                }
                            }
                        }
                    }
                    HStack(spacing: 18) {
                        PhoneHomePill(title: "Reply", hue: PhoneHomeHue.question, symbol: "arrowshape.turn.up.left") { actions.onReply(ask.id) }
                            .accessibilityIdentifier("homeReply")
                        PhoneHomeLink(title: "Not now") { actions.onDecline(ask.id) }
                    }
                }
            }
        }
    }

    private func approvalCard(_ approval: PhoneHome.Approval, tilt: Double) -> some View {
        PhoneHomeCard(hue: PhoneHomeHue.approval, kicker: approval.kicker, title: approval.title,
                      lines: approval.detail.map { [$0] } ?? [], tilt: tilt) {
            if let decision = status.decided[approval.id] {
                Text(decision ? "Approving…" : "Denying…").font(.system(size: 13, weight: .medium)).foregroundStyle(PhoneHomeHue.approval)
            } else {
                HStack(spacing: 10) {
                    PhoneHomePill(title: "Approve", hue: PhoneHomeHue.done, symbol: "checkmark") { actions.onDecide(approval.id, true) }
                        .accessibilityIdentifier("homeApprove")
                    PhoneHomePill(title: "Deny", hue: PhoneHomeHue.approval, symbol: "xmark") { actions.onDecide(approval.id, false) }
                        .accessibilityIdentifier("homeDeny")
                }
            }
        }
    }

    private func earlyCard(tilt: Double) -> some View {
        PhoneHomeCard(hue: PhoneHomeHue.done, kicker: home.doneEarly.kicker, title: home.doneEarly.title,
                      lines: status.earlyFeedback.map { [$0] } ?? [], tilt: tilt) {
            PhoneHomePill(title: DoneEarly.label, hue: PhoneHomeHue.done, symbol: DoneEarly.symbol, working: status.earlyWorking,
                          large: true) { confirmingEarly = true }
                .disabled(status.earlyWorking)
                .accessibilityHint(home.doneEarly.hint)
                .accessibilityIdentifier("homeDoneEarly")
        }
    }

    // MARK: Bottom

    private func messageBar(_ ink: PhoneHomeInk) -> some View {
        Button(action: actions.onOpenChat) {
            HStack(spacing: 10) {
                Image(systemName: "sparkle").font(.system(size: 12, weight: .semibold)).foregroundStyle(PhoneHomeHue.accent)
                Text("Message ORION").font(.system(size: 15)).foregroundStyle(ink.dim)
                Spacer()
                Image(systemName: "arrow.up").font(.system(size: 13, weight: .semibold)).foregroundStyle(ink.soft)
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            .background(Capsule().fill(ink.ground).overlay(Capsule().fill(ink.faint.opacity(0.5))))
            .overlay(Capsule().strokeBorder(ink.faint, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(HomePressStyle())
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 10)
        .background(LinearGradient(colors: [ink.ground.opacity(0), ink.ground], startPoint: .top, endPoint: .center).ignoresSafeArea(edges: .bottom))
        .accessibilityIdentifier("homeMessageBar")
    }

    /// Flat ink with one faint pool of light behind the cards, as on the Mac. Static.
    private func backdrop(_ ink: PhoneHomeInk) -> some View {
        ZStack {
            ink.ground
            RadialGradient(colors: [PhoneHomeHue.accent.opacity(ink.dark ? 0.07 : 0.04), .clear],
                           center: UnitPoint(x: 0.3, y: 0.3), startRadius: 10, endRadius: 360)
            RadialGradient(colors: [PhoneHomeHue.question.opacity(ink.dark ? 0.05 : 0.03), .clear],
                           center: UnitPoint(x: 0.8, y: 0.65), startRadius: 10, endRadius: 280)
        }
    }
}
