import OrionViews
import SwiftUI

/*
 The page kit (wave 13): the new Home's language, factored so every tab speaks it. The pieces, each in its own
 file under Design/:
   · PageHeader     a display title top-left over one letter-spaced mono caps line that states a true summary;
   · Kicker         the coloured mono caps whisper above a card or a figure, one hue per kind;
   · OutlineCard    a thin tinted outline on near-black with a faint inner gradient, optionally tilted;
   · GlowPill       an outline capsule with a soft glow rim (the one action), plus CardDetailsLink ("details ›");
   · HairlineSection grouping by spacing and a fading hairline, never a fill;
   · GlanceRow      a quiet row of mono stats with hairline separators;
   · BigNumber, LineMeter  the one big figure per idea, and a line-art meter under it.
 Values only, no models: renders draw them from fixtures.
*/

/// The top of a page: a big display title and one mono caps line under it. The subline says one true thing about
/// the page right now ("2 RUNNING · 1 NEEDS REVIEW"), never a description of what the page is for.
struct PageHeader<Trailing: View>: View {
    let title: String
    let subline: String
    var subTint: Color = Color.white.opacity(0.38)
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 11) {
                Text(title)
                    .font(OrionTheme.display(31))
                    .foregroundStyle(OrionTheme.text)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if !subline.isEmpty {
                    Text(subline.uppercased())
                        .font(OrionTheme.mono(10, .medium))
                        .tracking(3.2)
                        .foregroundStyle(subTint)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 12)
            trailing()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .softReveal(delay: 0.05)
        .accessibilityElement(children: .contain)
    }
}

extension PageHeader where Trailing == EmptyView {
    init(title: String, subline: String, subTint: Color = Color.white.opacity(0.38)) {
        self.init(title: title, subline: subline, subTint: subTint) { EmptyView() }
    }
}

/// Joins the parts of a summary line with the Home separator, dropping empty parts.
enum PageSummary {
    static func line(_ parts: [String?]) -> String {
        parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}
