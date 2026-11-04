import SwiftUI
import MobileCore
import OrionViews

/*
 Tracking on the phone (2026-09-28): water, food and supplements.

 Nick: "these were always meant for iphone bc its easier to log them on phone".
 Each tap becomes a `LinkLog` the Mac writes into its health log, the same file
 the ORION app's Health tab reads, so a bottle logged here is on the Mac within
 seconds and a meal logged on the Mac shows up here. Taps show immediately;
 RemoteStore keeps them on top of the Mac's numbers until the Mac confirms.
*/

// MARK: - The Health tab's section

struct TrackingSection: View {
    @ObservedObject var remote: RemoteStore
    @State private var loggingFood = false

    var body: some View {
        if let tracking = remote.tracking {
            VStack(alignment: .leading, spacing: 34) {
                if let problem = remote.trackingProblem {
                    Label(problem, systemImage: "exclamationmark.triangle").font(.system(size: 13)).foregroundStyle(Phone.orange)
                }
                water(tracking)
                food(tracking)
                if !tracking.supplements.isEmpty { supplements(tracking) }
            }
            .foodLogging(trigger: $loggingFood, remote: remote, conversationID: nil)
        } else {
            PhoneEmptyState(symbol: "drop", title: remote.snapshot == nil ? "Waiting for your Mac" : "Tracking isn't set up on your Mac",
                            detail: "Water, food and supplements are kept in ORION on your Mac. They appear here once it reports in.",
                            tint: Phone.accent)
        }
    }

    private func water(_ tracking: LinkSnapshot.Tracking) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionLabel("Water", tint: Phone.accent)
            HStack(spacing: 20) {
                PhoneGauge(label: "Bottles", figure: "\(tracking.waterBottles)", fraction: fraction(tracking.waterBottles, tracking.waterGoal),
                           unit: "of \(tracking.waterGoal)", tint: Phone.accent, size: 88)
                    .waterGoalMenu(goal: tracking.waterGoal) { setGoal($0) }
                Spacer(minLength: 0)
                Button { remote.log(.water(delta: -1)) } label: { Image(systemName: "minus") }
                    .buttonStyle(RoundIconStyle()).disabled(tracking.waterBottles == 0).accessibilityLabel("Remove a bottle")
                Button { remote.log(.water(delta: 1)) } label: { Image(systemName: "plus") }
                    .buttonStyle(RoundIconStyle(prominent: true)).accessibilityLabel("Add a bottle")
            }
        }
        .animation(.spring(response: 0.3), value: tracking.waterBottles)
        .sensoryFeedback(.increase, trigger: tracking.waterBottles)
    }

    /// The Mac keeps the goal; this sends it, shows it here at once (RemoteStore.tracking) and on the widgets.
    private func setGoal(_ bottles: Int) {
        remote.log(.waterGoal(bottles: bottles))
        if let directory = GlanceStore.directory, WaterTap.setGoal(bottles, in: directory) { WaterCourier.reloadSurfaces() }
    }

    private func fraction(_ value: Int, _ goal: Int) -> Double? { RingMath.fraction(Double(value), of: Double(goal)) }

    private func food(_ tracking: LinkSnapshot.Tracking) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionLabel("Food", tint: Phone.orange)
            HStack(spacing: 20) {
                PhoneGauge(label: "Calories", figure: tracking.calories.formatted(), fraction: fraction(tracking.calories, tracking.calorieGoal),
                           unit: "of \(tracking.calorieGoal.formatted())", tint: tracking.calories > tracking.calorieGoal && tracking.calorieGoal > 0 ? Phone.red : Phone.orange, size: 88)
                PhoneGauge(label: "Protein", figure: "\(tracking.protein)", fraction: fraction(tracking.protein, tracking.proteinGoal),
                           unit: "of \(tracking.proteinGoal) g", tint: Phone.purple, size: 88)
                Spacer(minLength: 0)
                Button { loggingFood = true } label: { Label("Log food", systemImage: "camera").fixedSize() }
                    .buttonStyle(PhoneButtonStyle(tint: Phone.orange, prominent: true))
                    .accessibilityIdentifier("logFood")
            }
            if tracking.meals.isEmpty {
                Text("Nothing logged yet today.").font(.system(size: 14)).foregroundStyle(Phone.dim)
            } else {
                VStack(spacing: 0) {
                    ForEach(tracking.meals) { meal in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(meal.title).font(.system(size: 15, weight: .medium)).foregroundStyle(Phone.text).lineLimit(2)
                                Text(meal.protein > 0 ? "\(meal.meal) · \(meal.protein) g protein" : meal.meal)
                                    .font(.system(size: 12)).foregroundStyle(Phone.dim)
                            }
                            Spacer(minLength: 8)
                            Text("\(meal.calories) kcal").font(Phone.mono(12, .medium)).foregroundStyle(Phone.soft).fixedSize()
                        }
                        .padding(.vertical, 12)
                        .opacity(meal.id.hasPrefix("pending-") ? 0.55 : 1)
                        .overlay(alignment: .bottom) { Rectangle().fill(Phone.hairline).frame(height: 1) }
                        .contextMenu {
                            if !meal.id.hasPrefix("pending-") {
                                Button("Remove", systemImage: "trash", role: .destructive) { remote.log(.removeMeal(id: meal.id)) }
                            }
                        }
                    }
                }
                Text("Touch and hold a meal to remove it.").font(.system(size: 12)).foregroundStyle(Phone.dim)
            }
        }
    }

    private func supplements(_ tracking: LinkSnapshot.Tracking) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Supplements · \(tracking.supplements.filter(\.taken).count)/\(tracking.supplements.count)", tint: Phone.green)
            ForEach(tracking.supplements) { item in
                Button { remote.log(.supplement(id: item.id, taken: !item.taken)) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: item.taken ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 22)).foregroundStyle(item.taken ? Phone.green : Phone.soft)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name).font(.system(size: 15, weight: .medium)).foregroundStyle(Phone.text)
                                .strikethrough(item.taken, color: Phone.dim)
                            Text([item.dose, item.timeOfDay == "anytime" ? "" : item.timeOfDay].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.system(size: 12)).foregroundStyle(Phone.dim)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 8).frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .sensoryFeedback(.success, trigger: item.taken)
                .accessibilityLabel("\(item.name), \(item.taken ? "taken" : "not taken")")
            }
        }
    }
}

