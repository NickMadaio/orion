/*
 One shared "recent things I made" ledger per conversation (w20 round 3, live gate 2026-11-05).

 ORION could undo a calendar move, but "delete that note i just made" cleared the schedule, "take the big mac back off" could not find
 the meal, and a reminder could be set but not cancelled by what it was for. Everything ORION creates in a chat goes in one list (a block,
 a note, a reminder, a food entry, water), read from the tool results the turn actually produced (never from what the model said it did),
 so "undo", "that" and "the stretch one" all resolve against the same thing. Entries expire after LEDGER_WINDOW_MS; a chat only ever sees
 its own. The list is memory, not state of record: removal always goes back to the scripts and reads the result.
*/

export type MadeKind = "block" | "note" | "reminder" | "food" | "water";
export type MadeItem = {
  kind: MadeKind;
  /** What it is called: the block's title, the note's words, the reminder's label, the food's name. */
  label: string;
  at: number;
  /** Block: the `--date` words it was booked for (empty = today). */
  dateArgs?: string[];
  /** Food: the health-log ids one turn logged. Water: bottles added. */
  ids?: string[];
  count?: number;
};
export type MadeTool = { canonical: string; stdout: string };

/** How long a made thing can still be "that" or "the one i just made". */
export const LEDGER_WINDOW_MS = 3 * 3600_000;
const KEEP = 40;

const STOPWORDS = new Set(["the", "a", "an", "my", "that", "this", "those", "these", "one", "ones", "i", "just", "added", "made", "saved", "logged", "set", "booked", "created",
  "off", "on", "from", "to", "of", "in", "day", "today", "list", "calendar", "plan", "schedule", "log", "block", "blocks", "note", "notes", "reminder", "reminders", "alarm", "alarms",
  "session", "event", "slot", "please", "pls", "anymore", "any", "more", "back", "and", "both", "all", "it", "them", "me", "for", "at", "with", "about", "also", "too", "again", "wasnt", "wasn't", "isnt", "isn't", "not", "didnt", "didn't", "was", "were", "is", "no", "nah", "yeah", "wrong"]);
const stem = (w: string): string => (w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, "") : w.replace(/s$/, ""));

/** The words that name a thing: lowercase, no filler, no tense ("stretch", "careers", "mum"). */
export function contentWords(text: string): string[] {
  return [...new Set((text.toLowerCase().replace(/[’`]/g, "'").match(/[a-z0-9']+/g) ?? []).filter((w) => w.length >= 2 && !STOPWORDS.has(w)).map(stem))];
}

/** Every word he used names something in the label (a word is a prefix of one of the label's words, or the other way round). */
export function namesLabel(words: readonly string[], label: string): boolean {
  if (!words.length) return false;
  const have = contentWords(label.replace(/['’]/g, ""));
  const wants = words.map((w) => w.replace(/['’]/g, ""));
  return wants.every((w) => have.some((h) => h.startsWith(w) || w.startsWith(h)));
}

const unquote = (text: string): string => text.replace(/^["']|["']$/g, "").trim();
const FAILED = /NOTHING WAS|NOT BOOKED|NOT DONE|usage:|\bError\b|^Error|failed|couldn't|not found/i;

/** What one tool result made, if it made something. Reads only the command and what it printed. */
export function madeBy(tool: MadeTool, now: number): MadeItem[] {
  const { canonical, stdout } = tool;
  const out = stdout.trim();
  if (/^exec\s+orion-reschedule\s+add\b/.test(canonical)) {
    if (FAILED.test(out) || /--dry-run/.test(canonical)) return [];
    const title = /^exec\s+orion-reschedule\s+add\s+("[^"]+"|'[^']+'|\S+)/.exec(canonical)?.[1];
    if (!title) return [];
    const date = /--date\s+(\S+)/.exec(canonical)?.[1];
    return [{ kind: "block", label: unquote(title), at: now, ...(date ? { dateArgs: ["--date", date] } : {}) }];
  }
  if (/^exec\s+orion-brain\s+learn\b/.test(canonical)) {
    const line = /^(?:Added to|New note)[^:\n]*:\s*(.+)$/m.exec(out)?.[1];
    return line ? [{ kind: "note", label: line.trim(), at: now }] : [];
  }
  if (/^exec\s+orion-log\s+water\b/.test(canonical)) {
    const n = /^Logged (\d+) bottle/.exec(out)?.[1];
    return n ? [{ kind: "water", label: "water", at: now, count: Number(n) }] : [];
  }
  if (/^exec\s+orion-log\s+food\s/.test(canonical)) {
    const name = /^Logged (.+?) \(\d+ kcal\)/.exec(out)?.[1];
    return name ? [{ kind: "food", label: name, at: now }] : [];
  }
  if (/^exec\s+orion-food-estimate\b/.test(canonical)) {
    try {
      const j = JSON.parse(out.split("\n").at(-1) ?? "") as { ok?: boolean; logged?: { id?: string; ids?: unknown }; entry?: { title?: string }; summary?: string };
      const ids = Array.isArray(j.logged?.ids) ? j.logged!.ids.map(String) : j.logged?.id ? [j.logged.id] : [];
      if (!j.ok || !ids.length || /\bundo\b/.test(canonical)) return [];
      return [{ kind: "food", label: String(j.entry?.title ?? j.summary ?? "food"), at: now, ids }];
    } catch { return []; }
  }
  if (/"action":\s*"(?:alarm_set|timer_set)"/.test(canonical) && !/^Error|"isError":\s*true/i.test(out) && !FAILED.test(out.slice(0, 80))) {
    const label = /"label":\s*"((?:[^"\\]|\\.)*)"/.exec(canonical)?.[1];
    return label ? [{ kind: "reminder", label: label.replace(/\\"/g, '"'), at: now }] : [];
  }
  return [];
}

export class MadeLedger {
  private chats = new Map<string, MadeItem[]>();

  /** Reads what a finished turn made out of its tool results. */
  ingest(key: string | undefined, tools: readonly MadeTool[], now: number): void {
    if (!key) return;
    const made = tools.flatMap((t) => madeBy(t, now));
    if (made.length) this.chats.set(key, [...(this.chats.get(key) ?? []), ...made].slice(-KEEP));
  }

  record(key: string | undefined, item: MadeItem): void { if (key) this.chats.set(key, [...(this.chats.get(key) ?? []), item].slice(-KEEP)); }

  /** This chat's live entries, oldest first. */
  recent(key: string | undefined, now: number): MadeItem[] {
    return key ? (this.chats.get(key) ?? []).filter((i) => now - i.at < LEDGER_WINDOW_MS) : [];
  }

  /** The same list without one entry (the thing was taken off). */
  forget(key: string | undefined, item: MadeItem): void {
    if (key) this.chats.set(key, (this.chats.get(key) ?? []).filter((i) => i !== item));
  }
}
