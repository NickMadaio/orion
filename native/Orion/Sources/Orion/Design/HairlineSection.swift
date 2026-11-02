import OrionViews
import SwiftUI

/// A group with nothing behind it: a mono caps title with a hairline that fades off to the right, an optional
/// trailing note, then the content after a breath of space. The replacement for every filled panel on the tabs.
/// `order` staggers its arrival on the Home deal schedule.
struct HairlineSection<Content: View, Accessory: View>: View {
    let title: String
    var trailing: String? = nil
    var hue: Color = Color.white.opacity(0.36)
    var spacing: CGFloat = 16
    var order: Int? = nil
    @ViewBuilder var accessory: () -> Accessory
    @ViewBuilder var content: () -> Content

    var body: some View {
        let section = VStack(alignment: .leading, spacing: spacing) {
            HStack(alignment: .center, spacing: 12) {
                Text(title.uppercased())
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(2.4)
                    .foregroundStyle(hue)
                    .fixedSize()
                FadingRule()
                if let trailing {
                    Text(trailing.uppercased())
                        .font(OrionTheme.mono(9, .medium))
                        .tracking(1.6)
                        .foregroundStyle(Color.white.opacity(0.36))
                        .fixedSize()
                }
                accessory()
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if let order {
            section.deal(order: order, rise: 12)
        } else {
            section
        }
    }
}

extension HairlineSection where Accessory == EmptyView {
    init(title: String, trailing: String? = nil, hue: Color = Color.white.opacity(0.36), spacing: CGFloat = 16,
         order: Int? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, trailing: trailing, hue: hue, spacing: spacing, order: order, accessory: { EmptyView() },
                  content: content)
    }
}

/// A row divider that fades at both ends, for lists inside a section.
struct RowHairline: View {
    var body: some View { FadingHairline(peak: 0.10) }
}
