/*
 His reply to something ORION said first (2026-10-23 audit: "if i respond he doesnt have context of him talking to me
 proactively so my response makes no sense").

 The label was on the prompt every time, but userText() strips it and the front desk was called with his words alone, so:
   10-20 "It's been 30 min. Gym, now." → "I'm meal prepping. That's why. Sorry." → "What time or how long do you mean?"
   10-19 "It's 12:02 AM, bedtime."     → "im doing work shush up"                 → "Since when — what time did you start work?"
   10-16 "past bedtime; sleep now"     → "Yea yea yea I know, just wrapping up…"   → an alarm labelled "push my alarm"
 Here: read what ORION said from either prefix (the Mac's "[ORION context: …]", the phone's "- N min ago you …"), give it to the
 front desk as ORION's last turn, and read the short answers ("yeah", "not yet", "in 10", "already did", "shush") against it
 in code. Pure: no I/O.
*/

export type OutreachKind = "bedtime" | "start" | "question" | "info";
export type Outreach = { text: string; minutes: number; kind: OutreachKind; title?: string };
export type ShortReply =
  | { kind: "yes" } | { kind: "no" } | { kind: "not-yet" } | { kind: "later"; minutes: number } | { kind: "done" }
  | { kind: "stop" } | { kind: "other"; activity: string };
export type OutreachPlan = { text: string; checkin?: string[] };

const BEDTIME = /\b(?:bedtime|past bedtime|bed at \d|still up at|sleep now|go to (?:bed|sleep))\b/i;
const START = /^(?:time to start: |.+ — still not started|it'?s been \d+ min\. .+, now\.|you'?ve been avoiding .+ for \d+ min)/i;

export function kindOf(text: string, hint?: string): OutreachKind {
  if (hint === "bedtime" || hint === "start" || hint === "question" || hint === "info") return hint;
  if (BEDTIME.test(text)) return "bedtime";
  if (START.test(text) || hint === "mismatch") return "start";
  return /\?\s*$/.test(text.trim()) ? "question" : "info";
}

