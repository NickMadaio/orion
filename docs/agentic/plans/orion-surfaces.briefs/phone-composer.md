# Task phone-composer — a cleaner chat box on the phone

## Why
Nick: the phone's text box "is clunky and if i click on it getting out of it is bad too. its a little big". Today (`native/OrionMobile/App/ConversationView.swift`, 206 lines) the field has 16/11 pt padding inside a 20 pt rounded rectangle, 40 pt round buttons, grows to 5 lines, and the keyboard only goes away by dragging the conversation. The send button already appears only when there is text (otherwise the talk button) — keep that.

## File you own
`native/OrionMobile/App/ConversationView.swift` (EDIT only). Uses `PhoneOrb`/`OrbMood` from task orb-views (`App/PhoneOrb.swift`).

## Changes
1. Tap anywhere on the conversation to dismiss the keyboard: `.onTapGesture { typing = false }` on the ScrollView content, which must not swallow taps on the suggestion buttons or text selection (put it on the background: `.background(Color.clear.contentShape(Rectangle()).onTapGesture { typing = false })`).
2. While typing, a small chevron-down button (`Image(systemName: "chevron.down")`, 28 pt hit area, `Phone.dim`, label "Hide keyboard") appears at the leading edge of the bar, sliding in with `.transition(.move(edge: .leading).combined(with: .opacity))`.
3. Slimmer field: `lineLimit(1...4)`, font 15, padding horizontal 14 / vertical 8, corner radius 18, background `Color.white.opacity(0.06)` plus a 1 pt `Phone.hairline` stroke that becomes `Phone.accent.opacity(0.5)` while focused (animated).
4. Buttons 34 pt (icons 14 pt bold); bar padding horizontal 14, vertical 8.
5. The orb: at the top of the conversation, replace the plain header's empty space with a centred `PhoneOrb(mood: OrbMood(voice: voice.phase, waitingForReply: waiting), level: voice.level, size: 56)`, where `waiting` is true while any message is `.pending` or `.running`. Keep `PhoneHeader` above it.
6. In `reply(_:)` for pending/running, replace `PhoneThinkingDots()` with `PhoneOrb(mood: .thinking, size: 20)` (keep `PhoneThinkingDots` defined; other screens may use it).
7. Everything else (message rendering, voice bar, send logic) unchanged.

## Check
`phone-build` must pass.
