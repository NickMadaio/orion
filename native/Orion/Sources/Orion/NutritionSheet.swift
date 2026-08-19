import SwiftUI

/// A local-first food log. It deliberately does not guess portions or call an
/// online food database: every number is an explicit entry Nick can inspect,
/// correct, or delete.
struct NutritionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var health: HealthLog
    var onClose: () -> Void

    @State private var title = ""
    @State private var meal = "Breakfast"
    @State private var calories = ""
    @State private var protein = ""
    @State private var carbohydrates = ""
    @State private var fat = ""
    @State private var fiber = ""
    @State private var showingGoals = false
    @State private var goals = NutritionGoals()

    private let meals = ["Breakfast", "Lunch", "Dinner", "Snack", "Other"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(OrionTheme.line)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    summary
                    adder
                    if !health.recentFoods.isEmpty { recentFoods }
                    entries
                    goalsEditor
                }
                .padding(20)
            }
        }
        .frame(width: 620, height: 720)
        .background {
            ZStack {
                VisualEffectBackground(material: .hudWindow)
                Color.black.opacity(0.30)
            }.ignoresSafeArea()
        }
        .preferredColorScheme(.dark)
        .onAppear { goals = health.nutritionGoals }
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Nutrition")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(OrionTheme.text)
                Text("A local food log — every total is editable.")
                    .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
            }
            Spacer()
            Button("Done") {
                onClose()
                dismiss()
            }
            .buttonStyle(.plain)
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(.black)
                .padding(.horizontal, 16).padding(.vertical, 8).background(Capsule().fill(.white))
        }.padding(.horizontal, 20).padding(.vertical, 16)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionRule(title: "Today", trailing: "\(health.mealsToday.count) entries")
            HStack(spacing: 10) {
                summaryStat("\(health.caloriesToday)", "kcal", health.nutritionGoals.calories)
                summaryStat("\(macro(\.protein))g", "protein", health.nutritionGoals.protein)
                summaryStat("\(macro(\.carbohydrates))g", "carbs", health.nutritionGoals.carbohydrates)
                summaryStat("\(macro(\.fat))g", "fat", health.nutritionGoals.fat)
                summaryStat("\(macro(\.fiber))g", "fiber", health.nutritionGoals.fiber)
            }
        }
    }

    private func summaryStat(_ value: String, _ label: String, _ target: Int) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value).font(.system(size: 17, weight: .semibold, design: .rounded)).foregroundStyle(OrionTheme.text)
            Text("\(label) · \(target)").font(OrionTheme.mono(8)).foregroundStyle(OrionTheme.textDim)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(10).background(field)
    }

    private var adder: some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionRule(title: "Log food")
            HStack(spacing: 8) {
                TextField("Food or drink", text: $title).textFieldStyle(.plain).fieldStyle()
                Picker("", selection: $meal) { ForEach(meals, id: \.self) { Text($0) } }.labelsHidden().frame(width: 112)
            }
            HStack(spacing: 8) {
                numericField("Calories", value: $calories)
                numericField("Protein g", value: $protein)
                numericField("Carbs g", value: $carbohydrates)
                numericField("Fat g", value: $fat)
                numericField("Fiber g", value: $fiber)
                Button("Add", action: add).buttonStyle(.plain)
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.black)
                    .padding(.horizontal, 15).padding(.vertical, 9)
                    .background(Capsule().fill(canAdd ? OrionTheme.orange : Color.white.opacity(0.2))).disabled(!canAdd)
            }
        }
    }

    private var recentFoods: some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionRule(title: "Recent — add again")
            FlowLayout(spacing: 7) {
                ForEach(health.recentFoods) { food in
                    Button("+ \(food.title)") { health.addNutrition(NutritionEntry(title: food.title, meal: food.meal, calories: food.calories, protein: food.protein, carbohydrates: food.carbohydrates, fat: food.fat, fiber: food.fiber)) }
                        .buttonStyle(.plain).font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textSoft)
                        .padding(.horizontal, 10).padding(.vertical, 7).background(Capsule().fill(.white.opacity(0.06)))
                }
            }
        }
    }

    private var entries: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionRule(title: "Today’s log")
            if health.mealsToday.isEmpty {
                Text("No food logged yet.").font(.system(size: 13)).foregroundStyle(OrionTheme.textDim)
            } else {
                ForEach(health.mealsToday) { entry in
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.title).font(.system(size: 13, weight: .medium)).foregroundStyle(OrionTheme.text)
                            Text("\(entry.meal) · P \(entry.protein)g · C \(entry.carbohydrates)g · F \(entry.fat)g").font(OrionTheme.mono(9)).foregroundStyle(OrionTheme.textDim)
                        }
                        Spacer()
                        Text("\(entry.calories) kcal").font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textSoft)
                        Button { health.removeNutrition(entry.id) } label: { Image(systemName: "trash").font(.system(size: 10)).foregroundStyle(OrionTheme.textDim) }.buttonStyle(.plain)
                    }.padding(.horizontal, 12).padding(.vertical, 9).background(field)
                }
            }
        }
    }

    private var goalsEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(showingGoals ? "Hide daily targets" : "Set daily targets") { showingGoals.toggle() }
                .buttonStyle(.plain).font(.system(size: 12, weight: .medium)).foregroundStyle(OrionTheme.textSoft)
            if showingGoals {
                HStack(spacing: 8) {
                    goalField("Calories", keyPath: \.calories); goalField("Protein", keyPath: \.protein); goalField("Carbs", keyPath: \.carbohydrates); goalField("Fat", keyPath: \.fat); goalField("Fiber", keyPath: \.fiber)
                    Button("Save") { health.setNutritionGoals(goals) }.buttonStyle(.plain).font(.system(size: 12, weight: .semibold)).foregroundStyle(.black).padding(.horizontal, 13).padding(.vertical, 8).background(Capsule().fill(OrionTheme.orange))
                }
            }
        }
    }

    private func numericField(_ placeholder: String, value: Binding<String>) -> some View { TextField(placeholder, text: value).textFieldStyle(.plain).fieldStyle().frame(width: 82) }
    private func goalField(_ label: String, keyPath: WritableKeyPath<NutritionGoals, Int>) -> some View { TextField(label, value: Binding(get: { goals[keyPath: keyPath] }, set: { goals[keyPath: keyPath] = $0 }), format: .number).textFieldStyle(.plain).fieldStyle().frame(width: 82) }
    private var canAdd: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && Int(calories) != nil }
    private func macro(_ keyPath: KeyPath<NutritionEntry, Int>) -> Int { health.mealsToday.reduce(0) { $0 + $1[keyPath: keyPath] } }
    private func add() { guard let calories = Int(calories) else { return }; health.addNutrition(NutritionEntry(title: title, meal: meal, calories: calories, protein: Int(protein) ?? 0, carbohydrates: Int(carbohydrates) ?? 0, fat: Int(fat) ?? 0, fiber: Int(fiber) ?? 0)); title = ""; self.calories = ""; protein = ""; carbohydrates = ""; fat = ""; fiber = "" }
    private var field: some View { RoundedRectangle(cornerRadius: 9, style: .continuous).fill(.white.opacity(0.06)).overlay { RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(.white.opacity(0.10), lineWidth: 0.5) } }
}

private extension View { func fieldStyle() -> some View { self.font(.system(size: 12)).foregroundStyle(OrionTheme.text).padding(.horizontal, 10).padding(.vertical, 9).background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(.white.opacity(0.06)).overlay { RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(.white.opacity(0.10), lineWidth: 0.5) }) } }

/// Compact wrapping layout for recent-food chips.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize { let width = proposal.width ?? 500; var x: CGFloat = 0, y: CGFloat = 0, height: CGFloat = 0; for subview in subviews { let size = subview.sizeThatFits(.unspecified); if x + size.width > width, x > 0 { x = 0; y += height + spacing; height = 0 }; x += size.width + spacing; height = max(height, size.height) }; return CGSize(width: width, height: y + height) }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) { var x = bounds.minX, y = bounds.minY, height: CGFloat = 0; for subview in subviews { let size = subview.sizeThatFits(.unspecified); if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += height + spacing; height = 0 }; subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size)); x += size.width + spacing; height = max(height, size.height) } }
}
