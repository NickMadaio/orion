# life-late-night

## Interface
`export function adjustForShortSleep(blocks, { sleptMinutes, wake, window }) -> { blocks, changes: string[] }`

## Decisions
- sleptMinutes >= 420 → unchanged, changes [].
- Otherwise: keep fixed blocks. Add one "rest" block titled "Nap" of 30 min (sleptMinutes < 300 → 45 min) in the first free gap after the first fixed block that ends after 12:00 (720); if none, the first free gap after 720.
- Movable study/side_project blocks starting before wake + 120 move to the latest free gaps that fit them (same length). If none fits, keep them and add "Could not move <title>".
- Every change is a sentence: "Added a 30 min nap at 13:00", "Moved <title> to 16:00". Times HH:MM.

## Tests (tests/life-after-late-night.test.mjs)
1. "a full night changes nothing" 2. "classes stay where they are" 3. "a nap follows the first class after noon" 4. "very short nights get a longer nap" 5. "early heavy work moves later" 6. "every change is reported".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
