import SwiftUI

enum FinishEarlyChoice: String, Equatable { case block, outOfClass = "out-of-class" }
enum FinishEarlyContext: Equatable { case none, block(title: String), afterClass(classTitle: String) }
struct FinishEarlyButton: View {
    var context: FinishEarlyContext
    var onChoose: (FinishEarlyChoice) -> Void
    var body: some View {
        Button {
            switch context { case .none: break; case .block: onChoose(.block); case .afterClass: onChoose(.outOfClass) }
        } label: {
            Label("I'm out early", systemImage: "arrow.right")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Phone.soft)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain).disabled(context == .none)
    }
}
