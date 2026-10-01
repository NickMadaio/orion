# Task summon-composer — type back to the floating ORION (Mac)

## Why
When the main window is closed, ORION appears as a floating hologram panel (`PanelController.swift`, `PanelView.swift`). If he says Nick is off task, Nick must be able to answer — by voice or by typing ("I'm on task, I'm reading docs for the lab"). Nick asked for: a small × to close, a mute to mute himself, and a small text box that grows as he types. This task builds the control as a standalone view; Claude puts it in the panel (that panel has delicate focus and hit-testing rules).

## File
`native/OrionMobile/Sources/OrionViews/SummonComposer.swift` (new). Module `OrionViews` (SwiftUI, macOS 14 + iOS 17; may import SwiftUI, MobileCore, ThinkingOrbsKit). The Mac app's own folder is closed to this loop, so the view lives here and Claude links it into the Mac app. Do not edit any existing file.

## Interface
```swift
public struct SummonComposer: View {
    public init(text: Binding<String>, micMuted: Bool, onSend: @escaping () -> Void, onToggleMute: @escaping () -> Void, onClose: @escaping () -> Void, width: CGFloat = 260)
    @Binding var text: String
    var micMuted: Bool
    var onSend: () -> Void
    var onToggleMute: () -> Void
    var onClose: () -> Void
    var width: CGFloat = 260
}
```
## Behaviour and look
- One row: × button (`xmark`, 22 pt circle), the text field, mute button (`mic.fill` / `mic.slash.fill`, 22 pt circle; tinted red-orange when muted).
- Field: `TextField("Reply to ORION", text: $text, axis: .vertical)`, `lineLimit(1...4)`, font 13, grows upward as lines are added (the view is bottom-aligned), `onSubmit(onSend)`; Return sends, Shift-Return inserts a newline (use `.onKeyPress(.return, phases: .down)` checking `modifiers.contains(.shift)`).
- A send arrow appears inside the field's trailing edge only when the trimmed text is non-empty (scale+opacity transition).
- Material: `.ultraThinMaterial` capsule-ish shape (corner radius 16), 1 pt `Color.white.opacity(0.12)` stroke, subtle shadow; colours from `ViewTokens` (OrionViews/OrionViews.swift).
- Escape calls `onClose` (`.onKeyPress(.escape)`).
- Every icon button has an `accessibilityLabel` ("Close", "Mute microphone"/"Unmute microphone", "Send").
- `#Preview` with an empty and a multi-line state.

## Check
`mobile-swift-tests` must pass (it builds OrionViews for macOS). Use only APIs available on both macOS 14 and iOS 17, or guard with `#if os(macOS)`.
