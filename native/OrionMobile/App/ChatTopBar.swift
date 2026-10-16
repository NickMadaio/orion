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

    var body: some View {
        ZStack {
            titleMenu
            HStack {
                barButton("line.3.horizontal", label: "Menu", id: "openDrawer", action: onMenu)
                Spacer()
                barButton("square.and.pencil", label: "New chat", id: "newChat", action: onNew)
            }
        }
        .padding(.horizontal, 8).frame(height: 48)
    }

    private var titleMenu: some View {
        Menu {
            Button("Default model") { selectedModel = nil }
            ForEach(models) { model in Button(model.label) { selectedModel = model.id } }
        } label: {
            VStack(spacing: 1) {
                HStack(spacing: 4) {
                    Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Phone.text)
                    if !models.isEmpty { Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(Phone.dim) }
                }
                HStack(spacing: 5) {
                    Circle().fill(online ? Phone.green : Phone.dim).frame(width: 5, height: 5)
                    Text(subtitle).font(.system(size: 11)).foregroundStyle(Phone.dim)
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
        .buttonStyle(.plain).accessibilityLabel(label).accessibilityIdentifier(id)
    }
}
