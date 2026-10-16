import CoreBluetooth
import Foundation

/*
 Nick's LED strip (2026-10-08): "my main strip light is run by an app called
 lotus lamp X". Those strips are Bluetooth LE controllers (advertised as
 ELK-BLEDOM, MELK, LEDBLE…) that take short fixed commands on one writable
 characteristic (service FFF0 / FFE0). This is that, from the Mac, so the
 morning briefing can turn the light on and ORION can do it when asked.

 Driven by `orion://lights?…` (scripts/orion-lights): scan, on, off,
 brightness 0–100, color RRGGBB. The result goes to
 ~/.openclaw/orion-controlled/lights-status.json for the script to read. The
 strip takes one connection at a time: while Lotus Lamp X on the phone is
 connected, the Mac cannot reach it.
*/
final class StripLight: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let shared = StripLight()

    enum Command: Equatable {
        case scan, on, off
        case brightness(Int)
        case color(UInt8, UInt8, UInt8)
    }

    private static let services = [CBUUID(string: "FFF0"), CBUUID(string: "FFE0")]
    private static let names = #"(?i)^(elk|melk|ledble|bledom|lotus|led|triones|qhm|duoco)"#
    private static let savedKey = "orion.strip.peripheral"

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var writer: CBCharacteristic?
    private var pending: [Command] = []
    private var found: [String: [String: Any]] = [:]
    private var deadline: DispatchWorkItem?

    /// Bytes for one command. Power is sent in both of the family's two dialects
    /// (ELK-BLEDOM "7E 00 04…" and MELK "7E 04 04…"); a strip ignores the other.
    static func packets(_ command: Command) -> [[UInt8]] {
        switch command {
        case .scan: return []
        case .on: return [[0x7E, 0x00, 0x04, 0xF0, 0x00, 0x01, 0xFF, 0x00, 0xEF], [0x7E, 0x04, 0x04, 0xF0, 0x00, 0x01, 0xFF, 0x00, 0xEF]]
        case .off: return [[0x7E, 0x00, 0x04, 0x00, 0x00, 0x00, 0xFF, 0x00, 0xEF], [0x7E, 0x04, 0x04, 0x00, 0x00, 0x00, 0xFF, 0x00, 0xEF]]
        case .brightness(let level): return [[0x7E, 0x00, 0x01, UInt8(max(0, min(100, level))), 0x00, 0x00, 0x00, 0x00, 0xEF]]
        case let .color(r, g, b): return [[0x7E, 0x00, 0x05, 0x03, r, g, b, 0x00, 0xEF]]
        }
    }

    /// `orion://lights?do=on|off|scan&brightness=80&color=ffb070`
    static func commands(from url: URL) -> [Command] {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        var list: [Command] = []
        switch value("do") {
        case "scan": return [.scan]
        case "on": list.append(.on)
        case "off": return [.off]
        default: break
        }
        if let hex = value("color"), hex.count == 6, let rgb = UInt32(hex, radix: 16) {
            list.append(.color(UInt8(rgb >> 16 & 0xFF), UInt8(rgb >> 8 & 0xFF), UInt8(rgb & 0xFF)))
        }
        if let text = value("brightness"), let level = Int(text) { list.append(.brightness(level)) }
        return list
    }

    func run(_ commands: [Command]) {
        guard !commands.isEmpty else { return report(ok: false, "nothing to do") }
        pending = commands
        found = [:]
        if central == nil {
            central = CBCentralManager(delegate: self, queue: .main)   // asks for Bluetooth the first time
        } else {
            start()
        }
        deadline?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.timeOut() }
        deadline = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (commands == [.scan] ? 10 : 15), execute: work)
    }

    private func start() {
        guard let central, central.state == .poweredOn else { return }
        if pending != [.scan], let peripheral, peripheral.state == .connected, writer != nil { return send() }
        if pending != [.scan], let saved = UserDefaults.standard.string(forKey: Self.savedKey).flatMap(UUID.init(uuidString:)),
           let known = central.retrievePeripherals(withIdentifiers: [saved]).first {
            connect(known)
            return
        }
        central.scanForPeripherals(withServices: nil, options: nil)
    }

    private func connect(_ target: CBPeripheral) {
        central?.stopScan()
        peripheral = target
        target.delegate = self
        central?.connect(target)
    }

    private func send() {
        guard let peripheral, let writer else { return }
        let type: CBCharacteristicWriteType = writer.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
        for packet in pending.flatMap(Self.packets) { peripheral.writeValue(Data(packet), for: writer, type: type) }
        let did = pending.map { "\($0)" }.joined(separator: ", ")
        pending = []
        report(ok: true, "sent to \(peripheral.name ?? "the strip"): \(did)")
    }

    private func timeOut() {
        central?.stopScan()
        if pending == [.scan] {
            pending = []
            return report(ok: !found.isEmpty, found.isEmpty ? "no strip found nearby" : "found \(found.count)", extra: ["devices": Array(found.values)])
        }
        guard !pending.isEmpty else { return }
        pending = []
        report(ok: false, peripheral == nil
               ? "couldn't find the strip — is it powered, and is Lotus Lamp X on the phone closed?"
               : "couldn't connect — close Lotus Lamp X on the phone (the strip takes one connection)")
    }

    private func report(ok: Bool, _ message: String, extra: [String: Any] = [:]) {
        deadline?.cancel()
        // 2026-10-16 UI audit #7: "failed - Bluetooth is off" x65. Log on change.
        OrionLog.write("[lights] \(ok ? "ok" : "failed") — \(message)", key: "lights")
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/lights-status.json")
        var body: [String: Any] = ["at": ISO8601DateFormatter().string(from: Date()), "ok": ok, "message": message]
        extra.forEach { body[$0.key] = $0.value }
        if let data = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted]) { try? data.write(to: file) }
    }

    // MARK: CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn: start()
        case .unauthorized: pending = []; report(ok: false, "ORION isn't allowed to use Bluetooth (System Settings ▸ Privacy & Security ▸ Bluetooth)")
        case .poweredOff: pending = []; report(ok: false, "Bluetooth is off on this Mac")
        default: break
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        let name = peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? ""
        let uuids = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []
        let looksLikeStrip = name.range(of: Self.names, options: .regularExpression) != nil || uuids.contains { Self.services.contains($0) }
        guard looksLikeStrip else { return }
        found[peripheral.identifier.uuidString] = ["name": name, "id": peripheral.identifier.uuidString, "rssi": rssi.intValue]
        if pending != [.scan] { connect(peripheral) }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices(Self.services)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        self.peripheral = nil
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        writer = nil
    }

    // MARK: CBPeripheralDelegate

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        for service in peripheral.services ?? [] { peripheral.discoverCharacteristics(nil, for: service) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard writer == nil, let target = service.characteristics?.first(where: {
            $0.properties.contains(.write) || $0.properties.contains(.writeWithoutResponse)
        }) else { return }
        writer = target
        UserDefaults.standard.set(peripheral.identifier.uuidString, forKey: Self.savedKey)
        send()
    }
}
