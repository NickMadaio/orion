import Foundation
import IOKit.hid
import MouseKit

/*
 Watches for mice attaching and detaching (IOHIDManager, GenericDesktop/Mouse). For each device it reads vendor,
 product, name, transport and the number of buttons from the HID descriptor's Button-page elements.
 Pure decisions (ignore the trackpad, "new" state, extra-button numbers) live in MouseKit's DeviceRegistry.
 Opened non-exclusively: it only listens for matching, never seizes input.
 */
final class MouseDeviceWatcher {
    var onAttach: ((AttachedMouse) -> Void)?
    var onDetach: ((String) -> Void)?

    private var manager: IOHIDManager?

    func start() {
        guard manager == nil else { return }
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        let match: [String: Int] = [kIOHIDDeviceUsagePageKey: Int(kHIDPage_GenericDesktop), kIOHIDDeviceUsageKey: Int(kHIDUsage_GD_Mouse)]
        IOHIDManagerSetDeviceMatching(manager, match as CFDictionary)
        let context = Unmanaged.passUnretained(self).toOpaque()
        IOHIDManagerRegisterDeviceMatchingCallback(manager, { context, _, _, device in
            guard let context else { return }
            Unmanaged<MouseDeviceWatcher>.fromOpaque(context).takeUnretainedValue().attached(device)
        }, context)
        IOHIDManagerRegisterDeviceRemovalCallback(manager, { context, _, _, device in
            guard let context else { return }
            Unmanaged<MouseDeviceWatcher>.fromOpaque(context).takeUnretainedValue().detached(device)
        }, context)
        IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        let result = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
        if result != kIOReturnSuccess { OrionLog.write("[mouse] IOHIDManagerOpen returned \(result)") }
        self.manager = manager
    }

    func stop() {
        guard let manager else { return }
        IOHIDManagerUnscheduleFromRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        IOHIDManagerClose(manager, IOOptionBits(kIOHIDOptionsTypeNone))
        self.manager = nil
    }

    private func attached(_ device: IOHIDDevice) {
        guard let mouse = Self.describe(device) else { return }
        onAttach?(mouse)
    }

    private func detached(_ device: IOHIDDevice) {
        guard let mouse = Self.describe(device) else { return }
        onDetach?(mouse.id)
    }

    private static func intProperty(_ device: IOHIDDevice, _ key: String) -> Int? {
        IOHIDDeviceGetProperty(device, key as CFString) as? Int
    }

    private static func describe(_ device: IOHIDDevice) -> AttachedMouse? {
        guard let vendor = intProperty(device, kIOHIDVendorIDKey), let product = intProperty(device, kIOHIDProductIDKey) else { return nil }
        let name = (IOHIDDeviceGetProperty(device, kIOHIDProductKey as CFString) as? String) ?? "Mouse"
        let transport = (IOHIDDeviceGetProperty(device, kIOHIDTransportKey as CFString) as? String) ?? "USB"
        return AttachedMouse(vendorId: vendor, productId: product, name: name, transport: transport,
                             buttonCount: buttonCount(device))
    }

    /// The highest Button-page usage among the device's elements (usages are 1-based: 1 is the left button).
    static func buttonCount(_ device: IOHIDDevice) -> Int {
        let match: [String: Int] = [kIOHIDElementUsagePageKey: Int(kHIDPage_Button)]
        guard let elements = IOHIDDeviceCopyMatchingElements(device, match as CFDictionary, IOOptionBits(kIOHIDOptionsTypeNone)) as? [IOHIDElement] else { return 0 }
        return elements.map { Int(IOHIDElementGetUsage($0)) }.max() ?? 0
    }
}
