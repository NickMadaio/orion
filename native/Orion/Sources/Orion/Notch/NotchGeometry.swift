import AppKit

/// The screen numbers the pill needs, as plain values so placement can be tested without a display.
/// Rectangles are in global screen coordinates (origin bottom-left), exactly as NSScreen reports them.
struct NotchScreenMetrics: Equatable {
    var frame: CGRect
    var visibleFrame: CGRect
    var safeAreaTop: CGFloat
    var auxLeft: CGRect?
    var auxRight: CGRect?

    init(frame: CGRect, visibleFrame: CGRect, safeAreaTop: CGFloat, auxLeft: CGRect?, auxRight: CGRect?) {
        self.frame = frame
        self.visibleFrame = visibleFrame
        self.safeAreaTop = safeAreaTop
        self.auxLeft = auxLeft
        self.auxRight = auxRight
    }

    init(screen: NSScreen) {
        self.init(frame: screen.frame, visibleFrame: screen.visibleFrame,
                  safeAreaTop: screen.safeAreaInsets.top,
                  auxLeft: screen.auxiliaryTopLeftArea, auxRight: screen.auxiliaryTopRightArea)
    }
}

/// How much of the pill is showing.
enum NotchPillSize: Equatable {
    /// One line, the height of the notch band.
    case compact
    /// Dropped a little below the band: the finished answer's short preview.
    case preview
    /// Hovered: more of the answer.
    case expanded
}

/// Where the pill goes. On a notched screen it is flush with the top edge and centred on the notch, so its black body
/// merges with the cut-out; elsewhere it sits at top centre just under the menu bar.
enum NotchGeometry {
    static let wing: CGFloat = 170
    static let previewDrop: CGFloat = 56
    static let expandedDrop: CGFloat = 120
    static let flatHeight: CGFloat = 34
    static let flatCompactWidth: CGFloat = 270
    static let flatGap: CGFloat = 6

    /// The cut-out itself, or nil on a screen without one.
    static func notch(_ metrics: NotchScreenMetrics) -> CGRect? {
        guard metrics.safeAreaTop > 0, let left = metrics.auxLeft, let right = metrics.auxRight,
              right.minX > left.maxX else { return nil }
        return CGRect(x: left.maxX, y: metrics.frame.maxY - metrics.safeAreaTop,
                      width: right.minX - left.maxX, height: metrics.safeAreaTop)
    }

    /// Width of the dead centre of the pill, which content must route around. Zero without a notch.
    static func notchGap(_ metrics: NotchScreenMetrics) -> CGFloat {
        notch(metrics)?.width ?? 0
    }

    static func pillFrame(_ metrics: NotchScreenMetrics, size: NotchPillSize) -> CGRect {
        if let notch = notch(metrics) {
            let compactWidth = notch.width + 2 * wing
            let (width, height): (CGFloat, CGFloat) = switch size {
            case .compact: (compactWidth, notch.height)
            case .preview: (compactWidth + 40, notch.height + previewDrop)
            case .expanded: (compactWidth + 90, notch.height + expandedDrop)
            }
            return CGRect(x: notch.midX - width / 2, y: metrics.frame.maxY - height, width: width, height: height)
        }
        let (width, height): (CGFloat, CGFloat) = switch size {
        case .compact: (flatCompactWidth, flatHeight)
        case .preview: (flatCompactWidth + 50, flatHeight + previewDrop)
        case .expanded: (flatCompactWidth + 110, flatHeight + expandedDrop)
        }
        let top = metrics.visibleFrame.maxY - flatGap
        return CGRect(x: metrics.frame.midX - width / 2, y: top - height, width: width, height: height)
    }

    /// The fixed window the pill is drawn in: big enough for the largest size so the content animates inside it.
    static func hostFrame(_ metrics: NotchScreenMetrics) -> CGRect {
        let largest = pillFrame(metrics, size: .expanded)
        let padded = largest.insetBy(dx: -16, dy: 0)
        let frame = CGRect(x: padded.minX, y: padded.minY - 16, width: padded.width, height: padded.height + 16)
        return frame.intersection(metrics.frame)
    }

    /// Where the pill's centre sits inside the host window, in SwiftUI's top-left coordinates.
    static func pillOrigin(_ metrics: NotchScreenMetrics, size: NotchPillSize) -> CGPoint {
        let host = hostFrame(metrics)
        let pill = pillFrame(metrics, size: size)
        return CGPoint(x: pill.minX - host.minX, y: host.maxY - pill.maxY)
    }

    /// SwiftUI offset (y down) that places the compact pill's centre on a point where the floating orb was.
    /// Positive height means the orb was below the pill.
    static func flyOffset(from orbCentre: CGPoint, metrics: NotchScreenMetrics) -> CGSize {
        let pill = pillFrame(metrics, size: .compact)
        return CGSize(width: orbCentre.x - pill.midX, height: pill.midY - orbCentre.y)
    }
}
