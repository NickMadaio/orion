import MobileCore
import SwiftUI
import ThinkingOrbsKit

/*
 Home while a focus session runs (wave 19): the Mac's session, on the phone. A big ring counts the phase down with the
 hologram dimmed and calm inside it, the task in serif under a mono kicker ("FOCUS · 32 MIN LEFT"), and three pills:
 Done early, Break now (a pause: the Mac's engine has no break-from-focus command), and I need an app. During a break
 the same ring counts the break down, in a warmer hue. Everything is derived from the snapshot's FocusSession by
 PhoneFocus.face, so the state machine is tested apart from the screen.

 Plain values in, closures out, like PhoneHomeView. The clock is a one-second TimelineView; with `at` set (renders) it is fixed.
*/

public enum PhoneFocusHue {
    /// Focus: a calm teal, apart from Home's blue and from the cards' hues.
    public static let focus = Color(red: 0.30, green: 0.85, blue: 0.78)
    /// Break: warm amber, so the two phases read differently across the room.
    public static let rest = Color(red: 1.00, green: 0.72, blue: 0.38)
    public static func hue(_ mode: PhoneFocus.Mode) -> Color { mode == .breakTime ? rest : focus }
}

public struct PhoneFocusActions {
    public var onDoneEarly: () -> Void = {}
    /// Pauses the session on the Mac, which lifts the phone's shield.
    public var onBreakNow: () -> Void = {}
    public var onResume: () -> Void = {}
    /// Opens the shield for a few minutes and tells ORION which app was needed.
    public var onNeedApp: () -> Void = {}
    /// Opens More › Focus lists.
    public var onPickApps: () -> Void = {}
    public var onOpenChat: () -> Void = {}
    public init() {}
}

public struct PhoneFocusStatus: Equatable {
    public var online: Bool
    public var presence: String
    /// One line on what the phone is doing about apps: "Shielding Social, Video", "Pick your focus apps", "Break: apps are open".
    public var shield: String?
    /// The shield line is a call to action (no apps picked, or Screen Time not allowed).
    public var shieldNeedsAction: Bool
    public var feedback: String?
    public init(online: Bool = true, presence: String = "Mac online", shield: String? = nil, shieldNeedsAction: Bool = false, feedback: String? = nil) {
        self.online = online; self.presence = presence; self.shield = shield; self.shieldNeedsAction = shieldNeedsAction; self.feedback = feedback
    }
}

public struct PhoneFocusHome: View {
    let session: LinkSnapshot.FocusSession
    let status: PhoneFocusStatus
    let actions: PhoneFocusActions
    var at: Date?
    var orbFrameTime: Double?

    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var confirmingDone = false
    @State private var confirmingNeed = false

    public init(session: LinkSnapshot.FocusSession, status: PhoneFocusStatus, actions: PhoneFocusActions, at: Date? = nil, orbFrameTime: Double? = nil) {
        self.session = session; self.status = status; self.actions = actions; self.at = at; self.orbFrameTime = orbFrameTime
    }

    public var body: some View {
        Group {
            if let at { content(PhoneFocus.face(session, now: at)) }
            else { TimelineView(.periodic(from: .now, by: 1)) { context in content(PhoneFocus.face(session, now: context.date)) } }
        }
        .background(backdrop.ignoresSafeArea())
        .confirmationDialog("Done with this?", isPresented: $confirmingDone, titleVisibility: .visible) {
            Button("Yes, I'm done") { actions.onDoneEarly() }
            Button("Keep going", role: .cancel) {}
        } message: { Text("I'll end the session and put your day back together.") }
        .confirmationDialog("I need an app", isPresented: $confirmingNeed, titleVisibility: .visible) {
            Button("Open my apps for 5 minutes") { actions.onNeedApp() }
            Button("Never mind", role: .cancel) {}
        } message: { Text("I'll lift the shield for five minutes and note that you asked.") }
    }

