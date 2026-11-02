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
        VStack(alignment: .leading, spacing: 44) {
            PageHeader(title: "Brand", subline: BrandHeadline.line(readable: readable, total: audience.count, live: live))
            HStack(alignment: .top, spacing: 64) {
                VStack(alignment: .leading, spacing: 46) {
                    HStack(alignment: .top, spacing: 56) {
                        BigNumber(label: "Readable", value: "\(readable)", unit: "of \(audience.count)",
                                  note: "connectors with a reader behind them", hue: OrionTheme.rose, countTo: readable)
                        BigNumber(label: "Live", value: "\(live)", unit: live == 1 ? "feed" : "feeds",
                                  note: "returning data today", hue: OrionTheme.violet, countTo: live)
                            .padding(.top, 18)
                    }
                    .deal(order: 0, rise: 12)
                    audienceSection
                    reflection
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                statusRail
                    .frame(width: 300)
                    .padding(.top, 64)
            }
        }
    }

    private var live: Int {
        audience.filter { ConnectorSpec.spec(for: $0).dataClient && connections.state($0).isConnected }.count
    }

    // MARK: - Audience

    private var audienceSection: some View {
        HairlineSection(title: "Audience", trailing: "\(readable) of \(audience.count) readable", order: 1) {
            VStack(spacing: 0) {
                ForEach(audience) { id in
                    let spec = ConnectorSpec.spec(for: id)
                    DataRow(label: spec.name,
                            sublabel: spec.purpose,
                            value: value(for: id),
                            valueTint: tint(for: id))
                    if id != audience.last { RowHairline() }
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

    /// The day's question, as a Home card: the one discrete thing on this page that asks something of him.
    private var reflection: some View {
        OutlineCard(hue: OrionTheme.violet, tilt: -0.8) {
            VStack(alignment: .leading, spacing: 0) {
                Kicker(text: "Today's reflection", hue: OrionTheme.violet).padding(.bottom, 12)
                CardTitle("Where is the account going? What's working? What's failing?")
                    .padding(.bottom, 10)
                CardBody("Say it to Orion and it lands in your notes — the composer on Home takes it in plain language.")
            }
        }
        .frame(maxWidth: 560, alignment: .leading)
        .deal(order: 2, rise: 22)
    }

    // MARK: - Status

    private var statusRail: some View {
        HairlineSection(title: "Why nothing is live", order: 3) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Signing in to these stores a token. Nothing in Orion reads them yet, so a follower count would be a number this app invented.")
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textSoft)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Whoop and Plaid are the two connectors with real readers behind them — Health and Finances show genuine data.")
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textDim)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
