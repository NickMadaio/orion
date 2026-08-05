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
*/

struct ConnectionsView: View {
    @ObservedObject var connections: ConnectionsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "Connections", trailing: "\(connectedCount) of \(ConnectorSpec.all.count) live")
            ForEach(ConnectorSpec.all, id: \.id) { spec in
                ConnectorCard(spec: spec, connections: connections)
            }
        }
    }

    private var connectedCount: Int {
        ConnectorSpec.all.filter { connections.state($0.id).isConnected }.count
    }
}

private struct ConnectorCard: View {
    let spec: ConnectorSpec
    @ObservedObject var connections: ConnectionsModel

    @State private var expanded = false
    @State private var clientID = ""
    @State private var clientSecret = ""

    private var state: ConnectionState { connections.state(spec.id) }

    var body: some View {
        OrionPanel {
            HStack(spacing: 12) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(spec.name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(OrionTheme.text)
                        if spec.readOnly {
                            Text("READ-ONLY")
                                .font(OrionTheme.mono(8, .semibold))
                                .tracking(1)
                                .foregroundStyle(OrionTheme.green)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Capsule().stroke(OrionTheme.green.opacity(0.35), lineWidth: 1))
                        }
                    }
                    Text(spec.purpose)
                        .font(.system(size: 12))
                        .foregroundStyle(OrionTheme.textSoft)
                }
                Spacer(minLength: 8)
                Text(state.label)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(stateColor)
                actionButton
            }

            if expanded {
                Divider().overlay(OrionTheme.line)
                setupBlock
            }
        }
    }

    @ViewBuilder private var actionButton: some View {
        if connections.busy == spec.id {
            ProgressView().controlSize(.small)
        } else {
            switch state {
            case .connected:
                Button("Disconnect") { connections.disconnect(spec.id) }
                    .buttonStyle(.plain)
                    .font(OrionTheme.mono(10, .semibold))
                    .foregroundStyle(OrionTheme.textDim)
            case .readyToConnect, .expired, .failed:
                Button("Connect") { connections.connect(spec.id) }
                    .buttonStyle(.plain)
                    .font(OrionTheme.mono(10, .semibold))
                    .foregroundStyle(OrionTheme.ink)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Capsule().fill(OrionTheme.green))
            case .needsCredentials:
                Button(expanded ? "Hide" : "Set up") { expanded.toggle() }
                    .buttonStyle(.plain)
                    .font(OrionTheme.mono(10, .semibold))
                    .foregroundStyle(OrionTheme.blue)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Capsule().stroke(OrionTheme.blue.opacity(0.4), lineWidth: 1))
            }
        }
    }

    private var setupBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(spec.setupSteps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: 8) {
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

            HStack(spacing: 8) {
                Button {
                    if let url = URL(string: spec.registerURL) { NSWorkspace.shared.open(url) }
                } label: {
                    Label("Open \(spec.name) portal", systemImage: "arrow.up.right.square")
                        .font(OrionTheme.mono(10, .semibold))
                        .foregroundStyle(OrionTheme.blue)
                }
                .buttonStyle(.plain)

                if case .oauth2 = spec.auth {
                    Button {
                        // The single most-mistyped field in the whole flow, and
                        // a wrong one fails with a provider error that does not
                        // say which field was wrong.
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString("orion://oauth/\(spec.id.rawValue)", forType: .string)
                    } label: {
                        Label("Copy redirect URI", systemImage: "doc.on.doc")
                            .font(OrionTheme.mono(10, .semibold))
                            .foregroundStyle(OrionTheme.textSoft)
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 8) {
                secureField("Client ID", text: $clientID, secure: false)
                secureField("Client Secret", text: $clientSecret, secure: true)
                Button("Save") {
                    connections.saveCredentials(spec.id, clientID: clientID, clientSecret: clientSecret)
                    // Cleared immediately: they are in the Keychain now, and
                    // leaving them in a text field is just a copy waiting to be
                    // shoulder-surfed.
                    clientID = ""
                    clientSecret = ""
                    expanded = false
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(OrionTheme.ink)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(.white))
                .disabled(clientID.isEmpty || clientSecret.isEmpty)
            }

            Text("Stored in your Keychain, never in the project folder and never in a git diff.")
                .font(OrionTheme.mono(9))
                .foregroundStyle(OrionTheme.textDim)
        }
    }

    private func secureField(_ title: String, text: Binding<String>, secure: Bool) -> some View {
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
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 8).fill(OrionTheme.cardRaised)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(OrionTheme.line, lineWidth: 1))
        )
    }

    private var dotColor: Color {
        switch state {
        case .connected: return OrionTheme.green
        case .expired, .failed: return OrionTheme.red
        case .readyToConnect: return OrionTheme.orange
        case .needsCredentials: return OrionTheme.textDim
        }
    }

    private var stateColor: Color {
        switch state {
        case .connected: return OrionTheme.green
        case .expired, .failed: return OrionTheme.red
        default: return OrionTheme.textDim
        }
    }
}
