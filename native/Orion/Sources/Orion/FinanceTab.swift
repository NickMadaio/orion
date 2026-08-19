import SwiftUI

/*
 Money.

 The old tab was a list of balances and three sentences about how Plaid would
 eventually connect. Now that it is connected, the interesting question is not
 "what is in the accounts" — the bank app answers that — it is what the numbers
 mean together: what you are worth after debts, what this month costs compared
 to last, what is charging you every month whether you use it or not.

 Net worth leads, and it is signed: a credit-card balance is a debt, not
 savings. See `PlaidAccount.isLiability` — summing every `current` is the single
 most misleading thing a finance screen can do, and it is the default mistake.
*/

struct FinanceTab: View {
    @ObservedObject var connections: ConnectionsModel
    @ObservedObject var plaid: PlaidClient
    @ObservedObject var writer: NarrativeWriter
    let day: LogicalDay

    private var monthStart: Date {
        Calendar.current.date(from: Calendar.current.dateComponents([.year, .month], from: Date()))
            ?? Date()
    }

    var body: some View {
        Group {
            if plaid.accounts.isEmpty {
                emptyState
            } else {
                connected
            }
        }
        .onAppear {
            plaid.refresh()
            loadSummary()
        }
        .onChange(of: plaid.lastSyncedAt) { _, _ in loadSummary() }
    }

    // MARK: - Connected

