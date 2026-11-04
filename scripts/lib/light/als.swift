// orion-light's helper: one JSON line about the room, from the Mac itself. No camera, no microphone, no permission prompt.
//   {"als":{"service":true,"event":true,"lux":123.4},"display":{"brightness":0.62},"lidClosed":false}
// als: the ambient light sensor, an AppleSPUHIDDevice (HID usage page 0xff00, usage 4) on Apple Silicon, read through the IOHIDEventSystem
//      client (event type 12, field 12<<16). lux is null when the service or its event is missing; it is never guessed.
// display: DisplayServices' brightness of the built-in panel (0...1), null when unreadable. With auto-brightness on it follows the room.
// lidClosed: the clamshell state. A closed lid covers the sensor, so a 0 then means nothing.
// Compile once: swiftc -O als.swift -o orion-als   (orion-light does this and caches the binary by source hash)
import Foundation
import IOKit
import CoreGraphics

typealias CreateF = @convention(c) (CFAllocator?) -> Unmanaged<CFTypeRef>?
typealias SetMatchF = @convention(c) (CFTypeRef, CFDictionary) -> Void
typealias CopySvcF = @convention(c) (CFTypeRef) -> Unmanaged<CFArray>?
typealias CopyEvF = @convention(c) (CFTypeRef, Int64, Int32, Int64) -> Unmanaged<CFTypeRef>?
typealias GetFloatF = @convention(c) (CFTypeRef, UInt32) -> Double
typealias SetPropF = @convention(c) (CFTypeRef, CFString, CFTypeRef) -> Bool
typealias BrightF = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32

func symbol<T>(_ handle: UnsafeMutableRawPointer?, _ name: String, _ type: T.Type) -> T? {
    guard let handle, let p = dlsym(handle, name) else { return nil }
    return unsafeBitCast(p, to: type)
}

func readALS() -> (service: Bool, event: Bool, lux: Double?) {
    let h = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_NOW)
    guard let create = symbol(h, "IOHIDEventSystemClientCreate", CreateF.self),
          let setMatch = symbol(h, "IOHIDEventSystemClientSetMatching", SetMatchF.self),
          let copySvc = symbol(h, "IOHIDEventSystemClientCopyServices", CopySvcF.self),
          let copyEv = symbol(h, "IOHIDServiceClientCopyEvent", CopyEvF.self),
          let getF = symbol(h, "IOHIDEventGetFloatValue", GetFloatF.self),
          let setProp = symbol(h, "IOHIDServiceClientSetProperty", SetPropF.self),
          let client = create(kCFAllocatorDefault)?.takeRetainedValue() else { return (false, false, nil) }
    setMatch(client, ["PrimaryUsagePage": 65280, "PrimaryUsage": 4] as CFDictionary)
    let services = copySvc(client)?.takeRetainedValue() as? [CFTypeRef] ?? []
    guard let service = services.first else { return (false, false, nil) }
    _ = setProp(service, "ReportInterval" as CFString, 1_000_000 as CFNumber)
    for _ in 0..<8 {
        Thread.sleep(forTimeInterval: 0.25)
        if let ev = copyEv(service, 12, 0, 0)?.takeRetainedValue() {
            return (true, true, getF(ev, UInt32(12 << 16)))
        }
    }
    return (true, false, nil)
}

func readBrightness() -> Double? {
    let h = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_NOW)
    guard let get = symbol(h, "DisplayServicesGetBrightness", BrightF.self) else { return nil }
    var value: Float = 0
    return get(CGMainDisplayID(), &value) == 0 ? Double(value) : nil
}

func lidClosed() -> Bool {
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
    guard service != 0 else { return false }
    defer { IOObjectRelease(service) }
    let value = IORegistryEntryCreateCFProperty(service, "AppleClamshellState" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
    return (value as? Bool) ?? false
}

let als = readALS()
let json: [String: Any] = [
    "als": ["service": als.service, "event": als.event, "lux": als.lux as Any? ?? NSNull()],
    "display": ["brightness": readBrightness() as Any? ?? NSNull()],
    "lidClosed": lidClosed(),
]
if let data = try? JSONSerialization.data(withJSONObject: json), let text = String(data: data, encoding: .utf8) { print(text) }
