import SwiftUI
import MobileCore

/// "Done early": one tap tells ORION that what is happening now is finished. The Mac works out what is current
/// (a class, a task, the gym…) and answers in one line, which shows under the button. With nothing on it still
/// works: ORION says so and offers what is next. The words live in `DoneEarly` (MobileCore) so every surface agrees.
struct FinishEarlyButton: View {
    var context: EarlyFinishContext?
    var feedback: String?
    var onPress: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: onPress) {
                Label(DoneEarly.label, systemImage: DoneEarly.symbol)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Phone.text)
            }
            .buttonStyle(PhoneButtonStyle(tint: Phone.green))
            .accessibilityLabel(DoneEarly.accessibilityLabel(for: context))
            .accessibilityHint(DoneEarly.accessibilityHint(for: context))
            if let feedback {
                Text(feedback).font(.system(size: 12)).foregroundStyle(Phone.soft)
                    .accessibilityLabel(feedback)
            }
        }
    }
}
