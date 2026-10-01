# Task focus-escalation — when ORION steps in (pure)

## Why
Focus mode should run on its own from Nick's schedule: the block on his calendar says what he SHOULD be doing; the Mac and phone say what he IS doing. This module decides the next step. It never acts; the CLI (task focus-cli) and the app act on its answer.

## Interface — `scripts/lib/focus/escalation.mjs`
```
export const MAC_STEPS = ["none", "nudge", "say", "front", "quit", "lock"];
export function focusBlock(blocks, now)            → block | null
export function judgeActivity(block, activity, { allow = [] } = {}) → { onTask: boolean, why: string }
export function nextStep(state, { now, block, activity, phone, allow = [] })
  → { mac: one of MAC_STEPS, phone: "none" | "warn" | "block", why: string, state: newState }
```
- `blocks`: day blocks (see common brief). `now`: minute of day.
- `activity`: `{ app: string, title: string, idleSeconds: number }` — the Mac's frontmost app and window title.
- `phone`: `{ minutesInUse: number }` — continuous phone use during this block (0 if none).
- `state`: `{ blockId: string|null, offSince: number|null, lastStep: string, snoozeUntil: number|null, phoneWarnedAt: number|null }`; `nextStep` returns a NEW state.

## Decisions (in order)
1. `focusBlock`: the block with `start <= now < end` whose kind is study, side_project, deadline, other or class-not-real (an ORION block of kind "class"), and whose title does not match /\b(nap|wind down|sleep|bed|break|rest|dinner|lunch|breakfast|meal|gym)\b/i. Real classes are not focus blocks. Null if none.
2. No focus block, or `state.snoozeUntil > now` → `{ mac: "none", phone: "none" }`, state reset to `offSince: null, lastStep: "none"` (keep `snoozeUntil`).
3. A new block id resets `offSince`, `lastStep`, `phoneWarnedAt` (and clears `snoozeUntil`).
4. `judgeActivity`: on task when the app or title contains any `allow` entry (case-insensitive); OFF task when the app is one of Instagram, TikTok, Snapchat, Reddit, Twitter, X, Facebook, Netflix, Discord, Steam, or the title matches /\b(instagram|tiktok|reddit|netflix|twitch|x\.com|twitter|facebook)\b/i; YouTube counts as on task only when the title shares a word of 4+ letters with the block title; otherwise on task. `idleSeconds >= 300` is off task ("away"). `why` is one short sentence naming the evidence.
5. Mac ladder while off task, measured from `offSince` (set to `now` on the first off-task tick, cleared when back on task): ≥2 min nudge, ≥5 say, ≥8 front, ≥12 quit, ≥20 lock. Never skip upward by more than one step per call: if the ladder says "quit" but `lastStep` is "nudge", answer "say". Back on task → "none" and `offSince: null, lastStep: "none"`.
6. Phone: `minutesInUse >= 15` → "block"; `>= 10` → "warn" once (set `phoneWarnedAt`; a later call before 15 answers "none"); otherwise "none". The phone rule applies whether or not the Mac is on task.
7. Pure: never mutate inputs.

## Tests — `tests/surfaces-focus-escalation.test.mjs` (titles exactly)
- "no focus block means no action"
- "a nap, a meal or a real class is not a focus block"
- "instagram during study climbs one step at a time"
- "coming back on task resets the ladder"
- "a youtube video about the block's topic is on task"
- "an allowed app is on task"
- "a snooze silences everything until it ends"
- "phone use warns at 10 minutes once and blocks at 15"
- "a new block starts the ladder over"
- "inputs are not mutated"
