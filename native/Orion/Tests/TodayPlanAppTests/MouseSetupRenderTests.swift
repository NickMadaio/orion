import AppKit
import MouseKit
import SwiftUI
import XCTest
@testable import Orion

/// Renders the mouse setup popup. Writes PNGs only when ORION_UI_RENDER_DIR is set.
@MainActor
final class MouseSetupRenderTests: XCTestCase {
    private func controller() throws -> MouseController {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("mouse-render-\(UUID().uuidString)")
        let store = MouseStore(controlledDir: dir)
        let mouse = AttachedMouse(vendorId: 5426, productId: 153, name: "Razer Basilisk V3", transport: "USB", buttonCount: 6)
        try store.updateDevices { DeviceRegistry.attached(mouse, into: $0, now: "2026-11-03T00:00:00Z") }
        let model = MouseController(store: store)
        model.reload()
        return model
    }

    func testRendersSetupPopupWithSuggestionsAndAGlowingRow() throws {
        let model = try controller()
        model.highlight(4)
        let view = MouseSetupView(mouse: model, onDone: {}, onNotNow: {})
            .padding(24)
            .background(UIRender.wallpaper(light: false))
            .environment(\.orionFrozenMotion, 1)
        let image = try UIRender.write("popup-toggle", view, size: CGSize(width: 440, height: 1060))
        XCTAssertGreaterThan(image.width, 0)
    }

    func testSetupRowsComeFromTheDevice() throws {
        let model = try controller()
        XCTAssertEqual(model.devices.devices.first?.extraButtons, [3, 4, 5])
        XCTAssertEqual(MouseSetupPlan.effective(4, in: model.bindings), .system("stageManager"))
    }
}
