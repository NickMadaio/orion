//
//  Usage on Home (2026-10-07). A small line in the corner — today's API spend —
//  that opens into the whole picture: the month against his budget, what the
//  month is on track for, every model (Claude and local) with its tokens, and
//  where the money went. Data: scripts/orion-usage --json.
//

import SwiftUI

struct UsageReport: Decodable, Equatable {
    struct Bucket: Decodable, Equatable {
        let calls: Int
        let input: Int
        let output: Int
        let cacheRead: Int
        let cacheWrite: Int
        let cost: Double
        let local: Bool?
    }
    struct Period: Decodable, Equatable {
        let calls: Int
        let cost: Double
        let byModel: [String: Bucket]
        let bySource: [String: Bucket]
    }
    struct Projection: Decodable, Equatable { let monthReal: Double; let monthAll: Double }
    struct Day: Decodable, Equatable { let day: String; let cost: Double; let localCalls: Int }
    let budget: Double
    let today: Period
    let week: Period
    let month: Period
    let projection: Projection
    let daily: [Day]
}

final class UsageModel: ObservableObject {
    @Published private(set) var report: UsageReport?
    @Published private(set) var problem: String?
    private var loading = false

    func refresh() {
        guard !loading else { return }
        loading = true
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let output = ConsoleController.runScript("orion-usage", ["--json"])
            let decoded = output.flatMap { try? JSONDecoder().decode(UsageReport.self, from: Data($0.utf8)) }
            DispatchQueue.main.async {
                guard let self else { return }
                self.loading = false
                if let decoded { self.report = decoded; self.problem = nil } else { self.problem = "Usage could not be read." }
            }
        }
    }
}

/// The corner line, and the panel it opens.
struct UsageCorner: View {
    @StateObject private var model = UsageModel()
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { open.toggle() }
                if open { model.refresh() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: open ? "xmark" : "chart.bar.xaxis")
                        .font(.system(size: 10, weight: .semibold))
                    Text(model.report.map { "\(money($0.today.cost)) today" } ?? "usage")
                        .font(OrionTheme.mono(10.5, .medium))
                }
                .foregroundStyle(open ? OrionTheme.text : OrionTheme.textSoft)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("API and model usage")
            .accessibilityLabel("Usage")

            if open {
                UsagePanel(report: model.report, problem: model.problem)
                    .transition(.opacity.combined(with: .offset(y: -6)))
            }
        }
        .onAppear { model.refresh() }
    }
}

private func money(_ value: Double) -> String {
    value < 10 ? String(format: "$%.2f", value) : String(format: "$%.0f", value)
}

private func tokens(_ n: Int) -> String {
    switch n {
    case 1_000_000...: return String(format: "%.1fM", Double(n) / 1_000_000)
    case 1_000...: return String(format: "%.0fk", Double(n) / 1_000)
    default: return "\(n)"
    }
}

