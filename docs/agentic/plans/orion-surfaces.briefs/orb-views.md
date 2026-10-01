# Task orb-views — the ORION orb on the phone and the Mac

## Why
Nick wants Jakub Antalik's thinking orbs (vendored as `ThinkingOrbsKit`, MIT) combined with ORION's hologram, on the phone when ORION speaks and on the Mac. This task builds the phone view; Claude places them and tunes the look afterwards.

## Files
- `native/OrionMobile/App/PhoneOrb.swift` — EXISTS as a placeholder (only imports and a comment) and is already registered in the Xcode project. Replace its contents with `### EDIT` (search the placeholder comment).

## Phone — `PhoneOrb.swift`
```swift
enum OrbMood: Equatable { case idle, listening, thinking, speaking, working }
struct PhoneOrb: View {
    var mood: OrbMood
    var level: Float = 0          // 0...1 microphone or speech level
    var size: CGFloat = 64
}
```
- Map: idle → `.breathing`, listening → `.listening`, thinking → `.solving`, speaking → `.composing`, working → `.working`. `theme: .dark`, `displaySize: Double(size)`.
- Audio-reactive: scale `1 + 0.12 * CGFloat(min(max(level, 0), 1))` with `.animation(.easeOut(duration: 0.12), value: level)`; and a soft glow behind it: a `Circle()` filled with `Phone.violet.opacity(0.18 + 0.25 * level)` blurred 18, sized 1.4× — glow and scale only when mood is listening or speaking.
- Mood changes cross-fade: `.animation(.spring(response: 0.35, dampingFraction: 0.85), value: mood)`.
- Reduce Motion: pass `paused: true` and no scaling.
- `accessibilityLabel("ORION, \(text for mood)")`.
- Add `extension OrbMood { init(voice: PhoneVoice.Phase, waitingForReply: Bool) }`: listening → listening; sending or waiting → thinking; speaking → speaking; off/unavailable → `waitingForReply ? .thinking : .idle`.

## Mac
Not in this task: the Mac app's folder is closed to this loop; Claude blends the orb into the Mac hologram.

## Check
`phone-build` must pass.
