import SwiftUI
import MobileCore

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
            VStack(alignment: .leading, spacing: 30) {
                if let problem = remote.trackingProblem {
                    Label(problem, systemImage: "exclamationmark.triangle").font(.system(size: 13)).foregroundStyle(Phone.orange)
                }
                water(tracking)
                food(tracking)
                if !tracking.supplements.isEmpty { supplements(tracking) }
            }
            .sheet(isPresented: $loggingFood) { FoodSheet(remote: remote, recents: tracking.recentFoods) }
        } else {
            PhoneEmptyState(symbol: "drop", title: remote.snapshot == nil ? "Waiting for your Mac" : "Tracking isn't set up on your Mac",
                            detail: "Water, food and supplements are kept in ORION on your Mac. They appear here once it reports in.",
                            tint: Phone.accent)
        }
    }

    private func water(_ tracking: LinkSnapshot.Tracking) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionLabel("Water", tint: Phone.accent)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(tracking.waterBottles)").font(.system(size: 40, weight: .light, design: .rounded)).foregroundStyle(Phone.text)
                    .contentTransition(.numericText())
                Text("of \(tracking.waterGoal) bottles").font(.system(size: 14)).foregroundStyle(Phone.soft)
                Spacer()
                Button { remote.log(.water(delta: -1)) } label: { Image(systemName: "minus") }
                    .buttonStyle(RoundIconStyle()).disabled(tracking.waterBottles == 0).accessibilityLabel("Remove a bottle")
                Button { remote.log(.water(delta: 1)) } label: { Image(systemName: "plus") }
                    .buttonStyle(RoundIconStyle(prominent: true)).accessibilityLabel("Add a bottle")
            }
            BottleRow(count: tracking.waterBottles, goal: tracking.waterGoal)
        }
        .animation(.spring(response: 0.3), value: tracking.waterBottles)
        .sensoryFeedback(.increase, trigger: tracking.waterBottles)
    }

    private func food(_ tracking: LinkSnapshot.Tracking) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionLabel("Food", tint: Phone.orange)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(tracking.calories.formatted()).font(.system(size: 40, weight: .light, design: .rounded)).foregroundStyle(Phone.text)
                    .contentTransition(.numericText())
                Text("of \(tracking.calorieGoal.formatted()) kcal").font(.system(size: 14)).foregroundStyle(Phone.soft)
                Spacer()
                Button { loggingFood = true } label: { Label("Log", systemImage: "plus").fixedSize() }
                    .buttonStyle(PhoneButtonStyle(tint: Phone.orange, prominent: true))
                    .accessibilityIdentifier("logFood")
            }
            Meter(value: tracking.calories, goal: tracking.calorieGoal, tint: Phone.orange)
            HStack(spacing: 8) {
                Text("Protein").font(.system(size: 13)).foregroundStyle(Phone.soft)
                Meter(value: tracking.protein, goal: tracking.proteinGoal, tint: Phone.violet, height: 4)
                Text("\(tracking.protein) / \(tracking.proteinGoal) g").font(Phone.mono(11, .medium)).foregroundStyle(Phone.soft)
            }
            if tracking.meals.isEmpty {
                Text("Nothing logged yet today.").font(.system(size: 14)).foregroundStyle(Phone.dim)
            } else {
                VStack(spacing: 0) {
                    ForEach(tracking.meals) { meal in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(meal.title).font(.system(size: 15, weight: .medium)).foregroundStyle(Phone.text)
                                Text(meal.protein > 0 ? "\(meal.meal) · \(meal.protein) g protein" : meal.meal)
                                    .font(.system(size: 12)).foregroundStyle(Phone.dim)
                            }
                            Spacer()
                            Text("\(meal.calories) kcal").font(Phone.mono(12, .medium)).foregroundStyle(Phone.soft)
                        }
                        .padding(.vertical, 10)
                        .opacity(meal.id.hasPrefix("pending-") ? 0.55 : 1)
                        .overlay(alignment: .bottom) { Rectangle().fill(Phone.hairline).frame(height: 1) }
                        .contextMenu {
                            if !meal.id.hasPrefix("pending-") {
                                Button("Remove", systemImage: "trash", role: .destructive) { remote.log(.removeMeal(id: meal.id)) }
                            }
                        }
                    }
                }
                Text("Touch and hold a meal to remove it.").font(.footnote).foregroundStyle(Phone.dim)
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
                    .padding(.vertical, 6).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .sensoryFeedback(.success, trigger: item.taken)
                .accessibilityLabel("\(item.name), \(item.taken ? "taken" : "not taken")")
            }
        }
    }
}

