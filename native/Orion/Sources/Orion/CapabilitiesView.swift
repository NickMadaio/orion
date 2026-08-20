import SwiftUI

/*
 The capability switches, with the one thing a list of switches cannot say on
 its own: that a switch being on is only half of the answer.

 The layout is deliberately not a flat list of eighteen toggles. They are
 grouped by what they cost you if they are wrong, the group blurb says what the
 group has in common, and the row that lets Orion rewrite his own source is
 drawn as its own thing rather than as the eighteenth item in a column.
*/

struct CapabilitiesView: View {
    @ObservedObject var model: CapabilitiesModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionRule(title: "Capabilities",
                        trailing: model.loaded
                            ? "\(model.enabledCount) of \(CapabilityCatalog.all.count) on"
                            : "reading…")

            profileCard
            hotReloadNote

            if let error = model.lastError { banner(error, tint: OrionTheme.red) }
            if let note = model.lastNote { banner(note, tint: OrionTheme.green) }

            ForEach(CapabilityCatalog.groups) { group in
                groupBlock(group)
            }

            authorityBlock
        }
        .onAppear { if !model.loaded { model.load() } }
    }

    // MARK: - The half of the answer that is not a switch

    /// The profile, read-only and on purpose.
    ///
    /// It is not editable here because changing it is a different kind of
    /// decision from flipping a capability — it moves every capability at once,
    /// and `orion-authority` is where that is done deliberately rather than by
    /// a mis-click in a settings panel.
    private var profileCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Circle()
                    .fill(model.profile == nil ? OrionTheme.textDim : OrionTheme.accent)
                    .frame(width: 6, height: 6)
                Text("Permission profile")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OrionTheme.text)
                Spacer(minLength: 8)
                Text(model.profile ?? "unknown")
                    .font(OrionTheme.mono(11, .semibold))
                    .foregroundStyle(model.profile == nil ? OrionTheme.textDim : OrionTheme.accent)
            }

            Text("A capability needs BOTH its switch below AND this profile to allow it. "
                 + "Turning a switch on does not by itself let Orion do the thing — the profile still "
                 + "decides whether it happens silently, happens and then tells you, or has to be "
                 + "approved first. A switch that is on and a profile that forbids it means nothing "
                 + "happens.")
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textSoft)
                .fixedSize(horizontal: false, vertical: true)

            if model.blockedCount > 0 {
                Text("\(model.blockedCount) switch\(model.blockedCount == 1 ? " is" : "es are") "
                     + "on right now that this profile will not let run. They are marked below.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let updated = model.profileUpdatedAt {
                Text("Set \(updated.formatted(date: .abbreviated, time: .shortened)). "
                     + "Read-only here — change it with: orion-authority")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(OrionTheme.accent.opacity(0.06))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(OrionTheme.accent.opacity(0.22), lineWidth: 0.75)
                }
        }
    }

    /// What actually happens when you flip one, including the part that is
    /// less convenient than it was assumed to be.
    ///
    /// These were expected to hot-reload. They do not, or at least OpenClaw
    /// does not claim they do: `openclaw config set` answers every write with
    /// "Restart the gateway to apply", and the gateway is a long-lived node
    /// process that loaded this plugin's config when it started. Printing
    /// "no restart needed" here because that was the plan would be the exact
    /// failure this project keeps naming — a UI that reports the intention
    /// instead of the state.
    private var hotReloadNote: some View {
        Text("Each change is backed up, written through the openclaw CLI so the schema validates "
             + "it, and re-validated afterwards. The CLI then asks for a gateway restart to apply "
             + "it — the running gateway loaded this config when it started. Restart it with: "
             + "openclaw gateway restart")
            .font(OrionTheme.mono(10))
            .foregroundStyle(OrionTheme.textDim)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func banner(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(OrionTheme.mono(10))
            .foregroundStyle(tint)
            .fixedSize(horizontal: false, vertical: true)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(tint.opacity(0.10))
            }
    }

    // MARK: - Groups

    @ViewBuilder
    private func groupBlock(_ group: CapabilityGroup) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionRule(title: group.title,
                        trailing: "\(group.flags.filter { model.value($0) }.count)/\(group.flags.count)")
            Text(group.blurb)
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 0) {
                ForEach(group.flags) { flag in
                    row(flag)
                    if flag.id != group.flags.last?.id {
                        Rectangle().fill(OrionTheme.line).frame(height: 1)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func row(_ flag: CapabilityFlag) -> some View {
        let isOn = model.value(flag)
        let stark = flag.gravity == .rewritesSelf

        VStack(alignment: .leading, spacing: 5) {
            Toggle(isOn: Binding(
                get: { isOn },
                // Not a two-way binding onto stored state: the model writes
                // through the CLI and republishes what the file actually says
                // afterwards, so the switch reflects disk rather than intent.
                set: { model.set(flag, to: $0) }
            )) {
                HStack(spacing: 8) {
                    Text(flag.title)
                        .font(.system(size: 13, weight: stark ? .semibold : .medium))
                        .foregroundStyle(stark && isOn ? OrionTheme.red : OrionTheme.text)
                    if stark {
                        Text("REWRITES ITSELF")
                            .font(OrionTheme.mono(8, .semibold))
                            .tracking(1.1)
                            .foregroundStyle(OrionTheme.red)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Capsule().strokeBorder(OrionTheme.red.opacity(0.5),
                                                               lineWidth: 1))
                    } else if flag.gravity == .consequential {
                        Text("CONSEQUENTIAL")
                            .font(OrionTheme.mono(8, .semibold))
                            .tracking(1.1)
                            .foregroundStyle(OrionTheme.orange)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Capsule().strokeBorder(OrionTheme.orange.opacity(0.45),
                                                               lineWidth: 1))
                    }
                    if model.busyKey == flag.key {
                        ProgressView().controlSize(.small)
                    }
                }
            }
            .toggleStyle(.switch)
            .tint(stark ? OrionTheme.red : OrionTheme.accent)
            .disabled(model.busyKey != nil || !model.loaded)

            Text(flag.grants)
                .font(OrionTheme.mono(10))
                .foregroundStyle(stark ? OrionTheme.orange.opacity(0.95) : OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 620, alignment: .leading)

            // The point of the whole panel, said on the one row where it is
            // currently true rather than only in the explanation at the top.
            if model.blockedByProfile(flag), let required = flag.minimumProfile {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(OrionTheme.orange)
                    Text("On, and still cannot fire: this needs the \(required.rawValue) profile "
                         + "and yours is \(model.profile ?? "unknown"). The switch is necessary "
                         + "and not sufficient.")
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(OrionTheme.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: 620, alignment: .leading)
            }

            Text(flag.key)
                .font(OrionTheme.mono(9))
                .foregroundStyle(OrionTheme.textDim.opacity(0.7))
        }
        .padding(.vertical, 10)
        .padding(stark ? 10 : 0)
        .background {
            if stark {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(OrionTheme.red.opacity(isOn ? 0.10 : 0.04))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(OrionTheme.red.opacity(isOn ? 0.45 : 0.18),
                                          lineWidth: 0.75)
                    }
            }
        }
    }

    // MARK: - Authority

    /// The only place that answers the real question.
    ///
    /// This panel can show a flag and a profile; it cannot combine them with
    /// the exec allowlist and the per-action catalog metadata. `orion-authority`
    /// already does exactly that from live state, so it is surfaced rather than
    /// reimplemented — a second derivation would be a second thing to drift.
    private var authorityBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionRule(title: "What this adds up to")

            Text("The switches and the profile combine with the exec allowlist to decide each "
                 + "action. orion-authority works that out from live state and is the honest "
                 + "answer to “can he actually do it”.")
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 18) {
                InlineAction(title: model.authorityBusy ? "Asking…" : "Explain what Orion can do",
                             systemImage: "sparkles") {
                    model.explain()
                }
                InlineAction(title: "Reload", systemImage: "arrow.clockwise",
                             tint: OrionTheme.textSoft) {
                    model.load()
                }
            }

            if let authority = model.authority {
                ScrollView {
                    Text(authority)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 260)
                .padding(10)
                .background {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.04))
                }
            }
        }
    }
}
