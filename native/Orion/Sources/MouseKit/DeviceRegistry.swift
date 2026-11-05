import Foundation

/// What IOHID tells us when a mouse attaches.
public struct AttachedMouse: Equatable {
    public var vendorId: Int
    public var productId: Int
    public var name: String
    public var transport: String
    public var buttonCount: Int
    /// The same device also shows up as a keyboard (a mouse whose onboard memory sends a key, such as F13).
    public var keyboardInterface: Bool
    public init(vendorId: Int, productId: Int, name: String, transport: String, buttonCount: Int, keyboardInterface: Bool = false) {
        self.vendorId = vendorId; self.productId = productId; self.name = name
        self.transport = transport; self.buttonCount = buttonCount; self.keyboardInterface = keyboardInterface
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

    /// What the device offers now: the descriptor's buttons, the top button when it also acts as a keyboard, and anything
    /// already learned (a press seen beyond the descriptor, a key button) that the descriptor still does not explain.
    static func extras(for m: AttachedMouse, previous: [Int], previousCount: Int = 0) -> [Int] {
        let fromDescriptor = extraButtons(count: m.buttonCount)
        let keys = m.keyboardInterface || MouseFamily.hasTopButton(MouseFamily.key(name: m.name)) ? [KeyButtons.defaultId] : []
        let learned = previous.filter { $0 >= max(previousCount, m.buttonCount) && !KeyButtons.isKeyButton($0) }
        let kept = previous.filter { KeyButtons.isKeyButton($0) && $0 != KeyButtons.defaultId }
        return Array(Set(fromDescriptor + keys + learned + kept)).sorted()
    }

    /// Key buttons the connected mice send; the remapper only treats these keys as buttons.
    public static func activeKeyButtons(in file: DevicesFile) -> Set<Int> {
        Set(file.devices.filter(\.connected).flatMap(\.extraButtons).filter(KeyButtons.isKeyButton))
    }

    /// A never-seen device with more than three buttons is "new".
    public static func attached(_ m: AttachedMouse, into file: DevicesFile, now: String) -> DevicesFile {
        guard !isIgnored(m) else { return file }
        var next = file
        if let i = next.devices.firstIndex(where: { $0.id == m.id }) {
            var d = next.devices[i]
            d.lastSeen = now; d.connected = true; d.name = m.name; d.transport = m.transport
            let previousCount = d.buttonCount
            d.buttonCount = m.buttonCount
            d.extraButtons = extras(for: m, previous: d.extraButtons, previousCount: previousCount)
            next.devices[i] = d
        } else {
            let extras = Self.extras(for: m, previous: [])
            next.devices.append(MouseDevice(id: m.id, name: m.name, vendorId: m.vendorId, productId: m.productId,
                transport: m.transport, buttonCount: m.buttonCount, extraButtons: extras, firstSeen: now,
                lastSeen: now, connected: true, setupState: extras.isEmpty ? .configured : .new))
        }
        return harmonized(next)
    }

    /// Entries of one mouse (same family) share their buttons, and a family with a top button always lists it.
    public static func harmonized(_ file: DevicesFile) -> DevicesFile {
        var next = file
        let families = Dictionary(grouping: next.devices.indices, by: { MouseFamily.key(name: next.devices[$0].name) })
        for (family, indices) in families {
            var all = Set(indices.flatMap { next.devices[$0].extraButtons })
            if MouseFamily.hasTopButton(family) { all.insert(KeyButtons.defaultId) }
            let merged = all.sorted()
            for i in indices where next.devices[i].extraButtons != merged { next.devices[i].extraButtons = merged }
        }
        return next
    }

    /// At launch no mouse is known to be connected until the watcher says so (a stale flag would keep a gone mouse's keys live).
    public static func allDisconnected(_ file: DevicesFile) -> DevicesFile {
        var next = file
        for i in next.devices.indices { next.devices[i].connected = false }
        return next
    }

    /// A button captured by "Add a button": saved on the connected mouse (or the last one seen), then shared across its family.
    public static func learned(button: Int, into file: DevicesFile) -> DevicesFile {
        var next = file
        var targets = next.devices.indices.filter { next.devices[$0].connected }
        if targets.isEmpty, !next.devices.isEmpty { targets = [next.devices.count - 1] }
        for i in targets where !next.devices[i].extraButtons.contains(button) {
            next.devices[i].extraButtons = (next.devices[i].extraButtons + [button]).sorted()
        }
        return harmonized(next)
    }

    public struct SetupModel: Equatable {
        public var name: String?
        public var buttons: [Int]
    }

    /// What the popup shows: one mouse (the connected one's family), its fullest name, every button of the family plus saved bindings.
    public static func setupModel(_ file: DevicesFile, saved: [Int]) -> SetupModel {
        guard let primary = file.devices.first(where: \.connected) ?? file.devices.first else {
            return SetupModel(name: nil, buttons: Array(Set(saved)).sorted())
        }
        let family = MouseFamily.key(name: primary.name)
        let members = file.devices.filter { MouseFamily.key(name: $0.name) == family }
        let buttons = Set(members.flatMap(\.extraButtons)).union(saved)
        return SetupModel(name: MouseFamily.displayName(members.map(\.name)), buttons: buttons.sorted())
    }

    public static func detached(id: String, into file: DevicesFile, now: String) -> DevicesFile {
        var next = file
        guard let i = next.devices.firstIndex(where: { $0.id == id }) else { return file }
        next.devices[i].connected = false; next.devices[i].lastSeen = now
        return next
    }

    /// An observed press of a button the descriptor did not list widens extraButtons.
    public static func observed(button: Int, into file: DevicesFile) -> DevicesFile {
        guard button >= 3, !KeyButtons.isKeyButton(button) else { return file }
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
