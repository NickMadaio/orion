import Foundation
import SwiftUI

private struct ModelUsageReport: Decodable, Sendable {
    struct Counts: Decodable, Sendable {
        let calls: Int
        let input, output, cacheRead, cacheWrite, totalTokens: Double
        let recordedCost, currentRateEquivalent: Double
        let unpricedCloudCalls: Int
    }
    struct Budgets: Decodable, Sendable {
        struct Daily: Decodable, Sendable { let totalTokens, modelCalls: Int }
        struct PerTask: Decodable, Sendable { let toolCalls, seconds: Int }
        struct Calls: Decodable, Sendable { let modelCallsPerDay: Int }
        let daily: Daily?
        let perTask: PerTask?
        let automation, remoteSession: Calls?
    }
    let budgets: Budgets?
    let generatedAt: String
    let totals: Counts
    let byModel: [String: Counts]
    let notes: [String]
}

/// Reads retained usage metadata locally. No prompts or provider credentials
/// reach this view, and opening it never initiates an inference request.
struct ModelUsageView: View {
    @State private var days = 30
    @State private var report: ModelUsageReport?
    @State private var failure: String?
    @State private var loading = false
    private func dollars(_ value: Double) -> String { String(format: "$%.4f", value) }
    private func tokens(_ value: Double) -> String { Int(value).formatted() }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Picker("History", selection: $days) {
                    Text("Today").tag(1); Text("7 days").tag(7)
                    Text("30 days").tag(30); Text("All retained").tag(0)
                }
                .labelsHidden()
                Button("Refresh") { Task { await refresh() } }.disabled(loading)
            }
            if loading { ProgressView().controlSize(.small) }
            if let failure { Text(failure).foregroundStyle(.orange).font(.system(size: 11)) }
            if let report {
                Text("\(dollars(report.totals.recordedCost)) recorded cost")
                    .font(.system(size: 19, weight: .medium)).foregroundStyle(OrionTheme.text)
                Text("\(tokens(report.totals.totalTokens)) tokens · \(report.totals.calls) calls")
                Text("\(dollars(report.totals.currentRateEquivalent)) at current rates · \(report.totals.unpricedCloudCalls) cloud calls without recorded pricing")
                ForEach(report.byModel.keys.sorted(), id: \.self) { model in
                    if let counts = report.byModel[model] {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(model).foregroundStyle(OrionTheme.text)
                            Text("\(counts.calls) calls · \(dollars(counts.recordedCost)) recorded")
                            Text("Input \(tokens(counts.input)) · Output \(tokens(counts.output))")
                            Text("Cache read \(tokens(counts.cacheRead)) · Write \(tokens(counts.cacheWrite))")
                        }.padding(.vertical, 4)
                    }
                }
                Text("Rates / 1M tokens (USD): Haiku 4.5 input $1, output $5; Sonnet 5 input $3, output $15. Cache reads 10% of input; 5-minute writes 125%. Local Ollama has no per-token API charge.")
                if let limits = report.budgets {
                    if let daily = limits.daily { Text("Daily ceilings: \(daily.totalTokens.formatted()) tokens · \(daily.modelCalls) calls") }
                    if let task = limits.perTask { Text("Per task: \(task.toolCalls) tool calls · \(task.seconds) seconds") }
                    if let calls = limits.automation { Text("Automation: \(calls.modelCallsPerDay) calls/day") }
                    if let calls = limits.remoteSession { Text("Remote session: \(calls.modelCallsPerDay) calls/day") }
                }
                ForEach(report.notes, id: \.self) { Text($0) }
                Text("Updated \(report.generatedAt)").foregroundStyle(OrionTheme.textDim)
            }
        }
        .font(OrionTheme.mono(10))
        .foregroundStyle(OrionTheme.textSoft)
        .fixedSize(horizontal: false, vertical: true)
        .task(id: days) { await refresh() }
    }

    @MainActor private func refresh() async {
        guard !loading else { return }
        loading = true; failure = nil
        let selectedDays = days
        let result = await Task.detached { () -> Result<ModelUsageReport, Error> in
            do {
                let home = FileManager.default.homeDirectoryForCurrentUser
                let process = Process(), pipe = Pipe()
                process.executableURL = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
                let script = home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-usage")
                process.arguments = [script.path, "--json"] + (selectedDays == 0 ? ["--all"] : ["--days", String(selectedDays)])
                process.standardOutput = pipe
                process.standardError = FileHandle.nullDevice
                try process.run()
                // Drain before waiting: a full pipe otherwise deadlocks longer histories.
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                guard process.terminationStatus == 0 else {
                    throw NSError(domain: "ModelUsage", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "Usage report could not be read. Check the installed orion-usage script."])
                }
                return .success(try JSONDecoder().decode(ModelUsageReport.self, from: data))
            } catch { return .failure(error) }
        }.value
        loading = false
        switch result {
        case .success(let value): report = value
        case .failure(let error): report = nil; failure = error.localizedDescription
        }
        // A picker change during a read should display the newly selected window.
        if selectedDays != days { await refresh() }
    }
}
