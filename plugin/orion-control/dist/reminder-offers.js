/*
 Offered reminders, plugin side (w19-reminders). ORION offers a reminder for something Nick says he has to do ("i need to
 email prof hale tomorrow" -> "Want a reminder tomorrow at 10 AM to email prof hale?"). A few a day at most, each only once,
 and the offer waits for his "yes". The proactive script writes deadline offers into the same file
 (scripts/lib/reminders/offers.mjs): { pending: [...], offered: { key: date }, perDay: { date: n } }.
*/
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
export const MAX_OFFERS_PER_DAY = 3;
/** An offer is answered soon after it is made; a "yes" an hour and a half later is about something else. */
export const OFFER_WINDOW_MS = 90 * 60_000;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
/** The offers file, next to reminders.json. `now` is a seam for tests. */
export function fileOfferPort(dir, now = () => new Date()) {
    const file = path.join(dir, "reminder-offers.json");
    const read = async () => {
        try {
            const f = JSON.parse(await readFile(file, "utf8"));
            return { pending: Array.isArray(f.pending) ? f.pending : [], offered: f.offered ?? {}, perDay: f.perDay ?? {} };
        }
        catch {
            return { pending: [], offered: {}, perDay: {} };
        }
    };
    const write = async (s) => { await mkdir(dir, { recursive: true }); await writeFile(`${file}.tmp`, JSON.stringify(s, null, 2)); await rename(`${file}.tmp`, file); };
    return {
        async pending() { const t = now().getTime(); return (await read()).pending.filter((p) => t - p.offeredAt < OFFER_WINDOW_MS).sort((a, b) => b.offeredAt - a.offeredAt)[0] ?? null; },
        async clear(key) { const s = await read(); await write({ ...s, pending: s.pending.filter((p) => p.key !== key) }); },
        async record(offer) {
            const s = await read();
            const today = dayKey(now());
            const labelKey = `label:${slug(offer.label)}`;
            if ((s.perDay[today] ?? 0) >= MAX_OFFERS_PER_DAY || s.offered[offer.key] || s.offered[labelKey])
                return false;
            await write({ pending: [...s.pending.filter((p) => now().getTime() - p.offeredAt < OFFER_WINDOW_MS), offer].slice(-3), offered: { ...s.offered, [offer.key]: today, [labelKey]: today },
                perDay: { ...Object.fromEntries(Object.entries(s.perDay).slice(-6)), [today]: (s.perDay[today] ?? 0) + 1 } });
            return true;
        },
    };
}
const VERB = "email|e-mail|call|ring|text|message|submit|send|finish|pay|book|buy|return|print|ask|talk to|meet|register|sign up for|sign up|turn in|hand in|renew|cancel|follow up with|follow up|reply to|pick up|drop off|schedule|apply|fill out|file|upload|study for|prepare|bring";
const LEAD = String.raw `^(?:(?:ok|okay|oh|so|and|also|yeah|yep|ugh|hm+|wait|btw|actually|honestly)\b[,\s]*)*`;
const COMMIT = new RegExp(`${LEAD}(?:i\\s+(?:really\\s+|still\\s+)?(?:need|have|got|gotta|must|should)\\s+to|i'?ll\\s+have\\s+to|i\\s+gotta|gotta|don'?t\\s+(?:let\\s+me\\s+)?forget\\s+to)\\s+(${VERB})\\b\\s*(.*)$`, "i");
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_CUE = new RegExp(String.raw `\b(?:tomorrow|tonight|today|later today|next week|this (?:morning|afternoon|evening)|in the morning|(?:on|by|before|next|this)\s+(?:${WEEKDAYS.join("|")}))\b`, "i");
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const clock = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
const at = (base, addDays, h, m = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, h, m);
/** Something he says he has to do, with a day or part of a day to hang a reminder on; null for anything else. */
export function commitmentOf(message, now) {
    const text = message.trim().replace(/[‘’]/g, "'");
    if (!text || /\?\s*$/.test(text) || /^(?:do|should|can|could|would|will|what|why|how|when|who|is|are)\b/i.test(text) || /\bremind(?:er)?\b/i.test(text))
        return null;
    const m = COMMIT.exec(text);
    if (!m)
        return null;
    const cue = DAY_CUE.exec(m[2] ?? "");
    if (!cue)
        return null;
    const label = `${m[1]} ${(m[2] ?? "").replace(DAY_CUE, "").replace(/\s+(?:at|by|before|on)\s*$/i, "").replace(/\s+/g, " ").trim()}`.trim();
    if (label.split(" ").length < 2)
        return null;
    const word = cue[0].toLowerCase();
    const hour = now.getHours() + now.getMinutes() / 60;
    const spoken = (d, prefix, h) => ({ label, at: iso(d), when: `${prefix}${clock(h)}` });
    if (word === "tomorrow" || word === "in the morning")
        return spoken(at(now, hour >= 5 || word === "tomorrow" ? 1 : 0, 10), "tomorrow at ", 10);
    if (word === "tonight")
        return hour < 19.5 ? spoken(at(now, 0, 20), "at ", 20) : null;
    if (word === "this afternoon")
        return hour < 14.5 ? spoken(at(now, 0, 15), "at ", 15) : null;
    if (word === "this evening")
        return hour < 17.5 ? spoken(at(now, 0, 18), "at ", 18) : null;
    if (word === "today" || word === "later today")
        return hour < 16.5 ? spoken(at(now, 0, 17), "at ", 17) : null;
    if (word === "next week") {
        const ahead = ((1 - now.getDay() + 7) % 7) || 7;
        return spoken(at(now, ahead, 10), "Monday at ", 10);
    }
    const day = WEEKDAYS.findIndex((d) => word.endsWith(d));
    if (day < 0)
        return null;
    const ahead = ((day - now.getDay() + 7) % 7) || 7;
    const name = WEEKDAYS[day].replace(/^./, (c) => c.toUpperCase());
    return spoken(at(now, ahead, 10), `${name} at `, 10);
}
