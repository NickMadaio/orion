//
//  Gate 10's switches, on screen at last.
//
//  Every one of these was built and tested and then had no UI, which meant they
//  may as well not have existed — a capability nobody can turn on is a
//  capability nobody has. This is the surface.
//
//  Each toggle states what it costs BEFORE it is flipped, not after. That is
//  the whole shape of this section: these add a permission, a destructive
//  power, or a battery cost, and somebody deciding whether to accept that needs
//  to read the terms first. So the disclosure is above the switch, not in a
//  tooltip.
//

import SwiftUI
import SessionDomain
import SessionService

struct FocusSettings: View {

    @ObservedObject var extras: FocusExtras
    let focusControl: FocusModeControl
    let focusConfigured: Bool
    let focusSetup: String
    var onRecheckFocus: () -> Void

    @AppStorage(FocusModeControl.Key.shortcutName) private var shortcutName = ""
    @AppStorage(FocusModeControl.Key.mode) private var focusMode = ""
    @AppStorage(FocusModeControl.Key.customModes) private var customModes = ""
    @State private var cameraAuthorised = CameraPresence.isAuthorized

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "Focus session", trailing: "\(onCount) on")

            Text("All of these are off until you turn them on. A session works "
                 + "without any of them.")
                .font(.system(size: 11))
                .foregroundStyle(OrionTheme.textDim)

            toggle(
                "Full-screen breaks",
                detail: "The break window covers the screen instead of floating over it. "
                      + "Command-Tab and Force Quit still work, and the button is still the way out.",
                isOn: $extras.fullBleedBreak
            )

            focusModeSection

            toggle(
                "Pause Apple Music",
                detail: "Pauses Music when a session starts and resumes it at the end — "
                      + "but only if Orion was the one that paused it. Needs Automation "
                      + "permission for Music, which macOS asks for the first time.",
                isOn: $extras.pauseMusic
            )

            cameraToggle

            quittableSection
        }
    }

    private var onCount: Int {
        [extras.fullBleedBreak, extras.doNotDisturb, extras.pauseMusic,
         extras.cameraPresence, extras.quitDistractions].filter { $0 }.count
    }

    // MARK: Focus mode

    /// One Shortcut, any Focus mode.
    ///
    /// The name is a field rather than a constant because the old design
    /// hardcoded two names Nick never created, and complained about a missing
    /// "Orion Focus On" at every single launch. A name he can correct here is a
    /// thirty-second fix instead of a rebuild.
    private var focusModeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            toggle(
                "Set a Focus mode during a session",
                detail: focusConfigured
                    ? "Runs your Shortcut with “on \(focusControl.sessionMode)” when a session "
                    + "starts and “off \(focusControl.sessionMode)” when it ends. Only turns it "
                    + "off if Orion was the one that turned it on."
                    : focusSetup,
                isOn: $extras.doNotDisturb,
                warn: !focusConfigured
            )

            field("Shortcut name", text: $shortcutName,
                  placeholder: FocusModeControl.defaultShortcutName)
            field("Mode a session turns on", text: $focusMode,
                  placeholder: FocusModeControl.defaultMode)
            field("Focus modes you made", text: $customModes,
                  placeholder: "comma separated, e.g. deep work, studio")

            Text("Orion knows: " + focusControl.knownModes.joined(separator: ", "))
                .font(.system(size: 10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func field(_ title: String, text: Binding<String>,
                       placeholder: String) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.system(size: 11))
                .foregroundStyle(OrionTheme.textDim)
                .frame(width: 132, alignment: .leading)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(OrionTheme.mono(11))
                .foregroundStyle(OrionTheme.textSoft)
                .padding(.horizontal, 7).padding(.vertical, 4)
                .background {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                }
                .onSubmit { onRecheckFocus() }
        }
    }

    // MARK: Camera

    /// The one with a real privacy cost, so the terms are stated in full and
    /// the permission is requested explicitly rather than on first use.
    private var cameraToggle: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: Binding(
                get: { extras.cameraPresence },
                set: { wants in
                    extras.cameraPresence = wants
                    guard wants, !CameraPresence.isAuthorized else { return }
                    CameraPresence.requestAccess { granted in
                        cameraAuthorised = granted
                        if !granted { extras.cameraPresence = false }
                    }
                }
            )) {
                Text("Check whether you are at the desk")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.text)
            }
            .toggleStyle(.switch)
            .tint(OrionTheme.accent)

            Text(CameraPresence.disclosure)
                .font(.system(size: 10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)

            if extras.cameraPresence && !cameraAuthorised {
                Text("Camera access has not been granted, so this will do nothing.")
                    .font(.system(size: 10))
                    .foregroundStyle(OrionTheme.orange)
            }
        }
    }

    // MARK: Closing distractions

    /// No list. That was the whole complaint — twice — and the list stayed empty
    /// while the switch sat there claiming to do something.
    ///
    /// What replaced it is not "Orion decides now". It is a mechanical floor
    /// that removes anything holding unsaved work, anything that is part of
    /// macOS, and anything he has touched in the last two minutes; a reasoned
    /// decision over what is left, against the task he typed; and a second run
    /// through the floor at the moment of quitting. The disclosure below says
    /// exactly that, because a capability that closes apps has to be legible
    /// before it is switched on.
    private var quittableSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            toggle(
                "Close distracting apps",
                detail: "At session start Orion looks at what is running and closes what "
                      + "is not part of the task you typed. Never anything with unsaved "
                      + "changes, anything it cannot read, the app you are in, anything "
                      + "used in the last two minutes, or a terminal, editor, recorder or "
                      + "password manager. Always a polite quit, never a force quit.",
                isOn: $extras.quitDistractions
            )

            Text(accessibilityGranted
                 ? "Every decision, closed or kept, is written to the log with its reason."
                 : "Accessibility is not granted, so Orion cannot tell which apps have "
                   + "unsaved work — with it off, nothing is ever closed.")
                .font(.system(size: 10))
                .foregroundStyle(accessibilityGranted ? OrionTheme.textDim : OrionTheme.orange)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var accessibilityGranted: Bool { AccessibilityDocumentSensor.isAvailable }

    // MARK: A toggle with its terms

    private func toggle(_ title: String, detail: String,
                        isOn: Binding<Bool>, warn: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: isOn) {
                Text(title)
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.text)
            }
            .toggleStyle(.switch)
            .tint(OrionTheme.accent)

            Text(detail)
                .font(.system(size: 10))
                .foregroundStyle(warn ? OrionTheme.orange : OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
