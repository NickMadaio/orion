// Offered reminders (w19-reminders): ORION suggests one for a deadline the evening before, or for something Nick says
// he has to do. A few a day at most, each only once ever, and the offer waits for his "yes" in reminder-offers.json.
// The plugin shares this file (src/reminder-offers.ts): { pending: [...], offered: { key: date }, perDay: { date: n } }.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { clock12 } from "./schedule.mjs";

export const FILE = "reminder-offers.json";
export const MAX_PER_DAY = 3;
const PENDING_MS = 3 * 3600_000;
const DEADLINE = /\b(due|deadline|submit|submission|exam|quiz|midterm|final|interview|appointment|flight|presentation|demo)\b/i;
const EVENING = [17 * 60, 21 * 60 + 30];

const empty = () => ({ pending: [], offered: {}, perDay: {} });
export function readOffers(dir) {
  try {
    const f = JSON.parse(readFileSync(join(dir, FILE), "utf8"));
    return { pending: Array.isArray(f.pending) ? f.pending : [], offered: f.offered ?? {}, perDay: f.perDay ?? {} };
  } catch { return empty(); }
}
const write = (dir, state) => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, FILE);
  writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2)); renameSync(`${file}.tmp`, file);
};
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
const overlaps = (a, b) => { const x = words(a), y = words(b); const shared = [...x].filter((w) => y.has(w)); return shared.length > 0 && shared.length >= Math.min(x.size, y.size) / 2; };

/** The offer is made and remembered: pending for his yes, counted today, and never made again. */
export function recordOffer(dir, offer, now = new Date()) {
  const s = readOffers(dir);
  const live = s.pending.filter((p) => now.getTime() - p.offeredAt < PENDING_MS);
  const today = dayKey(now);
  write(dir, { pending: [...live, { ...offer, offeredAt: now.getTime() }].slice(-3), offered: { ...s.offered, [offer.key]: today, [`label:${slug(offer.label)}`]: today },
    perDay: { ...Object.fromEntries(Object.entries(s.perDay).slice(-6)), [today]: (s.perDay[today] ?? 0) + 1 } });
}

/** The newest offer still waiting for an answer (within three hours), or null. Not removed: `clearPending` does that. */
export function takePending(dir, now = new Date()) {
  return readOffers(dir).pending.filter((p) => now.getTime() - p.offeredAt < PENDING_MS).sort((a, b) => b.offeredAt - a.offeredAt)[0] ?? null;
}
export function clearPending(dir, key) {
  const s = readOffers(dir);
  write(dir, { ...s, pending: s.pending.filter((p) => p.key !== key) });
}

const hm = (min) => clock12(`${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`);

/**
 * Offers for the day before: a to-do due tomorrow that is already booked, and a deadline-ish event tomorrow.
 * (An unbooked to-do already gets "want me to find an hour tonight?"; a class has its own ladder.)
 * @returns {{ key: string, text: string, offer: { key: string, label: string, at: string, source: string } }[]}
 */
export function deadlineOffers({ now, minute, todos = [], tomorrowDay = [], tomorrow, reminders = [], state = empty() }) {
  if (minute < EVENING[0] || minute > EVENING[1]) return [];
  const left = MAX_PER_DAY - (state.perDay?.[dayKey(now)] ?? 0);
  if (left <= 0) return [];
  const out = [];
  const consider = (title, text, at) => {
    const key = `remind-offer-${slug(title)}-${tomorrow}`;
    if (out.length >= left || state.offered?.[key] || state.offered?.[`label:${slug(title)}`]) return;
    if (reminders.some((r) => overlaps(r.label, title))) return;
    out.push({ key, text, offer: { key, label: title, at, source: "deadline" } });
  };
  for (const t of todos.filter((x) => x.dueDate === tomorrow && (x.booked || x.waiting))) {
    consider(t.title, `${t.title} is due tomorrow. Want a reminder tomorrow at 9 AM?`, `${tomorrow}T09:00`);
  }
  for (const b of tomorrowDay.filter((x) => x.kind !== "class" && DEADLINE.test(x.title) && x.start >= 4 * 60)) {
    const title = String(b.title).replace(/ — .*$/, "").trim();
    const before = Math.max(7 * 60, b.start - 60);
    consider(title, `${title} is tomorrow at ${hm(b.start)}. Want a reminder an hour before, at ${hm(before)}?`, `${tomorrow}T${String(Math.floor(before / 60)).padStart(2, "0")}:${String(before % 60).padStart(2, "0")}`);
  }
  return out;
}