    private func content(_ face: PhoneFocus.Face) -> some View {
        let ink = PhoneHomeInk(scheme)
        let hue = PhoneFocusHue.hue(face.mode)
        return VStack(spacing: 0) {
            topBar(ink)
            Spacer(minLength: 8)
            ring(face, hue: hue, ink: ink)
            VStack(spacing: 10) {
                Text(face.kicker).font(.system(size: 11, weight: .semibold, design: .monospaced)).tracking(3).foregroundStyle(hue)
                    .accessibilityIdentifier("focusKicker")
                Text(face.title).font(.system(size: 31, design: .serif)).foregroundStyle(ink.text).multilineTextAlignment(.center)
                    .lineLimit(3).fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                if let line = subline(face) {
                    Text(line).font(.system(size: 13.5)).foregroundStyle(ink.soft).multilineTextAlignment(.center)
                }
            }
            .padding(.top, 26).padding(.horizontal, 28)
            Spacer(minLength: 16)
            pills(face, hue: hue)
            shieldLine(ink, hue: hue).padding(.top, 18).padding(.bottom, 22)
        }
        .frame(maxHeight: .infinity)
    }

    private func subline(_ face: PhoneFocus.Face) -> String? {
        switch face.mode {
        case .breakTime: return "Back to \(session.task) when this is over."
        case .paused: return "Paused. Your apps are open."
        default: return face.blockLine
        }
    }

    // MARK: Pieces

    private func topBar(_ ink: PhoneHomeInk) -> some View {
        HStack {
            Color.clear.frame(width: 44, height: 44)
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(status.online ? PhoneHomeHue.done : ink.dim).frame(width: 5, height: 5)
                Text(status.presence).font(.system(size: 11)).foregroundStyle(ink.dim)
            }
            Spacer()
            Button(action: actions.onOpenChat) {
                Image(systemName: "bubble.left").font(.system(size: 18)).foregroundStyle(ink.text).frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(HomePressStyle()).accessibilityLabel("Chat with ORION").accessibilityIdentifier("homeOpenChat")
        }
        .padding(.horizontal, 8).frame(height: 48)
    }

    private func ring(_ face: PhoneFocus.Face, hue: Color, ink: PhoneHomeInk) -> some View {
        let remainingShare = max(0, 1 - face.progress)
        let size: CGFloat = 268
        return ZStack {
            // The hologram, dimmed and calm: still light inside the ring, never competing with the number.
            OrionThinkingHologram(state: .breathing, brightness: 1.5, frameTime: orbFrameTime, palette: .blue)
                .frame(width: 176, height: 176).opacity(ink.dark ? 0.42 : 0.3)
            Circle().strokeBorder(ink.faint, lineWidth: 5)
            Circle().trim(from: 0, to: face.mode == .idle ? 0 : remainingShare)
                .stroke(hue, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: hue.opacity(0.6), radius: 10)
                .padding(2.5)
                .animation(reduceMotion ? nil : .linear(duration: 1), value: remainingShare)
            Text(face.countdown).font(.system(size: 54, weight: .light, design: .monospaced)).foregroundStyle(ink.text)
                .monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
                .shadow(color: .black.opacity(ink.dark ? 0.5 : 0), radius: 6)
                .accessibilityLabel(face.kicker.capitalized).accessibilityIdentifier("focusCountdown")
        }
        .frame(width: size, height: size)
        .softReveal(delay: 0.05)
    }

