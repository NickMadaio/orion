import CoreGraphics
import Foundation

/// His hand on the graph: hit-testing, hover, dragging a node, and the camera (zoom at the cursor, pan).
/// Each mutates the non-observed model and calls `wake()`; the next frame draws the result.
extension KnowledgeSky {
    /// Star size: degree on a square root, scaled sub-linearly with zoom so zooming in does not balloon the dots.
    func radius(_ i: Int) -> CGFloat {
        nodes[i].isSelf ? 13 : min(11, 3.5 + sqrt(CGFloat(degree[i])) * 1.6)
    }

    var starScale: CGFloat { pow(camera.zoom, 0.62) }

    func screenPoint(_ i: Int, size: CGSize) -> CGPoint? {
        guard let p = physics, p.ids.indices.contains(i) else { return nil }
        return camera.screen(p.point(i), in: size)
    }

    func screenPoint(of id: String, size: CGSize) -> CGPoint? { index[id].flatMap { screenPoint($0, size: size) } }

    /// The nearest visible node within a forgiving reach of the pointer.
    func hitTest(_ s: CGPoint, size: CGSize) -> Int? {
        guard let p = physics else { return nil }
        var best: Int?
        var bestDistance = CGFloat.greatestFiniteMagnitude
        for i in p.ids.indices where visible.indices.contains(i) && visible[i] {
            let q = camera.screen(p.point(i), in: size)
            let d = hypot(q.x - s.x, q.y - s.y)
            if d < max(14, radius(i) * starScale + 8), d < bestDistance { best = i; bestDistance = d }
        }
        return best
    }

    /// Returns whether the hovered node changed (only then is anything redrawn).
    @discardableResult
    func hover(at s: CGPoint?, size: CGSize) -> Bool {
        let next = dragging == nil ? s.flatMap { hitTest($0, size: size) } : hovered
        guard next != hovered else { return false }
        setHovered(next)
        return true
    }

    func drag(_ i: Int, to s: CGPoint, size: CGSize) {
        guard let p = physics, p.ids.indices.contains(i) else { return }
        dragging = i
        physics = p.dragging(i, to: camera.world(s, in: size), reheat: animated)
        wake()
    }

    /// Let go: the node stays where he left it. Under Reduce Motion the neighbours settle at once, without motion.
    func endDrag(size: CGSize) {
        guard let i = dragging, let p = physics else { dragging = nil; return }
        dragging = nil
        let dropped = p.dropped(i)
        physics = animated ? dropped : dropped.dragging(i, to: dropped.point(i), reheat: true).dropped(i).settled()
        wake()
    }

    // MARK: Camera

    func zoom(by factor: CGFloat, at cursor: CGPoint, size: CGSize) {
        cameraTarget = nil
        camera = camera.zoomed(by: factor, at: cursor, in: size)
        readout.show(camera.zoom)
        wake()
    }

    func pan(by delta: CGSize, size: CGSize) {
        cameraTarget = nil
        camera = camera.panned(by: delta, in: size)
        wake()
    }

    func setPan(_ pan: CGSize, size: CGSize) {
        cameraTarget = nil
        camera = camera.withPan(pan, in: size)
        wake()
    }

    /// The outline zoom buttons: a short glide about the centre.
    func glideZoom(by factor: CGFloat, size: CGSize) {
        let target = (cameraTarget ?? camera).zoomed(by: factor, at: CGPoint(x: size.width / 2, y: size.height / 2), in: size)
        glide(to: target)
    }

    func glideHome() { glide(to: SkyCamera()) }

    private func glide(to target: SkyCamera) {
        if animated { cameraTarget = target } else { camera = target; cameraTarget = nil }
        readout.show(target.zoom)
        wake()
    }
}
