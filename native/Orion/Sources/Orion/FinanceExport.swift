import Foundation

/*
 Finances for ORION's brain (2026-09-30). The bank data lived only in this
 app's memory, so "how much have I spent this week?" had no answer outside the
 Finances tab. After every refresh this writes a read-only summary to
 ~/.openclaw/orion-controlled/finance-summary.json (0600): balances, this
 week's and this month's spending, top categories, recurring charges and the
 last 25 transactions. `scripts/orion-finance` reads it. No tokens, no
 account numbers beyond the last four digits.
*/
enum FinanceExport {
    static var file: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/finance-summary.json")
    }

    static func write(accounts: [PlaidAccount], transactions: [PlaidTransaction], now: Date = Date()) {
        let calendar = Calendar.current
        let monthStart = calendar.date(from: calendar.dateComponents([.year, .month], from: now)) ?? now
        let weekStart = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? now
        let iso = ISO8601DateFormatter()
        let day = DateFormatter(); day.dateFormat = "yyyy-MM-dd"
        let object: [String: Any] = [
            "writtenAt": iso.string(from: now),
            "accounts": accounts.map { account -> [String: Any] in
                ["name": account.displayName, "institution": account.institutionName, "mask": account.mask,
                 "type": account.type, "subtype": account.subtype, "currency": account.currency,
                 "current": account.current as Any, "available": account.available as Any]
            },
            "spentThisWeek": Money.spending(transactions, since: weekStart),
            "spentThisMonth": Money.spending(transactions, since: monthStart),
            "incomeThisMonth": Money.income(transactions, since: monthStart),
            "topCategoriesThisMonth": Money.byCategory(transactions, since: monthStart).map { ["category": $0.category, "total": $0.total] },
            "recurring": Money.recurring(transactions).map { ["name": $0.name, "amount": $0.amount] },
            "recent": transactions.prefix(25).map { item -> [String: Any] in
                ["date": day.string(from: item.date), "name": item.title, "amount": item.amount,
                 "category": item.category, "pending": item.isPending]
            },
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}