    private func pills(_ face: PhoneFocus.Face, hue: Color) -> some View {
        VStack(spacing: 12) {
            PhoneHomePill(title: "Done early", hue: PhoneHomeHue.done, symbol: "checkmark", large: true) { confirmingDone = true }
                .accessibilityIdentifier("focusDoneEarly")
            HStack(spacing: 10) {
                if face.mode == .paused {
                    PhoneHomePill(title: "Resume", hue: hue, symbol: "play.fill", action: actions.onResume).accessibilityIdentifier("focusResume")
                } else if face.mode == .focus {
                    PhoneHomePill(title: "Break now", hue: PhoneFocusHue.rest, symbol: "pause.fill", action: actions.onBreakNow).accessibilityIdentifier("focusBreak")
                }
                if face.mode == .focus {
                    PhoneHomePill(title: "I need an app", hue: hue, symbol: "square.grid.2x2") { confirmingNeed = true }
                        .accessibilityIdentifier("focusNeedApp")
                }
            }
        }
        .softReveal(delay: 0.2)
    }

    @ViewBuilder private func shieldLine(_ ink: PhoneHomeInk, hue: Color) -> some View {
        VStack(spacing: 6) {
            if let feedback = status.feedback { Text(feedback).font(.system(size: 12.5)).foregroundStyle(hue) }
            if let line = status.shield {
                if status.shieldNeedsAction {
                    Button(action: actions.onPickApps) {
                        HStack(spacing: 6) {
                            Text(line).font(.system(size: 12, weight: .semibold, design: .monospaced)).tracking(1.4)
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold))
                        }.foregroundStyle(PhoneHomeHue.approval).padding(.vertical, 6).contentShape(Rectangle())
                    }.buttonStyle(HomePressStyle()).accessibilityIdentifier("focusPickApps")
                } else {
                    Text(line).font(.system(size: 11, weight: .medium, design: .monospaced)).tracking(1.4).foregroundStyle(ink.dim)
                }
            }
        }
        .multilineTextAlignment(.center).padding(.horizontal, 24)
    }

    /// Flat ink with a pool of the phase's hue behind the ring. Static.
    private var backdrop: some View {
        let ink = PhoneHomeInk(scheme)
        let hue = PhoneFocusHue.hue(PhoneFocus.face(session, now: at ?? Date()).mode)
        return ZStack {
            ink.ground
            RadialGradient(colors: [hue.opacity(ink.dark ? 0.10 : 0.06), .clear], center: UnitPoint(x: 0.5, y: 0.34), startRadius: 10, endRadius: 380)
        }
    }
}

/// The slim banner the other tabs wear while a focus session runs. One tap goes back to Home.
public struct PhoneFocusBanner: View {
    let session: LinkSnapshot.FocusSession
    var at: Date?
    let onTap: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(session: LinkSnapshot.FocusSession, at: Date? = nil, onTap: @escaping () -> Void) {
        self.session = session; self.at = at; self.onTap = onTap
    }

    public var body: some View {
        Group {
            if let at { bar(PhoneFocus.face(session, now: at)) }
            else { TimelineView(.periodic(from: .now, by: 15)) { bar(PhoneFocus.face(session, now: $0.date)) } }
        }
    }

    @ViewBuilder private func bar(_ face: PhoneFocus.Face) -> some View {
        if face.mode != .idle {
            let ink = PhoneHomeInk(scheme), hue = PhoneFocusHue.hue(face.mode)
            Button(action: onTap) {
                HStack(spacing: 10) {
                    Circle().fill(hue).frame(width: 6, height: 6).shadow(color: hue.opacity(0.8), radius: 4)
                    Text(face.kicker).font(.system(size: 10, weight: .semibold, design: .monospaced)).tracking(2).foregroundStyle(hue).lineLimit(1)
                    Text(face.title).font(.system(size: 13, design: .serif)).foregroundStyle(ink.soft).lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(ink.dim)
                }
                .padding(.horizontal, 16).frame(height: 34).frame(maxWidth: .infinity)
                .background(Capsule().fill(hue.opacity(0.07)))
                .overlay(Capsule().strokeBorder(hue.opacity(0.5), lineWidth: 0.9))
                .padding(.horizontal, 14).padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(HomePressStyle())
            .accessibilityLabel("\(face.kicker.capitalized), \(face.title). Back to focus.")
            .accessibilityIdentifier("focusBanner")
        }
    }
}
