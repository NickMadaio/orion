# 2026-10-20 live test as Nick: fixes

From `2026-10-20-live-as-nick.md`; branch `fix/live-as-nick-1020` from 57fd443. Each has a test with his exact phrase.

1. **"put cs lab from now until ten thirty"** (20:55). The "now" was not ignored: the reply said 9:00-10:30 PM (the add was `--at 21:00`, 90 min); what was wrong was that the Gym under way was
   cut to 5 minutes, and the finished CS Lab was not mentioned. `replan.mjs` no longer clips a must for a time he states: it is moved later whole (anchor length), or the change is refused
   ("must-haves could not fit") and he is asked; the reply says "Your earlier CS Lab (9:00 AM–11:15 AM) is already over, so this is a second one." (`live-as-nick-2026-10-20.test.ts`, `tests/live-as-nick-2026-10-20.test.mjs`).
2. **"can u redo my evening, gym first then resume"** with resume over: the plan leaves the finished block out, puts Gym first, and says "Finish resume was 5:50–7:20 PM, already done? Say "add finish resume after Gym" if you want another one."
3. **"actually do resume before gym"**: read only when a reschedule request of his is on record (15 min, same chat); skips the desk (which read "resume" as a focus session); books resume again, then Gym at 90.
4. **Typos and run-ons** ("resched", "reschdule", "gim", "frist", "priorty", "u", no commas, "then whatevers left by priorty, im kinda tired tho"): `fixTypos` (aliases + small edit distance on 5+ letter words) before the unchanged allow-list.
5. **A block not on his day** ("put piano practice first"): "Piano practice isn't on your day, so I haven't changed anything. How many minutes should it be? I'll put it first."
6. **The 19:55 "gave-up" Gym trim.** `orion-checkin` gives up on a block after its last alert and runs `orion-reschedule displace … --why gave-up`; `planDisplace` re-entered it as only the minutes still missed (50). A must now goes back at its anchor length (`wholeMinutes`), or is dropped with "has no room today". Moves that change a length carry `toEnd`.
