import AppKit
import SwiftUI

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

    var body: some View {
        HStack(alignment: .top, spacing: 54) {
            VStack(alignment: .leading, spacing: 36) {
                surface
                core
                quickOpen
                voice
            }
            .frame(width: 380)
            .fixedSize(horizontal: true, vertical: false)

            VStack(alignment: .leading, spacing: 36) {
                calendars
                ConnectionsView(connections: connections)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 46)
        }
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
            SectionRule(title: "Surface")

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
            SectionRule(title: "Calendars",
                        trailing: agenda.calendars.isEmpty ? "none" : "\(agenda.calendars.count) visible")

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
            SectionRule(title: "Orion core")
            Picker("Visual", selection: $coreStyle) {
                Text("Original Orion").tag("original")
                Text("Black Hole").tag("blackHole")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text("The floating voice hologram always stays Original Orion; this changes the dashboard centrepiece only.")
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Quick open

    private var quickOpen: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Quick open")
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
            SectionRule(title: "Voice timing")
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
