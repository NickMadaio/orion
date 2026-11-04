import SwiftUI
import MobileCore

/*
 The water goal's menu (2026-11-04): right-click on the Mac, long-press on the phone.

 Nick: "if I right click the water I can change the 'out of' number." One
 modifier gives both platforms the same choices: the goal as a title, one
 fewer and one more, quick picks (6, 8, 9, 10, 12) and "Custom…", which asks for
 a number in a small alert. The caller decides what a choice does: the Mac writes
 the health log, the phone sends a command to the Mac. Choices are clamped to
 1...30 by `WaterGoal` before the caller ever sees them.
*/
public struct WaterGoalMenu: ViewModifier {
    let goal: Int
    let onChange: (Int) -> Void
    @State private var asking = false
    @State private var typed = ""

    public init(goal: Int, onChange: @escaping (Int) -> Void) { self.goal = goal; self.onChange = onChange }

    public func body(content: Content) -> some View {
        content
            .contextMenu {
                Text("Daily goal: \(goal) bottle\(goal == 1 ? "" : "s")")
                Button { onChange(WaterGoal.stepped(goal, by: -1)) } label: { Label("One fewer", systemImage: "minus") }
                    .disabled(goal <= WaterGoal.range.lowerBound)
                Button { onChange(WaterGoal.stepped(goal, by: 1)) } label: { Label("One more", systemImage: "plus") }
                    .disabled(goal >= WaterGoal.range.upperBound)
                Divider()
                ForEach(WaterGoal.picks, id: \.self) { pick in
                    Button { onChange(pick) } label: {
                        if pick == goal { Label("\(pick) bottles", systemImage: "checkmark") } else { Text("\(pick) bottles") }
                    }
                }
                Divider()
                Button("Custom…") { typed = String(goal); asking = true }
            }
            .alert("Daily water goal", isPresented: $asking) {
                TextField("Bottles", text: $typed)
                #if os(iOS)
                    .keyboardType(.numberPad)
                #endif
                Button("Set") { if let value = WaterGoal.parse(typed) { onChange(value) } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("How many bottles a day, \(WaterGoal.range.lowerBound) to \(WaterGoal.range.upperBound)?")
            }
    }
}

public extension View {
    /// Right-click (Mac) or long-press (phone) opens the water goal menu.
    func waterGoalMenu(goal: Int, onChange: @escaping (Int) -> Void) -> some View {
        modifier(WaterGoalMenu(goal: goal, onChange: onChange))
    }
}
