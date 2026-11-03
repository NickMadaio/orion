import AppKit
import SwiftUI
import SessionService

/// Settings. Two columns: what Orion looks like on the left, what he is wired
/// into on the right — the longest section, so it gets its own full column
/// rather than being the thing you scroll past everything else to reach.
struct SettingsTab: View {
    @Binding var coreStyle: String
    @Binding var iconScale: Double
    @Binding var surfaceOpacity: Double
    @Binding var surfaceBlur: Bool
    @ObservedObject var connections: ConnectionsModel
    @ObservedObject var agenda: AppleCalendarSync
    /// Full Disk Access has no API, so its state is inferred from whether the
    /// Messages database actually opened. See PermissionsAudit.
    let messagesAccess: MessagesReader.Access
    var onRecheck: () -> Void
    @ObservedObject var state: AppState

    /// Gate 10's switches, which had no surface at all until now.
    @ObservedObject var focusExtras: FocusExtras
    /// What Orion is allowed to DO, as opposed to what macOS lets him see.
    /// Lived only in openclaw.json until now, which meant editing JSON by hand
    /// to change your assistant's powers.
    @ObservedObject var capabilities: CapabilitiesModel
    let focusControl: FocusModeControl
    let focusConfigured: Bool
    let focusSetup: String
    var onRecheckFocus: () -> Void

