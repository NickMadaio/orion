import AppKit

// Top-level entry point rather than `@main`, so the module has exactly one
// well-defined start and no attribute/top-level-code ambiguity.
//
// `.accessory` pairs with LSUIElement in Info.plist: no Dock icon, no menu bar
// takeover. Orion lives in the status bar and in a floating panel.
let orionApplication = NSApplication.shared
let orionDelegate = AppDelegate()
orionApplication.delegate = orionDelegate
orionApplication.setActivationPolicy(.accessory)
orionApplication.run()
