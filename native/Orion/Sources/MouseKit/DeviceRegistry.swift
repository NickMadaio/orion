import Foundation

/// What IOHID tells us when a mouse attaches.
public struct AttachedMouse: Equatable {
    public var vendorId: Int
    public var productId: Int
    public var name: String
    public var transport: String
    public var buttonCount: Int
    public init(vendorId: Int, productId: Int, name: String, transport: String, buttonCount: Int) {
        self.vendorId = vendorId; self.productId = productId; self.name = name
        self.transport = transport; self.buttonCount = buttonCount
    }
    public var id: String { "\(vendorId):\(productId)" }
}

public enum DeviceRegistry {
    /// The Apple built-in trackpad is never a setup candidate.
    public static func isIgnored(_ m: AttachedMouse) -> Bool {
        let t = m.transport.lowercased(), n = m.name.lowercased()
        if t == "spi" || t == "built-in" || t == "builtin" || t == "fifo" { return true }
        let apple = m.vendorId == 1452 || m.vendorId == 76
        return apple && (n.contains("trackpad") || n.contains("internal"))
    }

    /// CGEvent button numbers 3... for every button past left/right/middle.
    public static func extraButtons(count: Int) -> [Int] {
        count > 3 ? Array(3..<count) : []
    }

    /// A never-seen device with more than three buttons is "new".
    public static func attached(_ m: AttachedMouse, into file: DevicesFile, now: String) -> DevicesFile {
        guard !isIgnored(m) else { return file }
        var next = file
        if let i = next.devices.firstIndex(where: { $0.id == m.id }) {
            var d = next.devices[i]
            d.lastSeen = now; d.connected = true; d.name = m.name; d.transport = m.transport
            if m.buttonCount > d.buttonCount { d.buttonCount = m.buttonCount; d.extraButtons = extraButtons(count: m.buttonCount) }
            next.devices[i] = d
        } else {
            let extras = extraButtons(count: m.buttonCount)
            next.devices.append(MouseDevice(id: m.id, name: m.name, vendorId: m.vendorId, productId: m.productId,
                transport: m.transport, buttonCount: m.buttonCount, extraButtons: extras, firstSeen: now,
                lastSeen: now, connected: true, setupState: extras.isEmpty ? .configured : .new))
        }
        return next
    }

    public static func detached(id: String, into file: DevicesFile, now: String) -> DevicesFile {
        var next = file
        guard let i = next.devices.firstIndex(where: { $0.id == id }) else { return file }
        next.devices[i].connected = false; next.devices[i].lastSeen = now
        return next
    }

    /// An observed press of a button the descriptor did not list widens extraButtons.
    public static func observed(button: Int, into file: DevicesFile) -> DevicesFile {
        guard button >= 3 else { return file }
        var next = file
        for i in next.devices.indices where next.devices[i].connected && !next.devices[i].extraButtons.contains(button) {
            next.devices[i].extraButtons = (next.devices[i].extraButtons + [button]).sorted()
        }
        return next
    }

    public static func setting(_ state: MouseSetupState, id: String, into file: DevicesFile) -> DevicesFile {
        var next = file
        guard let i = next.devices.firstIndex(where: { $0.id == id }) else { return file }
        next.devices[i].setupState = state
        return next
    }

    public static func askText(for d: MouseDevice) -> String {
        let n = max(d.extraButtons.count, 1)
        return "Is this a new mouse? Looks like a \(d.name) with \(n) extra button\(n == 1 ? "" : "s"). Want me to help set them up?"
    }
}