/** The planned block a "start" line is about: "Time to start: Gym." / "Gym — still not started" / "It's been 30 min. Gym, now." */
export function titleOf(text: string, label = ""): string | undefined {
  const fromLabel = label.match(/\(([^()]+?), planned \d{1,2}:\d{2}/)?.[1];
  if (fromLabel) return fromLabel.trim();
  const m = text.match(/^time to start: (.+?)\.?$/i) ?? text.match(/^(.+?) — still not started/i)
    ?? text.match(/^it'?s been \d+ min\. (.+?), now\./i) ?? text.match(/avoiding (.+?) for \d+ min/i);
  return m?.[1]?.trim();
}

/** What ORION said first, from the Mac label or the phone's context line; undefined when the prompt carries neither. */
export function parseOutreach(prompt: string): Outreach | undefined {
  const mac = prompt.match(/\[ORION context:([^\]]*)\]/)?.[1];
  if (mac) {
    const text = mac.match(/"([^"]+)"/)?.[1];
    if (!text) return undefined;
    const minutes = Number(mac.match(/(\d+) min ago/)?.[1] ?? 0);
    const hint = mac.match(/min ago \((bedtime|start|question|info)\)/)?.[1] ?? (/\(mismatch|not started\)/.test(mac) ? "mismatch" : undefined);
    const title = titleOf(text, mac);
    return { text, minutes, kind: kindOf(text, hint), ...(title ? { title } : {}) };
  }
  const phone = prompt.match(/^- (\d+) min ago you (?:messaged him first(?: \((\w+)\))?: |asked him )"([^"]+)"(.*)$/m)
    ?? prompt.match(/^- You messaged him first[^"]*?"([^"]+)"()()(.*)$/m);
  if (!phone) return undefined;
  const [, a, b, c, rest = ""] = phone;
  const text = c || a || "";
  if (!text) return undefined;
  const minutes = c ? Number(a) : 0;
  const title = titleOf(text, rest);
  return { text, minutes, kind: kindOf(text, c ? b : undefined), ...(title ? { title } : {}) };
}

const WORDS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "a few": 5, few: 5, couple: 2, "a couple": 2, half: 30 };
const minutesOf = (n: string, unit: string): number => {
  const v = /^\d+$/.test(n) ? Number(n) : (WORDS[n.toLowerCase()] ?? NaN);
  return /^h/i.test(unit) ? v * 60 : v;
};

/** Short answers, read on their own; undefined for anything longer or unclear (the worker reads those, with the context). */
export function readShortReply(message: string): ShortReply | undefined {
  const m = message.trim().toLowerCase().replace(/[“”]/g, "\"").replace(/\s+/g, " ");
  if (!m || m.split(" ").length > 14 || /\?\s*$/.test(m)) return undefined;
  const later = m.match(/\b(?:in|give me|another|like|about|after|need|for)?\s*(\d+|a|one|two|three|four|five|ten|fifteen|twenty|thirty|a few|a couple|half)\s*(?:more\s*)?(min(?:ute)?s?|mins?|m|h(?:ou)?rs?|hours?|an hour)\b/);
  if (later && /\b(?:in|give me|another|more|need|after|like|about|for|first)\b|^\s*\d+\s*(?:min|m)\b/.test(m)) {
    const unit = later[2] === "an hour" ? "h" : later[2]!;
    const minutes = later[1] === "half" ? 30 : minutesOf(later[1]!, unit);
    if (Number.isFinite(minutes) && minutes > 0 && minutes <= 240) return { kind: "later", minutes };
  }
  const bare = m.match(/^(?:in|give me|another|like)\s+(\d{1,3})\s*[.!]*$/);
  if (bare && Number(bare[1]) > 0 && Number(bare[1]) <= 240) return { kind: "later", minutes: Number(bare[1]) };
  if (/^(?:ya|yea|yeah|yes|yep|yup|ok(?:ay)?|k|sure|on it|going(?: now)?|omw|fine|alright|will do|aight|night|good ?night|gn|heading (?:there|to bed)|going to bed)\b[\s.!]*$/.test(m)) return { kind: "yes" };
  if (/\b(?:already (?:did|done|in bed|asleep|went|finished|there)|did it|done(?: it)?|finished(?: it)?|just got back|i(?:'m| am) (?:in bed|at the gym|there)|was there)\b/.test(m)) return { kind: "done" };
  if (/^(?:not yet|nah not yet|in a (?:bit|sec|minute|min)|soon|later|after this|one sec|gimme a sec|in a moment)\b/.test(m)) return { kind: "not-yet" };
  if (/\b(?:shush|shut up|stop(?: it)?|leave me alone|i know|go away|not now|stop nagging|enough)\b/.test(m)) return { kind: "stop" };
  if (/^(?:no|nope|nah|not today|skip(?:ping)? it|not going)\b/.test(m)) return { kind: "no" };
  const doing = m.match(/^(?:i'?m|im|i am|i'?ve been|just)\s+(?:just\s+|still\s+)?((?:[a-z]+\s+)?[a-z]+ing\b(?:\s+(?!that|sorry|rn|now|right)[a-z']+){0,2})/);
  if (doing) return { kind: "other", activity: doing[1]!.trim() };
  return undefined;
}

const q = (s: string) => `"${s.replace(/["\\$`]/g, "").slice(0, 80)}"`;

/** Code's whole answer to a short reply to a bedtime or start line, and the check-in it sets; undefined → the worker, with the context. */
export function planOutreachReply(o: Outreach, message: string): OutreachPlan | undefined {
  const r = readShortReply(message);
  if (o.kind === "bedtime") {
    // Whatever he says, the bedtime ladder is over for tonight (orion-inbound-turn wrote the ack): say so, never ask "since when".
    if (!r) return message.trim().split(/\s+/).length <= 14 && !/\?\s*$/.test(message) && !/\b(?:remind|alarm|wake|push|move|add|cancel|set)\b/i.test(message)
      ? { text: "Got it. No more bedtime reminders from me tonight." } : undefined;
    switch (r.kind) {
      case "yes": return { text: "Night, Nick." };
      case "done": return { text: "Good. Night, Nick." };
      case "later": return { text: `Okay, ${r.minutes} more minutes, then sleep. That was my last bedtime reminder tonight.` };
      case "not-yet": return { text: "Okay. That was my last bedtime reminder tonight." };
      default: return { text: "Got it, I'll leave you to it. No more bedtime reminders tonight." };
    }
  }
  if (o.kind === "start" && o.title && r) {
    const t = o.title;
    switch (r.kind) {
      case "later": return { text: `Okay, ${t} in ${r.minutes} min. I'll check in then.`, checkin: ["add", String(r.minutes), t, "--because", message.slice(0, 120)] };
      case "not-yet": return { text: `Okay, not yet. I'll check on ${t} in 15 min.`, checkin: ["add", "15", t, "--because", message.slice(0, 120)] };
      case "other": return { text: `Okay, ${r.activity} first. I'll check back about ${t} in 25 min.`, checkin: ["add", "25", t, "--because", message.slice(0, 120)] };
      case "done": return { text: `Nice, ${t} done. I'll stop pinging about it.`, checkin: ["close", t] };
      case "yes": return { text: `Good. Go, I'll stop pinging about ${t}.`, checkin: ["started", t] };
      case "no": case "stop": return { text: `Okay, no ${t} for now. I'll stop pinging about it.`, checkin: ["cancel", "--because", message.slice(0, 120)] };
    }
  }
  return undefined;
}

/** For the worker when code does not answer: ORION's own message, as the conversation it is, and how to read his answer. */
export function outreachNote(o: Outreach): string {
  const meaning = o.kind === "bedtime" ? "it was a bedtime reminder: whatever he says, no more bedtime reminders tonight; never ask when he started something"
    : o.kind === "start" ? `it was about starting ${o.title ? q(o.title) : "a planned block"}: "not yet"/"in 10" means later (orion-checkin add <min> with his reason), "already did" means done (orion-checkin close), something else he is doing means it waits (a check-in, never a calendar change)`
    : o.kind === "question" ? "\"yeah\" accepts what you offered, \"no\" declines it" : "read his message as an answer to it";
  return `[Conversation so far: ${o.minutes} min ago YOU (ORION) messaged him first: "${o.text.slice(0, 300)}". His message below is his reply to that; ${meaning}.]`;
}

/** The front desk's "Earlier:" turn. */
export const outreachHistory = (o: Outreach) => [{ role: "assistant" as const, content: o.text.slice(0, 300) }];