// MARK: - Today's compact strip

/// Water and food at a glance, with the two taps people actually make.
struct TodayTracking: View {
    @ObservedObject var remote: RemoteStore
    var openHealth: () -> Void
    @State private var loggingFood = false

    var body: some View {
        if let tracking = remote.tracking {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel("Tracking", tint: Phone.accent)
                HStack(spacing: 14) {
                    tile(symbol: "drop.fill", tint: Phone.accent, value: "\(tracking.waterBottles)/\(tracking.waterGoal)", label: "bottles") {
                        remote.log(.water(delta: 1))
                    }
                    .accessibilityLabel("Add a bottle of water, \(tracking.waterBottles) so far")
                    tile(symbol: "fork.knife", tint: Phone.orange, value: tracking.calories.formatted(), label: "of \(tracking.calorieGoal.formatted()) kcal") {
                        loggingFood = true
                    }
                    .accessibilityLabel("Log food, \(tracking.calories) calories so far")
                }
                Button(action: openHealth) { Label("Health and supplements", systemImage: "arrow.right") }
                    .buttonStyle(PhoneButtonStyle())
            }
            .sheet(isPresented: $loggingFood) { FoodSheet(remote: remote, recents: tracking.recentFoods) }
        }
    }

    private func tile(symbol: String, tint: Color, value: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(tint.opacity(0.14))
                    Image(systemName: symbol).font(.system(size: 16, weight: .semibold)).foregroundStyle(tint)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 1) {
                    Text(value).font(.system(size: 20, weight: .semibold, design: .rounded)).foregroundStyle(Phone.text)
                        .contentTransition(.numericText())
                    Text(label).font(.system(size: 11)).foregroundStyle(Phone.dim)
                }
                Spacer(minLength: 0)
                Image(systemName: "plus").font(.system(size: 12, weight: .bold)).foregroundStyle(tint)
            }
            .padding(12)
            .background(Phone.wash(0.04), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(tint.opacity(0.25), lineWidth: 1))
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

struct BottleRow: View {
    let count: Int
    let goal: Int
    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<max(goal, count), id: \.self) { index in
                Image(systemName: index < count ? "drop.fill" : "drop")
                    .font(.system(size: 18))
                    .foregroundStyle(index < count ? Phone.accent : Phone.dim.opacity(0.6))
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement().accessibilityLabel("\(count) of \(goal) bottles")
    }
}

struct Meter: View {
    let value: Int
    let goal: Int
    let tint: Color
    var height: CGFloat = 8
    var body: some View {
        GeometryReader { geometry in
            let fraction = goal > 0 ? min(1, CGFloat(value) / CGFloat(goal)) : 0
            ZStack(alignment: .leading) {
                Capsule().fill(Phone.wash(0.08))
                Capsule().fill(value > goal ? Phone.red : tint).frame(width: max(height, geometry.size.width * fraction))
                    .opacity(value == 0 ? 0 : 1)
            }
        }
        .frame(height: height)
        .animation(.spring(response: 0.4), value: value)
    }
}

struct RoundIconStyle: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(prominent ? Color.black : Phone.accent)
            .frame(width: 44, height: 44)
            .background(Circle().fill(prominent ? Phone.accent : Phone.accent.opacity(0.12)))
            .opacity(enabled ? 1 : 0.35)
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
    }
}
