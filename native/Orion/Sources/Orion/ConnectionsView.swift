import AppKit
import SwiftUI

/*
 Where a connector gets set up.

 The shape of this screen follows from one fact: for every service here, the
 slow part is not the code, it is Nick going to a developer portal, creating an
 app, and finding two strings. So the setup steps are ON the card, in order,
 with the exact redirect URI to paste — rather than in a README he would have to
 go and find while already halfway through a form on someone else's website.

 Secrets are entered here and go straight to the Keychain. They are never
 rendered back: a revealed secret is one screen-share away from being burned,
 and there is no reason to show it again once it works.

 Two states are new and both exist to stop this screen lying. `cannotRenew` is a
 sign-in that works today and cannot survive the hour — the actual cause of
 having to reconnect Whoop every morning. And a connector with no reader behind
 it says so, rather than showing a healthy green dot for a token nothing will
 ever send anywhere.
*/

struct ConnectionsView: View {
    @ObservedObject var connections: ConnectionsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionRule(title: "Connections", trailing: "\(connectedCount) of \(ConnectorSpec.all.count) live")
                .padding(.bottom, 6)

            ForEach(ConnectorSpec.all, id: \.id) { spec in
                ConnectorRow(spec: spec, connections: connections)
                if spec.id != ConnectorSpec.all.last?.id {
                    Rectangle().fill(OrionTheme.line).frame(height: 1)
                }
            }
        }
    }

    private var connectedCount: Int {
        ConnectorSpec.all.filter { connections.state($0.id).isConnected }.count
    }
}

private struct ConnectorRow: View {
    let spec: ConnectorSpec
    @ObservedObject var connections: ConnectionsModel

    @State private var expanded = false
    @State private var clientID = ""
    @State private var clientSecret = ""

    private var state: ConnectionState { connections.state(spec.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 7, height: 7)
                    .shadow(color: dotColor.opacity(0.8), radius: 4)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(spec.name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(OrionTheme.text)
                        if spec.readOnly { tag("READ-ONLY", tint: OrionTheme.green) }
                        if !spec.dataClient { tag("NO READER YET", tint: OrionTheme.orange) }
                    }
                    Text(spec.purpose)
                        .font(.system(size: 12))
                        .foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 12)

                Text(state.label)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(stateColor)
                    .fixedSize()

                actionButton

                // Always reachable, and that is the fix for a real dead end.
                // The setup block used to open only from the `needsCredentials`
                // action, so the moment a client id and secret were saved there
                // was NO route back to those fields — not from `connected`,
                // which offers Disconnect, and not from `readyToConnect`, which
                // offers Connect. Rotating a secret or moving from Sandbox to
                // Production was therefore impossible without deleting the
                // Keychain items by hand.
                Button {
                    withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(expanded ? OrionTheme.text : OrionTheme.textDim)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(expanded ? "Hide setup" : "Keys and setup")
            }

