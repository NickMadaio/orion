# triage — ORION as the gate for phone notifications

## Where you start
Nick wants "normal phone notifications → ORION → me": a Focus mode lets a few people through directly, and ORION reads the rest (mirrored to the Mac) and decides what reaches Nick. You write the decision and digest logic only: `scripts/lib/notify/triage.mjs` and `tests/truthful-triage.test.mjs`. Claude builds the reader and the push.

## Interface
```
export function triage(note, { now, vips = [], quiet = { start: 1410, end: 450 }, busy = false, seen = [] } = {})
  // note = { app: string, sender: string|null, title: string, body: string, at: { date, minute } }
  // -> { action: "now" | "digest" | "drop", reason: string, summary: string }
export function digest(items, { now })
  // items = [{ note, result }] where result.action === "digest"
  // -> { text: string, count: int }     text is what ORION sends; "" when count is 0
```
## Decisions for triage (first match wins)
1. **drop** duplicates: same app+sender+body as something in `seen` within 30 minutes → reason "duplicate".
2. **now** VIP: sender matches a `vips` name case-insensitively (substring either way) → "vip".
3. **now** urgent words in title/body: "urgent", "emergency", "asap", "call me", "are you ok", "hospital", "cancelled", "canceled", "moved to", "room change", "deadline extended", "due in 1 hour", "fraud", "suspicious", "verification code", "2FA" → "urgent". (Verification codes go straight through — Nick is waiting for them.)
4. **now** university and money: app or sender contains "Canvas", "Outlook" with "Northeastern"/"nulondon" in body, "Monzo", "Revolut", "bank" AND body contains a currency amount (£/$/€ + digits) → "school" or "money".
5. **drop** marketing: body/title contains "sale", "% off", "deal", "limited time", "unsubscribe", "new episode", "trending", "you might like", "recommended", "streak", or app is one of Temu, Shein, TikTok, Instagram (non-DM), YouTube, Reddit, Duolingo → "promo".
   - Instagram/TikTok/Snapchat direct messages (title or body contains "sent you a message" or "messaged you") are NOT dropped; they fall through.
6. **digest** everything else → "later". During `quiet` hours (wraps midnight) or when `busy`, rules 3–4 still say now; people who are not VIP go to digest.
- `summary`: `"<sender or app>: <first 80 chars of body>"`, whitespace collapsed, no newline.

## Decisions for digest
- Group by sender (or app when no sender). Order groups by count desc, then name.
- One line per group: `"Sam (3): <latest summary body>"`; at most 8 lines, then `"+N more"`.
- First line: `"While you were busy: <count> messages."` (count = items.length). Empty input → { text: "", count: 0 }.

## Tests (titles exact)
1. `vip goes straight through`.
2. `verification codes are urgent`.
3. `promo is dropped`.
4. `instagram dm is not promo` → digest.
5. `duplicate within 30 minutes is dropped` and after 31 minutes is not.
6. `canvas is school`.
7. `money needs an amount` — Monzo "Your weekly summary" → digest; Monzo "You paid £4.50 to Tesco" → now.
8. `quiet hours send friends to the digest` but urgent still now.
9. `digest groups and caps` — 12 senders → 8 lines + "+4 more".
10. `invalid input throws`.
