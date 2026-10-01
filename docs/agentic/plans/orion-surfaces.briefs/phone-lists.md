# Task phone-lists — which of the phone's app lists to block (pure)

## Why
Today the phone blocks one list of apps all at once (`FocusLock` uses a single `FamilyActivitySelection`). Nick wants lists — messaging (Instagram, Snapchat, Messages), feeds (TikTok, Instagram), video (YouTube), games — so ORION can block the distracting ones and leave texting open. iOS never tells ORION which app is which; he fills each list once in Apple's picker, and ORION only reasons about list names and per-list minutes used today.

## Interface — `scripts/lib/focus/phone-lists.mjs`
```
export const LISTS = ["messaging", "feeds", "video", "games"];
export function listsToBlock({ block, usedToday, current, escalation, allowMessaging = true })
  → { block: string[], keep: string[], why: string }
```
- `block`: the current day block or null. `usedToday`: `{ messaging, feeds, video, games }` minutes. `current`: the list being used right now or null. `escalation`: "none" | "warn" | "block" (from focus-escalation's phone answer).

## Decisions (in order)
1. Daily caps, any time of day: feeds ≥ 120 min → block feeds; video ≥ 120 → video; games ≥ 90 → games. Feeds blocked AND usage continues in video ≥ 30 more minutes → video too (counts as `video ≥ 30` when feeds is already capped).
2. During a focus block (study, side_project, deadline, other; not nap/meal/break/rest/gym/wind down) with escalation "block": block feeds, video and games; block messaging ONLY when `current === "messaging"` and `allowMessaging === false`.
3. Escalation "warn" or "none" adds nothing beyond rule 1.
4. Output lists in `LISTS` order, no duplicates; `keep` is every other list. `why` names the rule(s) in one sentence, e.g. "feeds over 2 hours today; focus block 'Study' and 15 minutes on the phone".
5. Invalid input (unknown list name, negative minutes) → TypeError.

## Tests — `tests/surfaces-phone-lists.test.mjs` (titles exactly)
- "nothing is blocked on a normal day"
- "two hours of feeds blocks feeds only"
- "carrying on in video after feeds is capped blocks video too"
- "a focus block at the block step leaves messaging open"
- "messaging is blocked only when it is the distraction and not allowed"
- "a nap or meal block never triggers the focus rule"
- "the output is ordered and has no duplicates"
- "invalid input throws TypeError"
