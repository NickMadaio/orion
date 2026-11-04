import SwiftUI
import MobileCore

/// The minimal top bar: drawer on the left, the title (with the model menu) in
/// the middle, new chat on the right. No fill, no rule: it sits on the backdrop.
struct ChatTopBar: View {
    let title: String
    let subtitle: String
    let online: Bool
    let models: [ModelChoice]
    @Binding var selectedModel: String?
    let onMenu: () -> Void
    let onNew: () -> Void
    /// Back to Home; nil hides the button.
    var onHome: (() -> Void)? = nil

    var body: some View {
        ZStack {
            titleMenu.padding(.horizontal, 100)
            HStack {
                barButton("line.3.horizontal", label: "Menu", id: "openDrawer", action: onMenu)
                Spacer()
                if let onHome { barButton("house", label: "Home", id: "openHome", action: onHome) }
                barButton("square.and.pencil", label: "New chat", id: "newChat", action: onNew)
            }
        }
        .padding(.horizontal, 8).frame(height: 52)
        .overlay(alignment: .bottom) {
            LinearGradient(colors: [.clear, Phone.wash(0.14), .clear], startPoint: .leading, endPoint: .trailing).frame(height: 0.5)
        }
    }

    private var titleMenu: some View {
        Menu {
            Button("Default model") { selectedModel = nil }
            ForEach(models) { model in Button(model.label) { selectedModel = model.id } }
        } label: {
            VStack(spacing: 1) {
                HStack(spacing: 4) {
                    Text(title).font(Phone.display(19)).tracking(1.5).foregroundStyle(Phone.text).lineLimit(1).minimumScaleFactor(0.7)
                    if !models.isEmpty { Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(Phone.dim) }
                }
                HStack(spacing: 5) {
                    Circle().fill(online ? Phone.green : Phone.dim).frame(width: 5, height: 5)
                        .shadow(color: online ? Phone.green.opacity(0.7) : .clear, radius: 3)
                    Text(subtitle.uppercased()).font(Phone.mono(9, .medium)).tracking(1.3).foregroundStyle(Phone.dim)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
            }
        }
        .disabled(models.isEmpty)
        .accessibilityLabel(title)
    }

    private func barButton(_ symbol: String, label: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 18, weight: .regular)).foregroundStyle(Phone.text)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(PhonePressStyle()).accessibilityLabel(label).accessibilityIdentifier(id)
    }
}
