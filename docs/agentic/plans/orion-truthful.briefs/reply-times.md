# reply-times — do the times ORION says match what was booked?

## Where you start
On 30 September ORION booked "finish resume" 14:30–16:00 and told Nick "resume at 4:00 PM". You write `scripts/lib/remote/reply-times.mjs` and `tests/truthful-reply-times.test.mjs`. Claude runs it on every reply after a booking tool ran.

## Interface
```
export function checkReplyTimes(reply, booked)
  // booked = [{ title, start, end }]   minutes after midnight
  // -> { ok: boolean, mismatches: [{ title, said: minute, booked: minute }], unmatched: string[] }
export function mentions(reply)
  // -> [{ phrase, minute, near: string }]   every clock time in the reply, with up to 6 words either side
```
## Decisions
1. Clock times recognised: "4 PM", "4pm", "4:00 PM", "4:00pm", "16:00", "noon" (720), "midnight" (0). Ranges "2:30–4 PM" / "2:30-4:00 PM" / "from 2:30 to 4" give two times; a trailing AM/PM applies to both ends when the first has none.
2. A bare "at 4" with no AM/PM: 1..7 → PM, 8..11 → AM, 12 → PM.
3. Matching a time to a block: the block whose title shares the most words (≥ 1 word of 4+ letters, case-insensitive, ignoring "the/my/your/and") with the `near` text. Ties → nearest booked start.
4. A mention matches if it equals the block's start OR end (a range's end may equal the block's end). Otherwise it is a mismatch `{ title, said, booked: start }`.
5. Times with no matching block go to `unmatched` as their phrase (they may be classes; not an error).
6. `ok` is true when mismatches is empty.

## Tests (titles exact)
1. `the 30 September resume mismatch` — reply "Resume at 4:00 PM, applications at 4" with booked [{title:"finish resume",start:870,end:960},{title:"send internship applications",start:960,end:1020}] → ok false; one mismatch {title:"finish resume", said:960, booked:870}. The applications "at 4" matches (960).
2. `ranges match start and end` — "Resume 2:30–4 PM" → ok true.
3. `noon and midnight`.
4. `bare hour rules` — "at 9" → 540, "at 3" → 900.
5. `unmatched times are listed not failed` — "Lab ends at 12:30" with no lab booked → ok true, unmatched ["12:30"].
6. `no times is ok` — "Added four tasks." → ok true, no mismatches.
7. `invalid input throws`.

## For the reviewer
Test 1 is the real failure; it must fail on the resume and pass on applications.
