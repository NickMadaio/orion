import SwiftUI
import MobileCore

/// Health on the phone: the Mac's daily log (WHOOP and manual), carried in the
/// link snapshot. Numbers are shown only when recorded; a missing reading is a
/// dash, never a zero.
struct HealthView: View {
    @ObservedObject var remote: RemoteStore

    private var days: [LinkSnapshot.HealthDay] { remote.snapshot?.health ?? [] }
    private var latest: LinkSnapshot.HealthDay? { days.last }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                PhoneHeader(eyebrow: "Tracking · recovery · sleep", title: "Health")
                TrackingSection(remote: remote)
                if let day = latest {
                    SectionLabel("Recovery", tint: Phone.green).padding(.top, 6)
                    today(day)
                    week
                    Text(footer(day)).font(.footnote).foregroundStyle(Phone.dim)
                } else if remote.snapshot != nil {
                    Text("Connect WHOOP in ORION on your Mac and recovery, sleep and strain show up here.")
                        .font(.system(size: 14)).foregroundStyle(Phone.soft)
                }
            }
            .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 30)
        }
        .phoneScreen()
        .navigationTitle("Health")
    }

    private func today(_ day: LinkSnapshot.HealthDay) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 22) {
                RecoveryRing(value: day.recovery)
                VStack(alignment: .leading, spacing: 6) {
                    Text(label(day.date)).font(Phone.mono(10)).tracking(1.2).foregroundStyle(Phone.dim)
                    Text(verdict(day.recovery)).font(Phone.display(22)).foregroundStyle(Phone.text)
                    Text("Recovery").font(.system(size: 13)).foregroundStyle(Phone.soft)
                }
            }
            HStack(alignment: .top, spacing: 16) {
                PhoneStat(label: "Sleep", value: day.sleepHours.map { String(format: "%.1f h", $0) } ?? "—",
                          detail: day.sleepPerformance.map { "\($0)% of need" })
                PhoneStat(label: "HRV", value: day.hrv.map { "\($0)" } ?? "—", detail: day.hrv == nil ? nil : "ms")
                PhoneStat(label: "Resting HR", value: day.restingHeartRate.map { "\($0)" } ?? "—", detail: day.restingHeartRate == nil ? nil : "bpm")
                PhoneStat(label: "Strain", value: day.strain.map { String(format: "%.1f", $0) } ?? "—", tint: Phone.violet)
            }
        }
    }

    private var week: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("Recovery · last \(days.count) day\(days.count == 1 ? "" : "s")", tint: Phone.green)
            HStack(alignment: .bottom, spacing: 10) {
                ForEach(days) { day in
                    VStack(spacing: 6) {
                        Text(day.recovery.map { "\($0)" } ?? "—").font(Phone.mono(10, .medium)).foregroundStyle(Phone.soft)
                        Capsule().fill(RecoveryRing.tint(day.recovery).opacity(day.recovery == nil ? 0.2 : 0.9))
                            .frame(width: 18, height: max(6, CGFloat(day.recovery ?? 6) * 1.1))
                        Text(weekday(day.date)).font(Phone.mono(9, .medium)).foregroundStyle(Phone.dim)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 150, alignment: .bottom)
        }
    }

    private func verdict(_ recovery: Int?) -> String {
        guard let recovery else { return "Not recorded" }
        if recovery >= 67 { return "Ready to push" }
        if recovery >= 34 { return "Steady, not a peak day" }
        return "Take it easy"
    }

    private static let dayFormat: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
    private func label(_ key: String) -> String {
        guard let date = Self.dayFormat.date(from: key) else { return key }
        if Calendar.current.isDateInToday(date) { return "TODAY" }
        if Calendar.current.isDateInYesterday(date) { return "YESTERDAY" }
        return date.formatted(.dateTime.weekday(.wide).day().month()).uppercased()
    }
    private func weekday(_ key: String) -> String {
        guard let date = Self.dayFormat.date(from: key) else { return "" }
        return date.formatted(.dateTime.weekday(.narrow))
    }
    private func footer(_ day: LinkSnapshot.HealthDay) -> String {
        let seen = remote.snapshot?.generatedAt.formatted(.relative(presentation: .named)) ?? "—"
        return "From ORION on your Mac · updated \(seen). Raw health stays in your private iCloud."
    }
}

/// WHOOP's colours: green 67+, yellow 34–66, red below.
struct RecoveryRing: View {
    let value: Int?
    static func tint(_ value: Int?) -> Color {
        guard let value else { return Phone.dim }
        return value >= 67 ? Phone.green : value >= 34 ? Color(red: 1, green: 0.84, blue: 0.3) : Phone.red
    }
    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.08), lineWidth: 9)
            Circle().trim(from: 0, to: CGFloat(value ?? 0) / 100)
                .stroke(Self.tint(value), style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(value.map { "\($0)" } ?? "—").font(.system(size: 38, weight: .light, design: .rounded)).foregroundStyle(Phone.text)
                Text("%").font(Phone.mono(10)).foregroundStyle(Phone.dim)
            }
        }
        .frame(width: 118, height: 118)
        .animation(.easeOut(duration: 0.6), value: value)
    }
}
