import CoreGraphics

/// Where he is looking: zoom about the canvas centre plus a pan. A value type; `KnowledgeSky` holds the current one,
/// so it survives tab switches.
///
/// Zooming anchors at the cursor, Figma-style: the world point under the pointer stays under it. Pan is clamped so
/// the graph cannot be pushed off-screen and lost.
struct SkyCamera: Equatable {
    static let zoomRange: ClosedRange<CGFloat> = 0.5...3

    private(set) var zoom: CGFloat = 1
    private(set) var pan: CGSize = .zero

    func screen(_ p: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: size.width / 2 + (p.x - size.width / 2) * zoom + pan.width,
                y: size.height / 2 + (p.y - size.height / 2) * zoom + pan.height)
    }

    func world(_ s: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: size.width / 2 + (s.x - size.width / 2 - pan.width) / zoom,
                y: size.height / 2 + (s.y - size.height / 2 - pan.height) / zoom)
    }

    func zoomed(by factor: CGFloat, at cursor: CGPoint, in size: CGSize) -> SkyCamera {
        let next = min(Self.zoomRange.upperBound, max(Self.zoomRange.lowerBound, zoom * factor))
        let ratio = next / zoom
        let ox = cursor.x - size.width / 2, oy = cursor.y - size.height / 2
        let moved = CGSize(width: ox - (ox - pan.width) * ratio, height: oy - (oy - pan.height) * ratio)
        return SkyCamera(zoom: next, pan: moved).clamped(in: size)
    }

    func panned(by delta: CGSize, in size: CGSize) -> SkyCamera {
        withPan(CGSize(width: pan.width + delta.width, height: pan.height + delta.height), in: size)
    }

    func withPan(_ next: CGSize, in size: CGSize) -> SkyCamera { SkyCamera(zoom: zoom, pan: next).clamped(in: size) }

    /// Eased toward a target camera by `t` of the way (the zoom buttons' glide).
    func moved(toward target: SkyCamera, by t: CGFloat) -> SkyCamera {
        SkyCamera(zoom: zoom + (target.zoom - zoom) * t,
                  pan: CGSize(width: pan.width + (target.pan.width - pan.width) * t,
                              height: pan.height + (target.pan.height - pan.height) * t))
    }

    func isNear(_ other: SkyCamera) -> Bool {
        abs(zoom - other.zoom) < 0.001 && abs(pan.width - other.pan.width) < 0.3 && abs(pan.height - other.pan.height) < 0.3
    }

    /// The graph's oval may slide at most to the canvas edge, however far he zooms.
    private func clamped(in size: CGSize) -> SkyCamera {
        let limitX = size.width / 2 * max(zoom, 1), limitY = size.height / 2 * max(zoom, 1)
        return SkyCamera(zoom: zoom, pan: CGSize(width: min(limitX, max(-limitX, pan.width)),
                                                 height: min(limitY, max(-limitY, pan.height))))
    }
}
