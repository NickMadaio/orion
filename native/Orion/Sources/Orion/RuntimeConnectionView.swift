import SwiftUI

/// One contextual object beside the request, expanded only when useful.
struct RuntimeConnectionView: View {
    let snapshot: GatewayHealthSnapshot
    var refresh: () -> Void
    @State private var expanded = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let availability = snapshot.current(at: context.date)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Button { expanded.toggle() } label: {
                        HStack(spacing: 7) {
                            Image(systemName: availability == .ready ? "checkmark.circle" : "exclamationmark.circle")
                                .foregroundStyle(availability == .ready ? OrionTheme.green : OrionTheme.orange)
                            Text(availability.title)
                            Image(systemName: expanded ? "chevron.up" : "chevron.down")
                                .font(.system(size: 8))
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Show connection details")
                    Spacer(minLength: 4)
                    if availability != .ready {
                        Button("Check again", action: refresh).buttonStyle(.plain)
                            .foregroundStyle(OrionTheme.accent)
                    }
                }
                if expanded || availability != .ready {
                    Text(availability.detail)
                        .foregroundStyle(OrionTheme.textSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .font(.system(size: 11))
            .foregroundStyle(OrionTheme.textSoft)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 5)
        }
    }
}
