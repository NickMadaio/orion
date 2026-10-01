# reply-person — ORION talks TO Nick, never about him

## Where you start
ORION's replies go straight to Nick's phone. On 2026-10-01 one read "His apps are locked until 7:15 AM—that's 7 hours away, which is past his bedtime." The model had copied the third person from its own notes. You write `scripts/lib/remote/reply-person.mjs` and `tests/truthful-reply-person.test.mjs`; Claude runs it in orion-remote's reply fixer.

## Interface
```
export function findThirdPerson(reply)   // -> [{ phrase, index }]  every "he/his/him/Nick" that refers to Nick
export function toSecondPerson(reply)    // -> string with those rewritten to "you/your/you"
```
## Decisions
1. Only sentences where Nick is the subject/owner are rewritten. Heuristic: "he/his/him/himself" and "Nick"/"Nick's" when NO other male name or male noun ("your dad", "your brother", "the professor", "your friend", any capitalised name other than Nick/ORION) appears earlier in the same sentence.
2. Rewrites: `His` → `Your`, `his` → `your`, `He` → `You`, `he` → `you`, `him` → `you`, `himself` → `yourself`, `Nick's` → `your`, `Nick` → `you` (sentence start → `You`).
3. Verb agreement after he→you, checked in this order: `he's got`→`you've got`, `he's`→`you're`, `he is`→`you are`, `he was`→`you were`, `he has`→`you have`, `he doesn't`→`you don't`, and a third-person -s verb directly after (`he needs`→`you need`, `he wants`→`you want`, `he goes`→`you go`) for a fixed list: needs, wants, has, goes, does, says, gets, sleeps, wakes, asks, tries.
4. Quoted text ("…") is never changed.
5. Pure; no mutation; TypeError on non-string.

## Tests (titles exact)
1. `the 2026-10-01 reply` — "His apps are locked until 7:15 AM—that's 7 hours away, which is past his bedtime." → "Your apps are locked until 7:15 AM—that's 7 hours away, which is past your bedtime."
2. `verbs agree` — "He needs sleep and he's got class at 9." → "You need sleep and you've got class at 9."
3. `someone else's he is left alone` — "Your dad called; he wants you to ring back." unchanged.
4. `quotes are untouched`
5. `findThirdPerson lists phrases with indexes`
6. `no change when already second person`
7. `invalid input throws`
