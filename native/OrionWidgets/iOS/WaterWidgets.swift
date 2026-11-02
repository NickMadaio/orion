import AppIntents
import SwiftUI
import WidgetKit
import MobileCore

/*
 Water on the home screen, the lock screen and in Control Center (2026-11-02).
 Every button here runs AddWaterIntent. The lock-screen ring also carries the
 orion://water/add link: where iOS does not run a lock-screen button in place,
 a tap opens ORION with that link and the app logs the bottle itself.
*/
struct WaterWidget: Widget {
    static let kind = "orion.water"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: GlanceProvider()) { entry in
            WaterWidgetView(entry: entry)
        }
        .configurationDisplayName("Water")
        .description("Today's water as a ring. Tap + to log a bottle.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

/// The water count the widgets draw: the glance's, or an empty ring before the first.
struct WaterReading: Equatable {
    let water: Int
    let goal: Int
    var fraction: Double { goal > 0 ? min(1, Double(water) / Double(goal)) : 0 }

    init(water: Int, goal: Int) { self.water = water; self.goal = max(1, goal) }
    init(_ glance: OrionGlance?) {
        self.init(water: glance?.tracking?.water ?? 0, goal: glance?.tracking?.waterGoal ?? 9)
    }
}

struct WaterWidgetView: View {
    let entry: GlanceEntry
    /// Set by the offscreen renderer; inside WidgetKit the environment decides.
    var familyOverride: WidgetFamily?
    @Environment(\.widgetFamily) private var environmentFamily
    private var family: WidgetFamily { familyOverride ?? environmentFamily }
    private var reading: WaterReading { WaterReading(entry.glance) }

    var body: some View {
        switch family {
        case .accessoryCircular: lockScreen
        default: home
        }
    }

    private var lockScreen: some View {
        Button(intent: AddWaterIntent()) {
            ZStack {
                AccessoryWidgetBackground()
                Circle().stroke(Color.white.opacity(0.25), lineWidth: 4).padding(3)
                Circle().trim(from: 0, to: reading.fraction)
                    .stroke(Color.white, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .rotationEffect(.degrees(-90)).padding(3)
                    .widgetAccentable()
                VStack(spacing: -1) {
                    Image(systemName: "drop.fill").font(.system(size: 10, weight: .semibold))
                    Text("\(reading.water)").font(.system(size: 17, weight: .semibold, design: .rounded))
                }
            }
        }
        .buttonStyle(.plain)
        .widgetURL(URL(string: "orion://water/add")!)
        .containerBackground(.clear, for: .widget)
        .accessibilityLabel("Add a bottle of water, \(reading.water) of \(reading.goal) so far")
    }

    private var home: some View {
        VStack(alignment: .leading, spacing: 0) {
            Eyebrow("Water", tint: W.accent)
            Spacer(minLength: 4)
            HStack(alignment: .bottom) {
                ZStack {
                    Ring(value: reading.fraction, tint: W.accent, width: 8)
                    VStack(spacing: 0) {
                        Text("\(reading.water)").font(W.display(26, .bold)).foregroundStyle(W.text)
                        Text("of \(reading.goal)").font(W.mono(9)).foregroundStyle(W.soft)
                    }
                }
                .frame(width: 84, height: 84)
                Spacer(minLength: 0)
                Button(intent: AddWaterIntent()) {
                    Text("+1").font(W.mono(13, .bold)).foregroundStyle(W.ink)
                        .frame(width: 40, height: 40)
                        .background(W.accent, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add a bottle of water")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .orionBackground(W.accent)
        .widgetURL(W.link("health"))
    }
}

/// Control Center, the lock screen's control slots and the Action button.
@available(iOS 18.0, *)
struct WaterControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: WaterCourier.controlKind) {
            ControlWidgetButton(action: AddWaterIntent()) {
                Label("Add water", systemImage: "drop.fill")
            }
        }
        .displayName("Add water")
        .description("Log a bottle of water in ORION.")
    }
}
