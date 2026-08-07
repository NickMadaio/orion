import SwiftUI

/// Brand. Honest about what is wired up, which currently is none of it.
///
/// This tab used to print LIVE beside TikTok, Instagram and YouTube whenever a
/// token existed for them. No client reads any of those tokens — connecting
/// stored a credential and fetched nothing, forever. A green LIVE label on a
/// connector that returns no data is worse than an empty screen: it sends you
/// looking for a bug in the wrong place. `ConnectorSpec.dataClient` now says
/// which connectors actually have a reader behind them, and this tab shows
/// exactly that.
struct BrandTab: View {
    @ObservedObject var connections: ConnectionsModel

    private let audience: [ConnectorID] = [.tiktok, .instagram, .google]

    var body: some View {
        HStack(alignment: .top, spacing: 54) {
            VStack(alignment: .leading, spacing: 34) {
                audienceSection
                reflection
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            statusRail
                .frame(width: 300)
                .padding(.top, 52)
        }
    }

    // MARK: - Audience

    private var audienceSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionRule(title: "Audience", trailing: "\(readable) of \(audience.count) readable")

            VStack(spacing: 0) {
                ForEach(audience) { id in
                    let spec = ConnectorSpec.spec(for: id)
                    DataRow(label: spec.name,
                            sublabel: spec.purpose,
                            value: value(for: id),
                            valueTint: tint(for: id))
                    if id != audience.last {
                        Rectangle().fill(OrionTheme.line).frame(height: 1)
                    }
                }
            }
        }
    }

    private func value(for id: ConnectorID) -> String {
        let spec = ConnectorSpec.spec(for: id)
        guard spec.dataClient else { return "NO READER" }
        return connections.state(id).isConnected ? "LIVE" : "OFF"
    }

    private func tint(for id: ConnectorID) -> Color {
        let spec = ConnectorSpec.spec(for: id)
        guard spec.dataClient else { return OrionTheme.orange }
        return connections.state(id).isConnected ? OrionTheme.green : OrionTheme.textDim
    }

    private var readable: Int {
        audience.filter { ConnectorSpec.spec(for: $0).dataClient }.count
    }

    // MARK: - Reflection

    private var reflection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionRule(title: "Today's reflection")
            Text("Where is the account going? What's working? What's failing?")
                .font(OrionTheme.display(22))
                .foregroundStyle(OrionTheme.textSoft)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 520, alignment: .leading)
            Text("Say it to Orion and it lands in your notes — the composer on Home takes it in plain language.")
                .font(.system(size: 13))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 520, alignment: .leading)
        }
    }

    // MARK: - Status

    private var statusRail: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Why nothing is live")
            Text("Signing in to these stores a token. Nothing in Orion reads them yet, so a follower count would be a number this app invented.")
                .font(.system(size: 12))
                .foregroundStyle(OrionTheme.textSoft)
                .fixedSize(horizontal: false, vertical: true)
            Text("Whoop and Plaid are the two connectors with real readers behind them — Health and Finances show genuine data.")
                .font(.system(size: 12))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
