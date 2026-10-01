# Task finish-early-ui — the "finished early" button (phone)

## Why
Nick: "i want an actual button. i press it and it lets orion know okay he just finished this, so lets rework the schedule. if i press it right after class … it should pop up with those two options … a smooth animation with the two options as symbols not text and it should be clean and smooth like the rest of the UI."
This task builds the self-contained control. Claude places it on the screens and connects it to `orion-reschedule early` afterwards.

## File you own
`native/OrionMobile/App/FinishEarly.swift` — EXISTS as a placeholder, already registered in the Xcode project. Replace its contents via `### EDIT` on the placeholder comment.

## Interface
```swift
enum FinishEarlyChoice: String, Equatable { case block, outOfClass = "out-of-class", home }
enum FinishEarlyContext: Equatable { case none, block(title: String), afterClass(classTitle: String) }
struct FinishEarlyButton: View {
    var context: FinishEarlyContext
    var onChoose: (FinishEarlyChoice) -> Void
}
```
## Behaviour
- `.none`: the button is shown disabled (dimmed, `Phone.dim`), label "Nothing under way".
- `.block`: one tap → `onChoose(.block)`, with a short confirmation: the icon (`checkmark.circle.fill`) morphs from `forward.end.fill` using `.contentTransition(.symbolEffect(.replace))` and a success haptic (`.sensoryFeedback(.success, trigger:)`), reverting after 1.5 s.
- `.afterClass`: one tap expands the button horizontally into two round symbol buttons side by side — `figure.walk.departure` (out of class early) and `house.fill` (already home) — with `matchedGeometryEffect` from the original button, `.spring(response: 0.35, dampingFraction: 0.85)`. No text on the two choices; each has an `accessibilityLabel` ("Out of class early", "Already home"). Tapping one calls `onChoose(.outOfClass)` / `onChoose(.home)` and collapses back with the same checkmark confirmation. Tapping the main symbol again, or 6 seconds of no choice, collapses without choosing.
- Look: a capsule 44 pt tall, `Color.white.opacity(0.06)` fill, `Phone.hairline` stroke, symbol in `Phone.accent`, label "Finished early" in 15 pt medium `Phone.text` beside the symbol. Choice buttons are 44 pt circles with the same material.
- Reduce Motion: no matched-geometry morph; cross-fade instead.
- Include a `#Preview` showing the three contexts.

## Check
`phone-build` must pass.
