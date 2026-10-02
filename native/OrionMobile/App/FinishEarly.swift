import SwiftUI

enum FinishEarlyChoice: String, Equatable { case block, outOfClass = "out-of-class", home }
enum FinishEarlyContext: Equatable { case none, block(title: String), afterClass(classTitle: String) }
struct FinishEarlyButton: View {
    var context: FinishEarlyContext
    var onChoose: (FinishEarlyChoice) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var morph
    @State private var expanded = false
    @State private var confirmed = false
    @State private var confirmationCount = 0
    @State private var timer: Task<Void, Never>?
    private var animation: Animation { reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.35, dampingFraction: 0.85) }
    private var unavailable: Bool { context == .none }
    var body: some View {
        HStack(spacing: 8) {
            Button(action: tapped) {
                HStack(spacing: 8) {
                    Image(systemName: confirmed ? "checkmark.circle.fill" : "forward.end.fill")
                        .contentTransition(.symbolEffect(.replace))
                        .foregroundStyle(unavailable ? Phone.dim : Phone.accent)
                    if !expanded { Text(unavailable ? "Nothing under way" : "Finished early").font(.system(size: 15, weight: .medium)).foregroundStyle(unavailable ? Phone.dim : Phone.text) }
                }
                .padding(.horizontal, expanded ? 0 : 14).frame(width: expanded ? 44 : nil, height: 44)
                .background(Color.white.opacity(0.06), in: Capsule())
                .overlay(Capsule().stroke(Phone.hairline, lineWidth: 1))
                .modifier(EarlyMorph(namespace: morph, enabled: !reduceMotion))
            }.buttonStyle(.plain).disabled(unavailable)
                .accessibilityLabel(expanded ? "Cancel choices" : unavailable ? "Nothing under way" : "Finished early")
            if expanded {
                choice(.outOfClass, symbol: "figure.walk.departure", label: "Out of class early")
                choice(.home, symbol: "house.fill", label: "Already home")
            }
        }
        .animation(animation, value: expanded).animation(animation, value: confirmed)
        .sensoryFeedback(.success, trigger: confirmationCount)
        .onChange(of: context) { _, _ in timer?.cancel(); expanded = false; confirmed = false }
        .onDisappear { timer?.cancel() }
    }
    private func choice(_ value: FinishEarlyChoice, symbol: String, label: String) -> some View {
        Button { choose(value) } label: {
            Image(systemName: symbol).foregroundStyle(Phone.accent).frame(width: 44, height: 44)
                .background(Color.white.opacity(0.06), in: Circle()).overlay(Circle().stroke(Phone.hairline, lineWidth: 1))
        }.buttonStyle(.plain).accessibilityLabel(label).transition(.opacity)
    }
    private func tapped() {
        timer?.cancel()
        if expanded { expanded = false; return }
        switch context {
        case .none: return
        case .block: choose(.block)
        case .afterClass:
            expanded = true
            timer = Task { @MainActor in
                do { try await Task.sleep(for: .seconds(6)) } catch { return }
                expanded = false
            }
        }
    }
    private func choose(_ choice: FinishEarlyChoice) {
        timer?.cancel(); onChoose(choice); expanded = false; confirmed = true; confirmationCount += 1
        timer = Task { @MainActor in
            do { try await Task.sleep(for: .seconds(1.5)) } catch { return }
            confirmed = false
        }
    }
}
private struct EarlyMorph: ViewModifier {
    let namespace: Namespace.ID
    let enabled: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if enabled { content.matchedGeometryEffect(id: "early", in: namespace) } else { content }
    }
}
#Preview {
    VStack(spacing: 24) {
        FinishEarlyButton(context: .none) { _ in }
        FinishEarlyButton(context: .block(title: "Study")) { _ in }
        FinishEarlyButton(context: .afterClass(classTitle: "Lab")) { _ in }
    }.padding().background(.black)
}