            // The explanation belongs beside the state, not in a log file.
            if case .cannotRenew = state {
                Text("This sign-in has no refresh token, so it expires within the hour and cannot renew itself — that is why it asks again every day. Reconnecting once, now that Orion requests offline access, fixes it for good.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.orange.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 620, alignment: .leading)
            }

            // Plaid is the one connector with two live environments, and the
            // difference is not cosmetic: Sandbox has no real banks in it at
            // all. Putting the switch on the row means "why am I looking at
            // First Platypus Bank" has a visible answer.
            if spec.id == .plaid { environmentPicker }

            if spec.id == .plaid, connections.plaidSecretMismatch {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(OrionTheme.orange)
                    Text("The stored secret was entered for the other environment. Plaid issues a different secret per environment, so paste the \(PlaidClient.environment.uppercased()) one below — Developers ▸ Keys in the Plaid dashboard.")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.orange.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 620, alignment: .leading)
                }
                .padding(.leading, 19)
            }

            if expanded { setupBlock }
        }
        .padding(.vertical, 16)
    }

    @ViewBuilder private var environmentPicker: some View {
        HStack(spacing: 14) {
            Text("ENVIRONMENT")
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.6)
                .foregroundStyle(OrionTheme.textDim)

            ForEach(["sandbox", "production"], id: \.self) { option in
                let selected = PlaidClient.environment == option
                Button {
                    PlaidClient.setEnvironment(option)
                    connections.refreshAll()
                } label: {
                    Text(option.uppercased())
                        .font(OrionTheme.mono(9, .semibold))
                        .tracking(1.2)
                        .foregroundStyle(selected ? OrionTheme.ink : OrionTheme.textSoft)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background {
                            Capsule()
                                .fill(selected ? (option == "production" ? OrionTheme.green : OrionTheme.orange) : .clear)
                                .overlay(Capsule().strokeBorder(OrionTheme.line, lineWidth: selected ? 0 : 1))
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }

            Text(PlaidClient.isProduction
                 ? "Real banks. Needs your PRODUCTION secret above."
                 : "Test banks only — First Platypus, fake balances.")
                .font(OrionTheme.mono(9))
                .foregroundStyle(PlaidClient.isProduction ? OrionTheme.green : OrionTheme.textDim)
            Spacer(minLength: 0)
        }
        .padding(.leading, 19)
    }

    private func tag(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(OrionTheme.mono(8, .semibold))
            .tracking(1.1)
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().strokeBorder(tint.opacity(0.35), lineWidth: 1))
    }

    @ViewBuilder private var actionButton: some View {
        if connections.busy == spec.id {
            ProgressView().controlSize(.small)
        } else {
            switch state {
            case .checking:
                // The Keychain has not answered. On the first launch after a
                // rebuild that is a SecurityAgent prompt waiting to be
                // answered, so this can sit here for a while — offering a
                // Connect button against state Orion does not have yet would
                // just start a flow that fails.
                ProgressView().controlSize(.small)
            case .connected:
                InlineAction(title: "Disconnect", tint: OrionTheme.textSoft) {
                    connections.disconnect(spec.id)
                }
            case .cannotRenew:
                LogButton(title: "Reconnect", systemImage: "arrow.clockwise", tint: OrionTheme.orange) {
                    connections.connect(spec.id)
                }
            case .readyToConnect, .expired, .failed:
                LogButton(title: "Connect", systemImage: "arrow.right", tint: OrionTheme.green) {
                    connections.connect(spec.id)
                }
            case .notBuilt:
                InlineAction(title: expanded ? "Hide" : "Why not?", tint: OrionTheme.textSoft) {
                    expanded.toggle()
                }
            case .needsCredentials:
                InlineAction(title: expanded ? "Hide" : "Set up") { expanded.toggle() }
            }
        }
    }

    private var setupBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(spec.setupSteps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: 10) {
                    Text("\(index + 1)")
                        .font(OrionTheme.mono(9, .semibold))
                        .foregroundStyle(OrionTheme.textDim)
                        .frame(width: 12, alignment: .trailing)
                    Text(step)
                        .font(.system(size: 12))
                        .foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack(spacing: 20) {
                InlineAction(title: "Open \(spec.name) portal", systemImage: "arrow.up.right") {
                    if let url = URL(string: spec.registerURL) { NSWorkspace.shared.open(url) }
                }
                if case .oauth2 = spec.auth, spec.id != .google {
                    // The single most-mistyped field in the whole flow, and a
                    // wrong one fails with a provider error that does not say
                    // which field was wrong.
                    InlineAction(title: "Copy redirect URI", systemImage: "doc.on.doc", tint: OrionTheme.textSoft) {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString("orion://oauth/\(spec.id.rawValue)", forType: .string)
                    }
                }
            }

            if case .notBuilt(let why) = state {
                Text(why)
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(spacing: 12) {
                    credentialField("Client ID", text: $clientID, secure: false)
                    credentialField("Client Secret", text: $clientSecret, secure: true)
                    LogButton(title: "Save", systemImage: "checkmark") {
                        connections.saveCredentials(spec.id, clientID: clientID, clientSecret: clientSecret)
                        // Cleared immediately: they are in the Keychain now, and
                        // leaving them in a text field is just a copy waiting to
                        // be shoulder-surfed.
                        clientID = ""
                        clientSecret = ""
                        expanded = false
                    }
                    .disabled(clientID.isEmpty || clientSecret.isEmpty)
                }

                Text("Stored in your Keychain, never in the project folder and never in a git diff.")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
        .padding(.leading, 19)
        .padding(.top, 4)
    }

    private func credentialField(_ title: String, text: Binding<String>, secure: Bool) -> some View {
        Group {
            if secure {
                SecureField(title, text: text)
            } else {
                TextField(title, text: text)
            }
        }
        .textFieldStyle(.plain)
        .font(OrionTheme.mono(11))
        .foregroundStyle(OrionTheme.text)
        .padding(.vertical, 7)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.white.opacity(0.14)).frame(height: 1)
        }
    }

    private var dotColor: Color {
        switch state {
        case .connected: return OrionTheme.green
        case .cannotRenew: return OrionTheme.orange
        case .expired, .failed: return OrionTheme.red
        case .readyToConnect: return OrionTheme.orange
        case .checking, .needsCredentials, .notBuilt: return OrionTheme.textDim
        }
    }

    private var stateColor: Color {
        switch state {
        case .connected: return OrionTheme.green
        case .cannotRenew: return OrionTheme.orange
        case .expired, .failed: return OrionTheme.red
        default: return OrionTheme.textDim
        }
    }
}