// MARK: - Today's compact strip

/// Water at a glance and one tap. Food is logged only from the Health tab's Log food button.
struct TodayTracking: View {
    @ObservedObject var remote: RemoteStore
    var openHealth: () -> Void

    var body: some View {
        if let tracking = remote.tracking {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel("Tracking", tint: Phone.accent)
                HStack(spacing: 14) {
                    tile(symbol: "drop.fill", tint: Phone.accent, value: "\(tracking.waterBottles)/\(tracking.waterGoal)", label: "bottles") {
                        remote.log(.water(delta: 1))
                    }
                    .accessibilityLabel("Add a bottle of water, \(tracking.waterBottles) so far")
                }
                Button(action: openHealth) { Label("Health and supplements", systemImage: "arrow.right") }
                    .buttonStyle(PhoneButtonStyle())
            }
        }
    }

    private func tile(symbol: String, tint: Color, value: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().strokeBorder(tint.opacity(0.5), lineWidth: 1)
                    Image(systemName: symbol).font(.system(size: 15, weight: .light)).foregroundStyle(tint)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 1) {
                    Text(value).font(.system(size: 20, weight: .regular, design: .serif)).foregroundStyle(Phone.text)
                        .contentTransition(.numericText()).minimumScaleFactor(0.8).lineLimit(1)
                    Text(label).font(.system(size: 11)).foregroundStyle(Phone.dim).lineLimit(1).minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
                Image(systemName: "plus").font(.system(size: 12, weight: .bold)).foregroundStyle(tint)
            }
            .padding(.horizontal, 14).padding(.vertical, 12).frame(minHeight: 64)
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(tint.opacity(0.4), lineWidth: 0.9))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Logging food

struct FoodSheet: View {
    @ObservedObject var remote: RemoteStore
    let recents: [LinkSnapshot.Tracking.Meal]
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var meal = FoodSheet.mealForNow()
    @State private var calories = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                if !recents.isEmpty {
                    Section("Again") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(recents) { food in
                                    Button {
                                        remote.log(.meal(title: food.title, meal: meal, calories: food.calories, protein: food.protein, carbohydrates: 0, fat: 0))
                                        dismiss()
                                    } label: {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(food.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                                            Text("\(food.calories) kcal").font(.system(size: 11)).foregroundStyle(.secondary)
                                        }
                                        .padding(.horizontal, 12).padding(.vertical, 8)
                                        .background(Phone.orange.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    }
                }
                Section {
                    TextField("What did you eat?", text: $title).focused($focused)
                    Picker("Meal", selection: $meal) { ForEach(LinkLog.meals, id: \.self) { Text($0) } }
                }
                Section("Numbers") {
                    number("Calories", "kcal", $calories)
                    number("Protein", "g", $protein)
                    number("Carbs", "g", $carbs)
                    number("Fat", "g", $fat)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Phone.ink)
            .navigationTitle("Log food")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Log", action: save).disabled(!canSave).fontWeight(.semibold) }
            }
            .onAppear { focused = recents.isEmpty }
        }
        .presentationDetents([.medium, .large])
    }

    private func number(_ label: String, _ unit: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("0", text: value).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 90)
            Text(unit).foregroundStyle(.secondary).frame(width: 34, alignment: .leading)
        }
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty && (Int(calories) ?? -1) >= 0 && (Int(calories) ?? 0) <= 5000
    }

    private func save() {
        remote.log(.meal(title: title, meal: meal, calories: Int(calories) ?? 0, protein: Int(protein) ?? 0,
                         carbohydrates: Int(carbs) ?? 0, fat: Int(fat) ?? 0))
        dismiss()
    }

    static func mealForNow(_ date: Date = Date()) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 4..<11: return "Breakfast"
        case 11..<15: return "Lunch"
        case 17..<22: return "Dinner"
        default: return "Snack"
        }
    }
}

// MARK: - Pieces

struct RoundIconStyle: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(Phone.text)
            .frame(width: 44, height: 44)
            .background(Circle().fill(Phone.accent.opacity(prominent ? 0.14 : 0.05)))
            .overlay(Circle().strokeBorder(Phone.accent.opacity(prominent ? 0.75 : 0.4), lineWidth: 1))
            .shadow(color: Phone.accent.opacity(prominent ? 0.3 : 0), radius: 7)
            .opacity(enabled ? 1 : 0.35)
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
    }
}
