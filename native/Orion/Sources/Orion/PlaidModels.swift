import Foundation

/*
 What Orion knows about money, and the arithmetic over it.

 Split out from `PlaidClient` because the client's job is talking to Plaid and
 this file's job is meaning: which balances are assets and which are debts, what
 was spent this month, which charges come back every month. All of it is pure
 functions over values, which is why it can be tested without a network.

 One Plaid fact governs half this file and is the easiest thing in the API to
 get backwards: **`amount` is positive when money LEAVES the account.** A
 coffee is +4.50. A paycheque is −2000. Plaid documents it plainly and it still
 reads as inverted every single time, so nothing below uses the raw sign — it
 goes through `isSpending` / `isIncome`.
*/

// MARK: - Items

/// One linked institution.
///
/// Plaid issues an access token per ITEM, and an Item is one login at one bank.
/// Chase and Fidelity are two Items and therefore two tokens. Orion stored
/// exactly one, so linking the second silently replaced the first — which is
/// why Fidelity "had issues" that were really Chase being overwritten.
struct PlaidItem: Codable, Identifiable, Equatable {
    let itemID: String
    let accessToken: String
    var institutionName: String

    var id: String { itemID }
}

// MARK: - Accounts

struct PlaidAccount: Identifiable, Equatable {
    let id: String
    var name: String
    var officialName: String
    var mask: String
    var type: String
    var subtype: String
    var available: Double?
    var current: Double?
    var currency: String
    /// Which login it came from, so the list can be grouped.
    var institutionName: String = ""

    var displayName: String {
        officialName.isEmpty ? name : officialName
    }

    var maskedLabel: String {
        mask.isEmpty ? displayName : "\(displayName) ··\(mask)"
    }

    /// Credit cards and loans are money you OWE. Plaid reports their balance as
    /// a positive number, so adding every `current` together and calling it net
    /// worth counts debt as savings — the single most misleading thing a
    /// finance screen can do.
    var isLiability: Bool {
        type == "credit" || type == "loan"
    }

    /// Signed for net worth: assets positive, debts negative.
    var netContribution: Double {
        let value = current ?? 0
        return isLiability ? -value : value
    }
}

// MARK: - Transactions

struct PlaidTransaction: Identifiable, Equatable {
    let id: String
    var accountID: String
    var name: String
    var merchant: String?
    /// Plaid's sign convention: POSITIVE means money left the account.
    var amount: Double
    var date: Date
    var category: String
    var isPending: Bool

    var title: String {
        let merchant = merchant?.trimmingCharacters(in: .whitespaces) ?? ""
        return merchant.isEmpty ? name : merchant
    }

    var isSpending: Bool { amount > 0 }
    var isIncome: Bool { amount < 0 }

    /// Always positive, whichever direction it went.
    var magnitude: Double { abs(amount) }
}

// MARK: - Analytics

/// Everything the Finance tab derives rather than displays raw.
enum Money {

    /// Assets minus debts. The number the whole tab hangs on.
    static func netWorth(_ accounts: [PlaidAccount]) -> Double {
        accounts.reduce(0) { $0 + $1.netContribution }
    }

    static func assets(_ accounts: [PlaidAccount]) -> Double {
        accounts.filter { !$0.isLiability }.reduce(0) { $0 + ($1.current ?? 0) }
    }

    static func debts(_ accounts: [PlaidAccount]) -> Double {
        accounts.filter(\.isLiability).reduce(0) { $0 + ($1.current ?? 0) }
    }

    /// Spending since a date. Transfers between your own accounts are excluded:
    /// moving savings into checking is not spending, and counting it doubles
    /// every internal movement.
    static func spending(_ transactions: [PlaidTransaction], since: Date) -> Double {
        transactions
            .filter { $0.date >= since && $0.isSpending && !isTransfer($0) }
            .reduce(0) { $0 + $1.amount }
    }

    static func income(_ transactions: [PlaidTransaction], since: Date) -> Double {
        transactions
            .filter { $0.date >= since && $0.isIncome && !isTransfer($0) }
            .reduce(0) { $0 + $1.magnitude }
    }