    private var connected: some View {
        HStack(alignment: .top, spacing: 44) {
            VStack(alignment: .leading, spacing: 42) {
                OrionPanel(padding: 22) { hero }
                OrionPanel(padding: 20) { flow }
                OrionPanel(padding: 20) { spendingBreakdown }
                OrionPanel(padding: 20) { accountsSection }
                OrionPanel(padding: 20) { recent }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            OrionPanel(padding: 18) { rail }
                .frame(width: 262)
                .padding(.top, 44)
        }
    }

    // MARK: - Hero

    private var hero: some View {
        HStack(alignment: .top, spacing: 46) {
            VStack(alignment: .leading, spacing: 6) {
                Text("NET WORTH")
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(2.4)
                    .foregroundStyle(OrionTheme.textDim)
                Text(Money.format(plaid.netWorth, currency: plaid.currency))
                    .font(OrionTheme.display(52))
                    .foregroundStyle(plaid.netWorth >= 0 ? OrionTheme.text : OrionTheme.red)
                HStack(spacing: 16) {
                    Leg(label: "assets",
                        value: Money.format(Money.assets(plaid.accounts), currency: plaid.currency),
                        tint: OrionTheme.green)
                    if Money.debts(plaid.accounts) > 0 {
                        Rectangle().fill(OrionTheme.line).frame(width: 1, height: 24)
                        Leg(label: "debts",
                            value: Money.format(Money.debts(plaid.accounts), currency: plaid.currency),
                            tint: OrionTheme.red)
                    }
                }
                .padding(.top, 4)
            }

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: 8) {
                if plaid.isWorking {
                    ProgressView().controlSize(.small)
                } else {
                    InlineAction(title: "Refresh", systemImage: "arrow.clockwise") { plaid.refresh() }
                }
                if let synced = plaid.lastSyncedAt {
                    Text("synced \(synced.formatted(date: .omitted, time: .shortened))")
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(OrionTheme.textDim)
                }
                Text("\(plaid.items.count) institution\(plaid.items.count == 1 ? "" : "s") · \(PlaidClient.environment)")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
    }

    // MARK: - This month

    /// In, out, and the shape of the spending. The sparkline is 30 days of
    /// daily totals — the point is the rhythm, not any one day.
    private var flow: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionRule(title: "This month",
                        trailing: Date().formatted(.dateTime.month(.wide)))

            if plaid.transactions.isEmpty {
                Text("Plaid is still pulling your transaction history — this usually takes a minute or two after linking.")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 520, alignment: .leading)
            } else {
                HStack(alignment: .top, spacing: 0) {
                    Figure(label: "spent",
                           value: Money.format(Money.spending(plaid.transactions, since: monthStart),
                                               currency: plaid.currency),
                           tint: OrionTheme.orange, drop: 0)
                    flowDivider
                    Figure(label: "in",
                           value: Money.format(Money.income(plaid.transactions, since: monthStart),
                                               currency: plaid.currency),
                           tint: OrionTheme.green, drop: 16)
                    flowDivider
                    Figure(label: "net",
                           value: Money.format(
                            Money.income(plaid.transactions, since: monthStart)
                            - Money.spending(plaid.transactions, since: monthStart),
                            currency: plaid.currency),
                           tint: netThisMonth >= 0 ? OrionTheme.green : OrionTheme.red,
                           drop: 0)

                    Spacer(minLength: 32)

                    VStack(alignment: .trailing, spacing: 5) {
                        Text("LAST 30 DAYS")
                            .font(OrionTheme.mono(8, .semibold))
                            .tracking(1.6)
                            .foregroundStyle(OrionTheme.textDim)
                        Sparkline(points: normalisedDailySpend,
                                  tint: OrionTheme.orange, height: 34)
                            .frame(width: 220)
                    }
                }
            }
        }
    }

    private var netThisMonth: Double {
        Money.income(plaid.transactions, since: monthStart)
        - Money.spending(plaid.transactions, since: monthStart)
    }

    private var normalisedDailySpend: [Double] {
        let raw = Money.dailySpend(plaid.transactions, days: 30)
        guard let peak = raw.max(), peak > 0 else { return raw.map { _ in 0 } }
        return raw.map { $0 / peak }
    }

    private var flowDivider: some View {
        Rectangle()
            .fill(OrionTheme.line)
            .frame(width: 1, height: 42)
            .padding(.horizontal, 26)
            .padding(.top, 12)
    }

    // MARK: - Where it went

    @ViewBuilder private var spendingBreakdown: some View {
        let categories = Money.byCategory(plaid.transactions, since: monthStart)
        if !categories.isEmpty {
            let peak = categories.first?.total ?? 1
            HStack(alignment: .top, spacing: 54) {
                VStack(alignment: .leading, spacing: 14) {
                    SectionRule(title: "Where it went")
                    ForEach(categories, id: \.category) { entry in
                        CategoryBar(name: entry.category,
                                    amount: entry.total,
                                    fraction: peak > 0 ? entry.total / peak : 0,
                                    currency: plaid.currency)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                subscriptions
                    .frame(width: 300)
                    .padding(.top, 30)
            }
        }
    }

    /// Found by pattern rather than bought from Plaid — see `Money.recurring`
    /// for why the rule is deliberately strict.
    @ViewBuilder private var subscriptions: some View {
        let found = Money.recurring(plaid.transactions)
        VStack(alignment: .leading, spacing: 12) {
            SectionRule(title: "Recurring",
                        trailing: found.isEmpty ? nil : Money.format(
                            found.reduce(0) { $0 + $1.amount }, currency: plaid.currency) + "/mo")
            if found.isEmpty {
                Text("Nothing charging monthly yet. Orion needs to see a charge three times before it will call it a subscription.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 0) {
                    ForEach(found) { item in
                        DataRow(label: item.name,
                                sublabel: "seen \(item.occurrences)× · last \(item.lastSeen.formatted(date: .abbreviated, time: .omitted))",
                                value: Money.format(item.amount, currency: plaid.currency),
                                valueTint: OrionTheme.violet)
                        if item.id != found.last?.id {
                            Rectangle().fill(OrionTheme.line).frame(height: 1)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Accounts

    private var accountsSection: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "Accounts", trailing: "\(plaid.accounts.count) linked")
            ForEach(institutions, id: \.self) { institution in
                VStack(alignment: .leading, spacing: 0) {
                    Text(institution.uppercased())
                        .font(OrionTheme.mono(9, .semibold))
                        .tracking(1.8)
                        .foregroundStyle(OrionTheme.accent.opacity(0.85))
                        .padding(.bottom, 8)
                    ForEach(plaid.accounts.filter { $0.institutionName == institution }) { account in
                        DataRow(label: account.maskedLabel,
                                sublabel: "\(account.subtype.isEmpty ? account.type : account.subtype)"
                                    + (account.isLiability ? " · owed" : ""),
                                value: Money.format(account.current ?? 0, currency: account.currency),
                                valueTint: account.isLiability ? OrionTheme.red : OrionTheme.green)
                        Rectangle().fill(OrionTheme.line).frame(height: 1)
                    }
                }
            }
        }
    }

    private var institutions: [String] {
        var seen: [String] = []
        for account in plaid.accounts where !seen.contains(account.institutionName) {
            seen.append(account.institutionName)
        }
        return seen
    }

    // MARK: - Recent

    @ViewBuilder private var recent: some View {
        if !plaid.transactions.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionRule(title: "Recent", trailing: "last \(min(12, plaid.transactions.count))")
                VStack(spacing: 0) {
                    ForEach(plaid.transactions.prefix(12)) { transaction in
                        TransactionRow(transaction: transaction, currency: plaid.currency)
                        if transaction.id != plaid.transactions.prefix(12).last?.id {
                            Rectangle().fill(OrionTheme.line).frame(height: 1)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Orion's read

    @ViewBuilder private var rail: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Orion reads this as")
            if let text = writer.text {
                let takeaways = Takeaway.parse(text)
                if takeaways.isEmpty {
                    Text(text)
                        .font(.system(size: 13))
                        .foregroundStyle(OrionTheme.text.opacity(0.88))
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(takeaways.enumerated()), id: \.element.id) { index, takeaway in
                            TakeawayRow(takeaway: takeaway)
                            if index != takeaways.count - 1 {
                                Rectangle().fill(OrionTheme.line).frame(height: 1)
                            }
                        }
                    }
                }
            } else if writer.isWriting {
                Text("Reading the numbers…")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
            } else {
                Text("The local model is not running, so there is no summary — every number on this page is still live.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func loadSummary() {
        let facts = FinanceFacts(
            dayKey: day.key,
            currency: plaid.currency,
            netWorth: plaid.netWorth,
            assets: Money.assets(plaid.accounts),
            debts: Money.debts(plaid.accounts),
            spentThisMonth: Money.spending(plaid.transactions, since: monthStart),
            incomeThisMonth: Money.income(plaid.transactions, since: monthStart),
            topCategories: Money.byCategory(plaid.transactions, since: monthStart, limit: 4),
            recurringTotal: Money.recurring(plaid.transactions).reduce(0) { $0 + $1.amount },
            recurringCount: Money.recurring(plaid.transactions).count,
            accountCount: plaid.accounts.count
        )
        writer.load(key: facts.narrativeKey, style: .lines) { facts.prompt() }
    }

    // MARK: - Not connected

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionRule(title: "Accounts", trailing: connections.state(.plaid).label)
            if plaid.isWorking {
                HStack(spacing: 12) {
                    ProgressView().controlSize(.small)
                    Text(plaid.status.isEmpty ? "Working…" : plaid.status)
                        .font(.system(size: 13))
                        .foregroundStyle(OrionTheme.textSoft)
                    Spacer(minLength: 12)
                    InlineAction(title: "Cancel", tint: OrionTheme.textSoft) { plaid.cancel() }
                }
            } else if let blocked = plaid.blockedReason {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Nothing loaded")
                        .font(OrionTheme.display(22))
                        .foregroundStyle(OrionTheme.orange)
                    Text(blocked)
                        .font(.system(size: 13))
                        .foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Environment: \(PlaidClient.environment) · \(plaid.items.count) linked item(s)")
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                    InlineAction(title: "Try again", systemImage: "arrow.clockwise") { plaid.refresh() }
                }
            } else {
                NotConnected(what: "Your banks",
                             detail: "Balances, transactions and holdings. Settings ▸ Connections.")
            }
            if let error = plaid.lastError {
                Text(error)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Pieces

private struct Leg: View {
    let label: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.6)
                .foregroundStyle(tint.opacity(0.85))
            Text(value)
                .font(OrionTheme.mono(13, .semibold))
                .foregroundStyle(OrionTheme.textSoft)
        }
    }
}

private struct Figure: View {
    let label: String
    let value: String
    let tint: Color
    let drop: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.6)
                .foregroundStyle(tint.opacity(0.85))
            Text(value)
                .font(OrionTheme.display(26))
                .foregroundStyle(OrionTheme.text)
        }
        .padding(.top, drop)
    }
}

/// A category and what it cost, as a bar that is a rule rather than a block.
private struct CategoryBar: View {
    let name: String
    let amount: Double
    let fraction: Double
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OrionTheme.text)
                Spacer(minLength: 12)
                Text(Money.format(amount, currency: currency))
                    .font(OrionTheme.mono(12, .semibold))
                    .foregroundStyle(OrionTheme.textSoft)
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.07))
                        .frame(height: 2)
                    Capsule()
                        .fill(OrionTheme.orange)
                        .frame(width: max(2, geometry.size.width * fraction), height: 2)
                        .shadow(color: OrionTheme.orange.opacity(0.6), radius: 5)
                }
            }
            .frame(height: 2)
        }
        .animation(.easeOut(duration: 0.4), value: fraction)
    }
}

private struct TransactionRow: View {
    let transaction: PlaidTransaction
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            Rectangle()
                .fill(transaction.isIncome ? OrionTheme.green : OrionTheme.textDim.opacity(0.5))
                .frame(width: 2, height: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OrionTheme.text)
                    .lineLimit(1)
                Text(Money.prettyCategory(transaction.category)
                     + (transaction.isPending ? " · pending" : ""))
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }

            Spacer(minLength: 12)

            Text(transaction.date.formatted(.dateTime.month(.abbreviated).day()))
                .font(OrionTheme.mono(9))
                .foregroundStyle(OrionTheme.textDim)

            Text((transaction.isIncome ? "+" : "−") + Money.format(transaction.magnitude, currency: currency))
                .font(OrionTheme.mono(12, .semibold))
                .foregroundStyle(transaction.isIncome ? OrionTheme.green : OrionTheme.text)
                .frame(minWidth: 74, alignment: .trailing)
        }
        .padding(.vertical, 9)
    }
}
