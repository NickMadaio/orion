# grant-policy — how much extra phone time is reasonable

## Where you start
Nick's phone locks his distracting apps past bedtime and in work blocks. He asks ORION for more time ("20 more minutes please", "can I have 2 more hours"). On 2026-10-01 the same kind of ask was refused, offered 10, and granted 20 within an hour — the model decides differently each time. You write the decision as a pure function: `scripts/lib/life/grant-policy.mjs` and `tests/truthful-grant-policy.test.mjs`. Claude wires it into `orion-phone-time`.

## Interface
```
export function decideGrant({ now, asked, reason, lock, firstCommitment, grantsTonight, sleepHours = 8 })
  // now: { date, minute }   asked: minutes requested (int)   reason: string|null
  // lock: { why: "night"|"work"|"checkin", untilMinute }   firstCommitment: minute tomorrow (night) or null
  // grantsTonight: int (grants already given in this lock window)
  // -> { grant: int, say: string }   grant 0 means no
```
## Decisions (in order)
1. `asked` must be 1..600, `now.minute` 0..1439 (TypeError otherwise). Minutes after midnight before 06:00 count as "night" even if lock.why is missing.
2. Hard cap: never more than 60; never past `lock.untilMinute`.
3. `grantsTonight >= 2` → grant 0; say "That's twice already tonight. Phone down — bed." for a night lock, "That's twice already — back to it." for a work lock.
4. Night lock:
   - no reason (null, empty, or only "please"/"pretty please"/"pls") → grant 0, say `No reason, no time — it's past bedtime. Tell me what it's for and I can give you 10.`
   - with a reason: grant = min(asked, 20). If `firstCommitment` is set and sleep left (firstCommitment + 1440 − now − grant, in minutes, when now is before midnight; else firstCommitment − now − grant) is under `sleepHours*60 − 60`, grant = min(grant, 10).
   - say: `Unlocked for <grant> min — <clock end>. Then it locks again.` (clock end = 12-hour "12:45 AM").
5. Work lock (why "work" or "checkin"): with a reason grant = min(asked, 15); without, 0 and say `You planned this block. Finish it or tell me why you need the phone.`
6. If asked > the grant given and grant > 0, append ` (asked for <asked>; <grant> is what I'll do.)`.

## Tests (titles exact)
1. `no reason past bedtime is a no with an offer`
2. `a reason past bedtime gets up to 20`
3. `an early class shrinks it to 10` — now 01:30 (minute 90), asked 20, reason "text my mom", firstCommitment 480 (8:00): sleep left 480 − 90 − 20 = 370 < 420 → grant 10.
4. `never past the lock or 60 minutes`
5. `twice tonight is the limit`
6. `work blocks give 15 with a reason`
7. `asking for more says what you get` — asked 120 with reason at 23:30 → 20 and the suffix.
8. `invalid input throws`
