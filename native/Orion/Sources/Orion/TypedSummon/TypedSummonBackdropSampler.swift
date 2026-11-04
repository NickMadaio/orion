import AppKit
import CoreGraphics
import ScreenCaptureKit

/*
 What is behind the typed summon, as one luminance number (0 black ... 1 white), or nil when it cannot be known.

 With Screen Recording already granted (never requested here) the region is grabbed with ScreenCaptureKit, excluding
 the overlay's own window. Without it: if a normal app window covers the region the wallpaper is hidden and the answer
 is unknown (nil, so the theme assumes the worst case); with the bare desktop showing, the wallpaper's luminance is used.
*/
enum TypedSummonBackdropSampler {
    /// `region` is in the screen's top-left-origin points. `excluding` is the overlay's window number.
    static func luminance(on screen: NSScreen, region: CGRect, excluding windowNumber: Int) async -> Double? {
        if CGPreflightScreenCaptureAccess() {
            return await captured(on: screen, region: region, excluding: windowNumber)
        }
        return desktopOnly(screen: screen, region: region, excluding: windowNumber) ? wallpaper(of: screen) : nil
    }

    // MARK: Screen Recording granted

    private static func captured(on screen: NSScreen, region: CGRect, excluding windowNumber: Int) async -> Double? {
        guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID,
              let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true),
              let display = content.displays.first(where: { $0.displayID == id }) else { return nil }
        let own = content.windows.filter { Int($0.windowID) == windowNumber }
        let config = SCStreamConfiguration()
        config.sourceRect = region
        config.width = 64
        config.height = max(8, Int(64 * region.height / max(region.width, 1)))
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        let filter = SCContentFilter(display: display, excludingWindows: own)
        guard let image = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) else { return nil }
        return luminance(of: image)
    }

    // MARK: Fallback

    /// True when no ordinary window (layer 0, on screen, not ours) overlaps the region.
    private static func desktopOnly(screen: NSScreen, region: CGRect, excluding windowNumber: Int) -> Bool {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return false }
        let global = region.offsetBy(dx: screen.frame.minX, dy: 0)
        return !list.contains { info in
            guard (info[kCGWindowLayer as String] as? Int) == 0, (info[kCGWindowNumber as String] as? Int) != windowNumber,
                  let bounds = info[kCGWindowBounds as String] as? [String: CGFloat],
                  let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }
            return rect.intersects(global)
        }
    }

    private static func wallpaper(of screen: NSScreen) -> Double? {
        guard let url = NSWorkspace.shared.desktopImageURL(for: screen), let source = NSImage(contentsOf: url),
              let cg = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        return luminance(of: cg)
    }

    private static func luminance(of image: CGImage) -> Double? {
        let width = 32, height = 32
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return false }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? TypedSummonLegibility.averageLuminance(bgra: pixels) : nil
    }
}