    /// Settings should open as a compact index, not as a wall of account and
    /// integration detail. Each section expands only when it is needed.
    @State private var expanded: Set<String> = []
    @ObservedObject private var mouse = MouseController.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 46) {
            PageHeader(title: "Settings", subline: summary)
                .onAppear { openRequestedSection() }
                .onChange(of: state.requestedSettingsSection) { _, _ in openRequestedSection() }
            HStack(alignment: .top, spacing: 64) {
                VStack(alignment: .leading, spacing: 0) {
                    section("Permissions", hint: "\(grantedCount) of \(states.count) granted", order: 0) { permissions }
                    section("Focus session", hint: focusConfigured ? "focus mode ready" : "focus mode not set up", order: 1) {
                        FocusSettings(extras: focusExtras, focusControl: focusControl,
                                      focusConfigured: focusConfigured, focusSetup: focusSetup,
                                      onRecheckFocus: onRecheckFocus)
                    }
                    section("Surface", hint: "\(transparencyPercent)% transparent\(surfaceBlur ? " · frosted" : "")", order: 2) { surface }
                    section("Orion core", hint: "the hologram on Home", order: 3) { core }
                    section("Quick open", hint: "icons at \(Int(iconScale * 100))%", order: 4) { quickOpen }
                    section("Push to talk", hint: state.pushToTalk.enabled ? "on" : "off", order: 5) { PushToTalkSettingsView(state: state) }
                    section("Mouse", hint: mouse.devices.devices.contains { $0.connected } ? "\(mouse.devices.devices.first { $0.connected }?.name ?? "connected")" : "no mouse with extra buttons", order: 7) { MouseSettingsView(mouse: mouse) }
                    section("Voice timing", hint: "\(VoiceTuning.endpointingMs) ms before he answers", order: 6) { voice }
                }
                .frame(width: 380)
                .fixedSize(horizontal: true, vertical: false)

                // The longer column starts a step lower, so the two never read as one grid.
                VStack(alignment: .leading, spacing: 0) {
                    section("Model usage", hint: "what each model has cost", order: 1) { ModelUsageView() }
                    section("iPhone", hint: "the phone link", order: 2) { PhoneLinkView() }
                    section("Calendars", hint: agenda.access.isGranted ? "\(agenda.calendars.count) visible to macOS" : "no access yet", order: 3) { calendars }
                    section("Connections", hint: "\(connectedCount) connected", order: 4) { ConnectionsView(connections: connections) }
                    section("What Orion may do", hint: "his powers, not his permissions", order: 5) {
                        CapabilitiesView(model: capabilities)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 28)
            }
        }
    }

    /// The new-mouse bubble's "Set up" lands here: expand the section it asked for.
    private func openRequestedSection() {
        guard let name = state.requestedSettingsSection else { return }
        expanded.insert(name)
        state.requestedSettingsSection = nil
    }

    /// The header's one true line: how much of what Orion needs he actually has.
    private var summary: String {
        SettingsHeadline.line(granted: grantedCount, permissions: states.count, connected: connectedCount)
    }

    private var connectedCount: Int { connections.states.values.filter(\.isConnected).count }

    /// A collapsible section.
    ///
    /// Six sections stacked flat is what made this tab feel like a form. They
    /// are not equally interesting — permissions and the focus switches are why
    /// anybody opens Settings, and the surface sliders are set once and then
    /// never touched. Collapsing is not decoration here; it is the difference
    /// between finding a toggle and scrolling past five others to reach it.
    ///
    /// Wave 13: no plate behind it any more. A closed section is its name in serif with a hairline under it that
    /// fades off to the right; an open one keeps the same row and lets its content breathe below. Grouping is
    /// spacing and that hairline, as on Home.
    @ViewBuilder
    private func section(_ title: String, hint: String, order: Int, @ViewBuilder content: () -> some View) -> some View {
        let isOpen = expanded.contains(title)
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.16)) {
                    if isOpen { expanded.remove(title) } else { expanded.insert(title) }
                }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(title)
                        .font(OrionTheme.serif(17))
                        .foregroundStyle(isOpen ? OrionTheme.text : OrionTheme.text.opacity(0.78))
                    Spacer(minLength: 12)
                    Text(hint)
                        .font(OrionTheme.mono(9.5))
                        .foregroundStyle(Color.white.opacity(0.36))
                        .lineLimit(1)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(isOpen ? OrionTheme.accent : OrionTheme.textDim)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                }
                .padding(.vertical, 13)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(isOpen ? [.isSelected] : [])

            if isOpen {
                content()
                    .padding(.top, 6)
                    .padding(.bottom, 22)
            }
            FadingRule(tint: isOpen ? OrionTheme.accent : .white)
        }
        .deal(order: order, rise: 10)
    }

    // MARK: - Surface

    /// The control that was the whole complaint.
    ///
    /// It used to be one slider over a frosted blur, so the only thing it could
    /// change was how dark the frost was. Transparency and frost are separate
    /// now because they are separate things: the slider is real alpha, and at
    /// 100% Orion paints nothing at all and you are looking at your desktop
    /// through his text.
    private var surface: some View {
        VStack(alignment: .leading, spacing: 14) {
            
            HStack(alignment: .firstTextBaseline) {
                Text("Transparency")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OrionTheme.text)
                Spacer()
                Text("\(transparencyPercent)%")
                    .font(OrionTheme.mono(12, .semibold))
                    .foregroundStyle(OrionTheme.accent)
            }

            Slider(value: Binding(
                get: { SurfaceSettings.opacityRange.upperBound - surfaceOpacity },
                set: { surfaceOpacity = SurfaceSettings.opacityRange.upperBound - $0 }
            ), in: 0...SurfaceSettings.opacityRange.upperBound)
                .tint(OrionTheme.accent)

            Text(transparencyHint)
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)

            Toggle(isOn: $surfaceBlur) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Frost what shows through")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(OrionTheme.text)
                    Text("Blurs the desktop behind Orion. Off means you see it sharp.")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
            .toggleStyle(.switch)
            .tint(OrionTheme.accent)
            .padding(.top, 6)
        }
    }

    private var transparencyPercent: Int {
        let upper = SurfaceSettings.opacityRange.upperBound
        guard upper > 0 else { return 0 }
        return Int(((upper - surfaceOpacity) / upper * 100).rounded())
    }

    private var transparencyHint: String {
        switch transparencyPercent {
        case 92...: return "Pure glass — nothing is painted. The header keeps its own shading so it stays readable."
        case 55..<92: return "Mostly glass. The desktop reads clearly through the page."
        case 20..<55: return "Tinted. A good middle over a busy wallpaper."
        default: return "Nearly solid — this is the old look."
        }
    }

    // MARK: - Permissions

    /// What Orion is allowed to do, and which of those it can ask for.
    private var permissions: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionRule(title: "Permissions", trailing: "\(grantedCount) of \(states.count)")

            VStack(spacing: 0) {
                ForEach(states) { permission in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 10) {
                            Circle()
                                .fill(permission.tint)
                                .frame(width: 6, height: 6)
                            Text(permission.name)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(OrionTheme.text)
                            Spacer(minLength: 8)
                            Text(permission.label)
                                .font(OrionTheme.mono(9))
                                .foregroundStyle(permission.tint)
                            Button { PermissionsAudit.open(permission.settingsURL) } label: {
                                Image(systemName: "arrow.up.right")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(OrionTheme.textDim)
                                    .frame(width: 18, height: 18)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                        Text(permission.purpose)
                            .font(OrionTheme.mono(9))
                            .foregroundStyle(OrionTheme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.leading, 16)
                        // The distinction that matters: two of these macOS
                        // will never let an app request.
                        if !permission.requestable {
                            Text("granted by hand only — no app can prompt for this")
                                .font(OrionTheme.mono(9))
                                .foregroundStyle(OrionTheme.orange.opacity(0.8))
                                .padding(.leading, 16)
                        }
                    }
                    .padding(.vertical, 9)
                    if permission.id != states.last?.id {
                        Rectangle().fill(OrionTheme.line).frame(height: 1)
                    }
                }
            }

            InlineAction(title: "Re-check", systemImage: "arrow.clockwise", tint: OrionTheme.textSoft) {
                onRecheck()
            }
        }
    }

    private var states: [PermissionState] { PermissionsAudit.all(messages: messagesAccess, pushToTalkEnabled: state.pushToTalk.enabled) }
    private var grantedCount: Int { states.filter { $0.status == .granted }.count }

    // MARK: - Calendars

    /// What EventKit can actually see.
    ///
    /// This exists because "my Google event is not showing up" had no answer.
    /// Google reaches macOS over CalDAV and then arrives through EventKit like
    /// anything else, so the question is never about Orion's code — it is
    /// whether the account is connected at the system level. Listing every
    /// calendar with its account and its event count answers that outright.
    private var calendars: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !agenda.access.isGranted {
                Text(agenda.statusLine)
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else if agenda.calendars.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("macOS has no calendar accounts")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(OrionTheme.orange)
                    Text("Orion reads calendars through macOS, which is how Google works here without a Google API. Add the account in System Settings ▸ Internet Accounts and turn Calendars on — the events appear here with no further setup.")
                        .font(.system(size: 12))
                        .foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(agenda.calendars) { info in
                        DataRow(label: info.title,
                                sublabel: info.source + " · " + info.kind
                                    + (info.writable ? "" : " · read-only"),
                                value: "\(info.eventsInWindow)",
                                valueTint: info.eventsInWindow > 0 ? OrionTheme.green : OrionTheme.textDim)
                        if info.id != agenda.calendars.last?.id {
                            Rectangle().fill(OrionTheme.line).frame(height: 1)
                        }
                    }
                }
                Text(agenda.hasGoogle
                     ? "Google is connected through macOS — its events arrive with iCloud's, already merged."
                     : "No Google account is visible. If you expect one, add it in System Settings ▸ Internet Accounts with Calendars enabled.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(agenda.hasGoogle ? OrionTheme.textDim : OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 18) {
                InlineAction(title: "Open Internet Accounts", systemImage: "arrow.up.right") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preferences.internetaccounts") {
                        NSWorkspace.shared.open(url)
                    }
                }
                InlineAction(title: "Reload", systemImage: "arrow.clockwise", tint: OrionTheme.textSoft) {
                    agenda.refresh()
                }
            }
        }
    }

    // MARK: - Core

    private var core: some View {
        VStack(alignment: .leading, spacing: 14) {
                        Picker("Visual", selection: $coreStyle) {
                Text("Thinking Orion").tag("thinkingOrion")
                Text("Original Orion").tag("original")
                Text("Black Hole").tag("blackHole")
                Text("Blue Orion").tag("blueOrion")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text("Choose the hologram for Home and the floating voice view. Thinking Orion combines slow orb geometry with the original filament shell, arcs, chips, bright core and audio response. Blue Orion is the same projection in electric blue.")
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Quick open

    private var quickOpen: some View {
        VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .firstTextBaseline) {
                Text("Icon size")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OrionTheme.text)
                Spacer()
                Text("\(Int(iconScale * 100))%")
                    .font(OrionTheme.mono(12, .semibold))
                    .foregroundStyle(OrionTheme.accent)
            }
            Slider(value: $iconScale, in: 0.72...1.45, step: 0.05)
                .tint(OrionTheme.accent)
            Text("Use Customize on Home to place the icons; this only changes their scale.")
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Voice

    private var voice: some View {
        VStack(alignment: .leading, spacing: 10) {
                        DataRow(label: "Pause before Orion answers",
                    sublabel: "raise it if he cuts you off mid-sentence",
                    value: "\(VoiceTuning.endpointingMs) ms",
                    valueTint: OrionTheme.accent)
            Rectangle().fill(OrionTheme.line).frame(height: 1)
            DataRow(label: "Stuck-speech watchdog",
                    sublabel: "forces the speaking phase to end if audio stalls",
                    value: "\(Int(VoiceTuning.stallTimeout)) s",
                    valueTint: OrionTheme.accent)
            Text("Orion can change these himself — just tell him to wait longer before answering.")
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