struct UsagePanel: View {
    let report: UsageReport?
    let problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let report {
                month(report)
                FadingRule()
                periods(report)
                spark(report)
                FadingRule()
                models(report)
                FadingRule()
                sources(report)
            } else {
                Text(problem ?? "Reading usage…").font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
            }
        }
        .padding(20)
        .frame(width: 360, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(OrionTheme.ink.opacity(0.96))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(LinearGradient(colors: [OrionTheme.accent.opacity(0.3), Color.white.opacity(0.04)],
                                                 startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1))
        )
    }

    private func label(_ text: String) -> some View {
        Text(text).font(OrionTheme.mono(8.5, .semibold)).tracking(1.5).foregroundStyle(OrionTheme.textDim)
    }

    // The month against the budget, and what it is on track for.
    private func month(_ r: UsageReport) -> some View {
        let fraction = min(1, r.month.cost / max(r.budget, 0.01))
        let pace = r.projection.monthReal
        return VStack(alignment: .leading, spacing: 7) {
            label("THIS MONTH")
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(money(r.month.cost)).font(.system(size: 30, weight: .ultraLight, design: .rounded)).foregroundStyle(OrionTheme.text)
                Text("of \(money(r.budget))").font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1)
                    Rectangle().fill(fraction > 0.85 ? OrionTheme.orange : OrionTheme.accent)
                        .frame(width: geo.size.width * fraction, height: 2)
                }
            }
            .frame(height: 2)
            Text("Your use is on track for \(money(pace)) this month\(r.projection.monthAll > pace + 0.5 ? " (\(money(r.projection.monthAll)) counting tests)" : "").")
                .font(.system(size: 11.5)).foregroundStyle(pace > r.budget ? OrionTheme.orange : OrionTheme.textSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func periods(_ r: UsageReport) -> some View {
        HStack(spacing: 26) {
            ForEach([("TODAY", r.today), ("7 DAYS", r.week)], id: \.0) { name, p in
                VStack(alignment: .leading, spacing: 3) {
                    label(name)
                    Text(money(p.cost)).font(.system(size: 15, weight: .light)).foregroundStyle(OrionTheme.text)
                    Text("\(p.calls) calls").font(.system(size: 10.5)).foregroundStyle(OrionTheme.textDim)
                }
            }
        }
    }

    // Fourteen days of spend as hairline bars; local-only days show as a dot.
    private func spark(_ r: UsageReport) -> some View {
        let top = max(r.daily.map(\.cost).max() ?? 0, 0.01)
        return HStack(alignment: .bottom, spacing: 5) {
            ForEach(r.daily, id: \.day) { d in
                VStack(spacing: 2) {
                    Rectangle().fill(OrionTheme.accent.opacity(d.day == r.daily.last?.day ? 0.9 : 0.45))
                        .frame(width: 14, height: max(1, 34 * d.cost / top))
                    Circle().fill(d.localCalls > 0 ? OrionTheme.violet.opacity(0.7) : .clear).frame(width: 3, height: 3)
                }
                .help("\(d.day): \(money(d.cost))\(d.localCalls > 0 ? ", \(d.localCalls) local calls" : "")")
            }
        }
        .frame(height: 40, alignment: .bottom)
    }

    // Every model this month: Claude with its cost, local ones free.
    private func models(_ r: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            label("MODELS THIS MONTH")
            ForEach(r.month.byModel.sorted { ($0.value.cost, $0.value.calls) > ($1.value.cost, $1.value.calls) }, id: \.key) { name, b in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(short(name)).font(.system(size: 12.5)).foregroundStyle(OrionTheme.text)
                        Text("\(b.calls) calls · \(tokens(b.input + b.cacheRead + b.cacheWrite)) in · \(tokens(b.output)) out\(b.local == true ? "" : " · \(tokens(b.cacheRead)) cached")")
                            .font(.system(size: 10)).foregroundStyle(OrionTheme.textDim)
                    }
                    Spacer()
                    Text(b.local == true ? "local · free" : money(b.cost))
                        .font(OrionTheme.mono(11, .medium))
                        .foregroundStyle(b.local == true ? OrionTheme.violet.opacity(0.85) : OrionTheme.textSoft)
                }
            }
        }
    }

    private func sources(_ r: UsageReport) -> some View {
        let top = max(r.month.bySource.values.map(\.cost).max() ?? 0, 0.01)
        return VStack(alignment: .leading, spacing: 7) {
            label("WHERE IT WENT")
            ForEach(r.month.bySource.sorted { $0.value.cost > $1.value.cost }, id: \.key) { name, b in
                HStack(spacing: 10) {
                    Text(name).font(.system(size: 11.5)).foregroundStyle(OrionTheme.textSoft).frame(width: 92, alignment: .leading)
                    Rectangle().fill(OrionTheme.accent.opacity(0.5)).frame(width: max(1, 150 * b.cost / top), height: 2)
                    Spacer(minLength: 4)
                    Text(money(b.cost)).font(OrionTheme.mono(10.5, .medium)).foregroundStyle(OrionTheme.textSoft)
                }
            }
        }
    }

    private func short(_ model: String) -> String {
        model.replacingOccurrences(of: "claude-", with: "Claude ")
            .replacingOccurrences(of: #"-\d{8}$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "haiku-4-5", with: "Haiku 4.5")
            .replacingOccurrences(of: "sonnet-5", with: "Sonnet 5")
    }
}
