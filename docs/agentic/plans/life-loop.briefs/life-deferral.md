# life-deferral

## Interface
`export function classifyDeferral(text, context = {}) -> { kind, minutes, confidence }`
kind: "pause" (legitimate short delay), "change" (reality changed the plan), "avoidance", "unclear". context.deferralsToday (int), context.minutesAvoided (int).

## Decisions
- pause keywords → minutes: eat/hungry/starving/food/lunch/dinner → 25; shower → 20; bathroom/toilet → 5; call/phone call → 15; laundry → 10.
- change keywords: friend/friends/invited/hang out, class ran late/running late, sick/ill/headache, exhausted/can't keep eyes open, emergency → minutes 0.
- avoidance phrases: "in a bit", "later", "5 more minutes", "one more video", "not now", "tomorrow" → minutes 15.
- Otherwise "unclear", minutes 10, confidence 0.3.
- confidence: 0.8 for a keyword match; minus 0.2 when deferralsToday >= 2 (min 0.2). If minutesAvoided >= 60, a "pause" becomes "avoidance" only if deferralsToday >= 2.
- Case-insensitive, whole-word matching.

## Tests (tests/life-deferral.test.mjs)
1. "starving is a 25 minute pause" 2. "a friend inviting me is a change" 3. "one more video is avoidance" 4. "repeated pauses lose confidence" 5. "an hour of dodging turns pauses into avoidance" 6. "unknown reasons are unclear".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
