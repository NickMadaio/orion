import SwiftUI
import MobileCore

/// Health on the phone, as the Mac Health tab reads: rings for recovery, sleep and strain, a verdict and plain lines,
/// then the day's water, food and supplements. A missing reading is a dash, never a zero.
struct HealthView: View {
    @ObservedObject var remote: RemoteStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var days: [LinkSnapshot.HealthDay] { remote.snapshot?.health ?? [] }
    private var latest: LinkSnapshot.HealthDay? { days.last }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                PhoneHeader(eyebrow: latest.map { label($0.date) } ?? "Recovery · sleep · strain", title: "Health", tint: Phone.green)
                SyncLine(remote: remote)
                if let day = latest {
                    vitals(day).softReveal(true)
                    TrackingSection(remote: remote).softReveal(true)
                    if days.count > 1 { week.softReveal(true) }
                } else {
                    if remote.snapshot != nil {
                        Text(HealthReadout.empty).font(.system(size: 15)).foregroundStyle(Phone.soft).lineSpacing(3)
                    }
                    TrackingSection(remote: remote)
                }
            }
            .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 36)
        }
        .phoneScreen()
        .navigationTitle("Health")
    }

    private func vitals(_ day: LinkSnapshot.HealthDay) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .top, spacing: 0) {
                PhoneGauge(label: "Recovery", figure: day.recovery.map { "\($0)" } ?? "—", fraction: RingMath.fraction(day.recovery.map(Double.init), of: 100),
                           unit: "%", tint: RecoveryRing.tint(day.recovery), size: 96)
                    .frame(maxWidth: .infinity)
                PhoneGauge(label: "Sleep", figure: day.sleepHours.map { String(format: "%.1f", $0) } ?? "—",
                           fraction: HealthReadout.sleepFraction(day), unit: "hours", tint: Phone.sleep, size: 96)
                    .frame(maxWidth: .infinity)
                PhoneGauge(label: "Strain", figure: day.strain.map { String(format: "%.1f", $0) } ?? "—",
                           fraction: HealthReadout.strainFraction(day), unit: "of 21", tint: Phone.purple, size: 96)
                    .frame(maxWidth: .infinity)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(HealthReadout.verdict(recovery: day.recovery)).font(Phone.display(24, .regular)).foregroundStyle(Phone.text)
                ForEach(HealthReadout.lines(day), id: \.self) { line in
                    Text(line).font(.system(size: 14.5)).foregroundStyle(Phone.soft).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// The last days as small recovery rings, oldest first.
    private var week: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionLabel("Recovery · last \(Plural.count(days.count, "day"))", tint: Phone.green)
            HStack(spacing: 6) {
                ForEach(days) { day in
                    VStack(spacing: 8) {
                        ZStack {
                            Circle().stroke(Phone.wash(0.08), lineWidth: 3)
                            Circle().trim(from: 0, to: CGFloat(RingMath.fraction(day.recovery.map(Double.init), of: 100) ?? 0))
                                .stroke(RecoveryRing.tint(day.recovery), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                            Text(day.recovery.map { "\($0)" } ?? "—").font(Phone.mono(10, .medium)).foregroundStyle(Phone.soft)
                        }
                        .frame(width: 38, height: 38)
                        Text(weekday(day.date)).font(Phone.mono(9.5, .medium)).foregroundStyle(Phone.dim)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .combine)
                }
            }
            .animation(PhoneMotion.spring(PhoneMotion.enter, reduce: reduceMotion), value: days)
        }
    }

    private static let dayFormat: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
    private func label(_ key: String) -> String {
        guard let date = Self.dayFormat.date(from: key) else { return key }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(.dateTime.weekday(.wide).day().month())
    }
    private func weekday(_ key: String) -> String {
        guard let date = Self.dayFormat.date(from: key) else { return "" }
        return date.formatted(.dateTime.weekday(.narrow))
    }
}

/// Recovery's colours: green 67+, yellow 34-66, red below.
enum RecoveryRing {
    static func tint(_ value: Int?) -> Color {
        guard let value else { return Phone.dim }
        return value >= 67 ? Phone.green : value >= 34 ? Phone.yellow : Phone.red
    }
}
