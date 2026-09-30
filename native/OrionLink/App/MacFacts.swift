import AppKit
import IOKit
import IOKit.ps
import LinkCore

/// What the Mac itself can say about its hardware, read fresh each time.
/// Anything unreadable is nil, never zero.
enum MacFacts {
    static func snapshotMac(locked: Bool) -> LinkSnapshot.Mac {
        let power = battery()
        return LinkSnapshot.Mac(
            name: Host.current().localizedName ?? "Mac",
            battery: power.percent, charging: power.charging,
            diskFreeGB: diskFreeGB(), uptimeHours: Int(ProcessInfo.processInfo.systemUptime / 3600),
            runningApps: runningApps(), locked: locked)
    }

    /// When the keyboard or mouse was last used: the HID system's idle time.
    static func lastInput(now: Date = Date()) -> Date? {
        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOHIDSystem"), &iterator) == KERN_SUCCESS else { return nil }
        defer { IOObjectRelease(iterator) }
        let entry = IOIteratorNext(iterator)
        guard entry != 0 else { return nil }
        defer { IOObjectRelease(entry) }
        guard let idle = IORegistryEntryCreateCFProperty(entry, "HIDIdleTime" as CFString, kCFAllocatorDefault, 0)?
            .takeRetainedValue() as? NSNumber else { return nil }
        return now.addingTimeInterval(-idle.doubleValue / 1_000_000_000)
    }

    static func battery() -> (percent: Int?, charging: Bool?) {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return (nil, nil) }
        for source in list {
            guard let description = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any],
                  let current = description[kIOPSCurrentCapacityKey] as? Int,
                  let max = description[kIOPSMaxCapacityKey] as? Int, max > 0 else { continue }
            let onAC = (description[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue
            return (Int((Double(current) / Double(max) * 100).rounded()), onAC)
        }
        return (nil, nil)
    }

    static func diskFreeGB() -> Int? {
        let values = try? URL(fileURLWithPath: "/").resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage.map { Int($0 / 1_000_000_000) }
    }

    static func runningApps() -> [String] {
        NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular }
            .compactMap(\.localizedName).sorted().prefix(20).map { $0 }
    }
}
