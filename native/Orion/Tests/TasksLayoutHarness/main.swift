import AppKit
import SwiftUI
import SessionService

let environment = ProcessInfo.processInfo.environment
let output = URL(fileURLWithPath: environment["ORION_TASKS_RENDER_OUTPUT"]
                 ?? "/private/tmp/orion-tasks-layout.png")
let scratch = URL(fileURLWithPath: "/private/tmp/orion-tasks-layout-harness", isDirectory: true)

try? FileManager.default.removeItem(at: scratch)
try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)

let reminders = AppleRemindersSync()
let agenda = AppleCalendarSync()
let health = HealthLog()
let history = SessionHistory(url: scratch.appendingPathComponent("history.jsonl"))
let calendar = CalendarModel(agenda: agenda, reminders: reminders,
                             history: history, health: health)

let windowSize = CGSize(width: 1_228, height: 768)
let horizontalPadding: CGFloat = 46
let verticalChrome: CGFloat = 86
let usableWidth = windowSize.width - horizontalPadding * 2

let view = ZStack(alignment: .topLeading) {
    OrionTheme.ink
    TasksTab(
        reminders: reminders,
        agenda: agenda,
        newTask: .constant(""),
        dayProgress: 0.4,
        hoursLeft: 13,
        energyTitle: "Morning setup",
        availableHeight: windowSize.height - verticalChrome,
        availableWidth: usableWidth,
        calendar: calendar,
        todayPlan: TodayPlanModel(store: TodayPlanStore(url: scratch.appendingPathComponent("today-plan.json"))),
        refreshPlanSources: {}
    )
    .padding(.horizontal, horizontalPadding)
    .padding(.top, 26)
}
.frame(width: windowSize.width, height: windowSize.height, alignment: .topLeading)

let hosting = NSHostingView(rootView: view)
hosting.frame = CGRect(origin: .zero, size: windowSize)
let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless],
                      backing: .buffered, defer: false)
window.contentView = hosting

for _ in 0..<20 {
    hosting.layoutSubtreeIfNeeded()
    RunLoop.main.run(until: Date().addingTimeInterval(0.025))
}

guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
    fputs("tasks layout render did not produce a bitmap\n", stderr)
    exit(1)
}
hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("tasks layout render could not encode PNG\n", stderr)
    exit(1)
}
try png.write(to: output, options: .atomic)

let usable = usableWidth - 28
let calendarFloor = min(640, max(360, usable * 0.48))
let desiredLeft = min(820, max(480, usable * 0.43))
let left = max(0, min(desiredLeft, usable - calendarFloor))
let right = usable - left

guard left >= 470, right >= 600, abs((left + 28 + right) - usableWidth) < 0.5 else {
    fputs("tasks split did not fill the usable width\n", stderr)
    exit(1)
}

print(String(format: "PASS: %.0fpt task column + 28pt gap + %.0fpt calendar = %.0fpt usable width",
             left, right, usableWidth))
print("Rendered \(output.path) (\(png.count) bytes)")
