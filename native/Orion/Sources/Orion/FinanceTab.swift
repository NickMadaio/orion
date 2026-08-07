import SwiftUI

/// Money. Balances lead; the terms of the connection sit in a narrow rail
/// beside them, offset down, because they matter once and then never again.
struct FinanceTab: View {
    @ObservedObject var connections: ConnectionsModel
    @ObservedObject var plaid: PlaidClient

    private var currency: String { plaid.accounts.first?.currency ?? "USD" }

    var body: some View {
        HStack(alignment: .top, spacing: 54) {
            VStack(alignment: .leading, spacing: 34) {
                accounts
                subscriptions
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            terms
                .frame(width: 300)
                .padding(.top, 52)
        }
    }

    // MARK: - Accounts

    private var accounts: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionRule(title: "Accounts",
                        trailing: plaid.accounts.isEmpty
                            ? connections.state(.plaid).label
                            : "\(plaid.accounts.count) linked")

            if !plaid.accounts.isEmpty {
                BigStat(value: String(format: "%.2f", plaid.totalBalance),
                        unit: currency,
                        caption: "total balance",
                        size: 44)

                VStack(spacing: 0) {
                    ForEach(plaid.accounts) { account in
                        DataRow(label: account.maskedLabel,
                                sublabel: "\(account.type) · \(account.subtype)",
                                value: account.current.map { String(format: "%.2f", $0) } ?? "—",
                                valueTint: OrionTheme.green)
                        if account.id != plaid.accounts.last?.id {
                            Rectangle().fill(OrionTheme.line).frame(height: 1)
                        }
                    }
                }
                .padding(.top, 4)

                if let synced = plaid.lastSyncedAt {
                    Text("synced \(synced.formatted(date: .omitted, time: .shortened)) · \(PlaidClient.environment)")
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(OrionTheme.textDim)
                }
            } else if plaid.isWorking {
                HStack(spacing: 12) {
                    ProgressView().controlSize(.small)
                    Text(plaid.status.isEmpty ? "Working…" : plaid.status)
                        .font(.system(size: 13))
                        .foregroundStyle(OrionTheme.textSoft)
                    Spacer(minLength: 12)
                    InlineAction(title: "Cancel", tint: OrionTheme.textSoft) { plaid.cancel() }
                }
                Text("Sandbox: phone 415-555-0011, code 123456, then user_good / pass_good.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            } else {
                VStack(spacing: 0) {
                    NotConnected(what: "Chase", detail: "Balances and recent transactions, via Plaid.")
                    Rectangle().fill(OrionTheme.line).frame(height: 1)
                    NotConnected(what: "Fidelity", detail: "Balances and positions, via Plaid.")
                }
                Text("Both banks connect through one Plaid account — set it up in Settings ▸ Connections.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            }

            if let error = plaid.lastError {
                Text(error)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Subscriptions

    private var subscriptions: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Subscriptions")
            NotConnected(what: "Recurring charges",
                         detail: "Detected from transactions once an account is linked.")
        }
    }

    // MARK: - Terms

    /// Straight from INTEGRATION_HANDOFF.md, on the screen rather than in a
    /// document, because this is the moment it matters.
    private var terms: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionRule(title: "How this connects", trailing: "read-only")

            Term(icon: "lock.shield",
                 text: "Plaid Link, with you present. Orion never sees or stores a bank password.",
                 tint: OrionTheme.textSoft)
            Term(icon: "eye",
                 text: "Account names, masked numbers, balances, recent transactions.",
                 tint: OrionTheme.textSoft)
            Term(icon: "xmark.shield",
                 text: "Transfers, payments and trading stay out of scope entirely.",
                 tint: OrionTheme.red.opacity(0.9))
        }
    }
}

private struct Term: View {
    let icon: String
    let text: String
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(tint.opacity(0.8))
                .frame(width: 14)
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(tint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