    static func isTransfer(_ transaction: PlaidTransaction) -> Bool {
        let category = transaction.category.uppercased()
        return category.contains("TRANSFER") || category.contains("LOAN_PAYMENTS")
    }

    /// Where the money went, biggest first.
    static func byCategory(
        _ transactions: [PlaidTransaction],
        since: Date,
        limit: Int = 6
    ) -> [(category: String, total: Double)] {
        var totals: [String: Double] = [:]
        for transaction in transactions
        where transaction.date >= since && transaction.isSpending && !isTransfer(transaction) {
            totals[prettyCategory(transaction.category), default: 0] += transaction.amount
        }
        return totals
            .map { (category: $0.key, total: $0.value) }
            .sorted { $0.total > $1.total }
            .prefix(limit)
            .map { $0 }
    }

    /// Plaid's `personal_finance_category.primary` is SCREAMING_SNAKE_CASE.
    static func prettyCategory(_ raw: String) -> String {
        guard !raw.isEmpty else { return "Other" }
        return raw
            .replacingOccurrences(of: "_", with: " ")
            .lowercased()
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    /// Spend per day, oldest first, for the sparkline. Days with nothing spent
    /// are zeros rather than gaps — a line that skips empty days compresses
    /// time and makes a quiet week look like a busy one.
    static func dailySpend(_ transactions: [PlaidTransaction], days: Int) -> [Double] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        guard let start = calendar.date(byAdding: .day, value: -(days - 1), to: today) else { return [] }

        var buckets = [Double](repeating: 0, count: days)
        for transaction in transactions where transaction.isSpending && !isTransfer(transaction) {
            let day = calendar.startOfDay(for: transaction.date)
            guard day >= start, day <= today,
                  let offset = calendar.dateComponents([.day], from: start, to: day).day,
                  offset >= 0, offset < days
            else { continue }
            buckets[offset] += transaction.amount
        }
        return buckets
    }

    // MARK: Recurring

    /// A charge that comes back.
    struct Recurring: Identifiable, Equatable {
        let name: String
        let amount: Double
        let lastSeen: Date
        let occurrences: Int
        var id: String { name }
    }

    /// Subscriptions, found without paying Plaid for its Recurring Transactions
    /// product.
    ///
    /// The rule is deliberately conservative, because a false positive here
    /// tells you you are paying for something you are not. A charge counts as
    /// recurring when the same merchant appears at least three times, the
    /// amounts are within 12% of the median, and the gaps between them look
    /// monthly (24–36 days). Groceries at the same shop every week fail the gap
    /// test; a subscription that changed price fails the amount test and is
    /// better missed than guessed at.
    static func recurring(_ transactions: [PlaidTransaction], limit: Int = 8) -> [Recurring] {
        let spending = transactions.filter { $0.isSpending && !isTransfer($0) }
        let groups = Dictionary(grouping: spending) { $0.title.lowercased() }

        return groups.compactMap { _, items -> Recurring? in
            guard items.count >= 3 else { return nil }
            let sorted = items.sorted { $0.date < $1.date }

            let amounts = sorted.map(\.amount).sorted()
            let median = amounts[amounts.count / 2]
            guard median > 0.5 else { return nil }
            let consistent = amounts.allSatisfy { abs($0 - median) / median <= 0.12 }
            guard consistent else { return nil }

            let gaps = zip(sorted, sorted.dropFirst()).map { earlier, later in
                later.date.timeIntervalSince(earlier.date) / 86_400
            }
            guard !gaps.isEmpty, gaps.allSatisfy({ $0 >= 24 && $0 <= 36 }) else { return nil }

            return Recurring(
                name: sorted.last?.title ?? "",
                amount: median,
                lastSeen: sorted.last?.date ?? Date(),
                occurrences: sorted.count
            )
        }
        .sorted { $0.amount > $1.amount }
        .prefix(limit)
        .map { $0 }
    }

    /// Formatted the way money is read: no decimals once it is over a hundred,
    /// because cents on a four-figure balance are noise.
    static func format(_ value: Double, currency: String = "USD") -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.maximumFractionDigits = abs(value) >= 100 ? 0 : 2
        formatter.minimumFractionDigits = abs(value) >= 100 ? 0 : 2
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}
