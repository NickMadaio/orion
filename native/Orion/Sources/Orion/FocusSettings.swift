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
    let quittable: QuittableApps
    let dndConfigured: Bool
    let dndSetup: String

    @State private var quittableList: [QuittableApp] = []
    @State private var candidates: [QuittableApp] = []
    @State private var showingCandidates = false
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

            toggle(
                "Do Not Disturb during a session",
                detail: dndConfigured
                    ? "Turns Focus on when a session starts and off when it ends. "
                    + "Only turns it off if Orion was the one that turned it on."
                    : dndSetup,
                isOn: $extras.doNotDisturb,
                warn: !dndConfigured
            )

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

    // MARK: Quittable apps

    /// Two independent conditions for the one destructive capability: the
    /// switch, and a list Nick wrote himself. Either alone does nothing.
    private var quittableSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            toggle(
                "Close distracting apps",
                detail: "Only apps you list below, and only ever with a polite quit — "
                      + "an app with unsaved work will ask you, and Orion takes no for an "
                      + "answer. Orion never decides what goes on this list.",
                isOn: $extras.quitDistractions
            )

            if quittableList.isEmpty {
                Text(extras.quitDistractions
                     ? "Your list is empty, so nothing will be closed."
                     : "No apps listed.")
                    .font(.system(size: 10))
                    .foregroundStyle(extras.quitDistractions ? OrionTheme.orange : OrionTheme.textDim)
            } else {
                ForEach(quittableList) { app in
                    HStack(spacing: 8) {
                        Text(app.name)
                            .font(.system(size: 12))
                            .foregroundStyle(OrionTheme.textSoft)
                        Spacer(minLength: 8)
                        InlineAction(title: "remove", tint: OrionTheme.textDim) {
                            quittable.remove(app.bundleID)
                            quittableList = quittable.list()
                        }
                    }
                }
            }

            InlineAction(title: showingCandidates ? "Done" : "Add an app…",
                         tint: OrionTheme.textSoft) {
                if !showingCandidates { candidates = QuittableApps.candidates() }
                showingCandidates.toggle()
            }

            if showingCandidates {
                ForEach(candidates.filter { candidate in
                    !quittableList.contains { $0.bundleID == candidate.bundleID }
                }) { candidate in
                    HStack(spacing: 8) {
                        Text(candidate.name)
                            .font(.system(size: 12))
                            .foregroundStyle(OrionTheme.textDim)
                        Spacer(minLength: 8)
                        InlineAction(title: "add", tint: OrionTheme.accent) {
                            quittable.add(candidate)
                            quittableList = quittable.list()
                        }
                    }
                }
            }
        }
        .onAppear { quittableList = quittable.list() }
    }

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
