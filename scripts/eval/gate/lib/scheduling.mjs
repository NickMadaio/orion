// Port of native/Orion/Sources/Orion/SchedulingMemory.swift (`context(for:localRouting:rules:)` and the
// local digest) and LocalRoutingMode.parse. Pure: the rules text and the routing mode are injected.
import { gcount, gprefix, graphemes, trimH } from "./text.mjs";

export const LOCAL_DIGEST_LIMIT = 2100;
const RELEVANT = /\b(schedule|scheduling|plan|planning|reschedule|class|lecture|nap|commute)\b/i;
const SKIP_MARKERS = ["orion-", "life-config", "School → dorm"];
const DIGEST_SECTIONS = [
  { heading: "priority scale", cap: 700, firstParagraphOnly: false },
  { heading: "protected time", cap: 1100, firstParagraphOnly: false },
  { heading: "class wrapper", cap: 600, firstParagraphOnly: true },
];

/** LocalRoutingMode.parse over the parsed openclaw.json (anything unreadable is "off"). */
export function parseRoutingMode(config) {
  const c = config?.plugins?.entries?.["orion-control"]?.config;
  if (!c || typeof c !== "object") return { mode: "off", scheduleToCloud: false };
  return { mode: typeof c.localRouting === "string" ? c.localRouting : "off", scheduleToCloud: c.localRoutingScheduleToCloud === true };
}
export const servesSchedulingLocally = (r) => r.mode === "on" && !r.scheduleToCloud;

/** Splits at ". ", "! " or "? " (so "2.5 hours" survives). Swift walks Characters, so this does too. */
function sentences(unit) {
  const out = []; let current = "";
  const chars = graphemes(unit);
  chars.forEach((ch, i) => {
    current += ch;
    if (".!?".includes(ch) && i + 1 < chars.length && chars[i + 1] === " ") { out.push(current); current = ""; }
  });
  if (current) out.push(current);
  return out.map(trimH).filter((s) => s.length > 0);
}

const hasSkipMarker = (s) => SKIP_MARKERS.some((m) => s.includes(m));

function strippedOfToolSentences(unit) {
  const text = sentences(unit).filter((s) => !hasSkipMarker(s)).join(" ");
  if (text === "" || text === "-") return null;
  return unit.startsWith("- ") && !text.startsWith("- ") ? `- ${text}` : text;
}

function ruleLines(body, cap, firstParagraphOnly) {
  let units = []; let current = [];
  const flush = () => { if (current.length) units.push(current.join(" ")); current = []; };
  for (const raw of body.split("\n")) {
    const line = trimH(raw);
    if (line === "") { if (firstParagraphOnly && current.length) break; flush(); continue; }
    if (line.startsWith("(Why this is written down")) break;
    const isBullet = line.startsWith("- ");
    const indented = raw[0] === " " || raw[0] === "\t";
    const afterBullet = current.length > 0 && current[0].startsWith("- ");
    if (isBullet || (afterBullet && !indented)) flush();
    current.push(line);
  }
  flush();
  if (units.some((u) => u.startsWith("- "))) units = units.filter((u) => u.startsWith("- "));
  let used = 0;
  if (firstParagraphOnly) {
    const kept = (units.length ? sentences(units[0]) : []).filter((s) => !hasSkipMarker(s));
    const taken = [];
    for (const s of kept) {
      if (used + gcount(s) + 1 > cap) break;
      taken.push(s); used += gcount(s) + 1;
    }
    return taken.join(" ");
  }
  const out = [];
  for (const unit of units) {
    const text = strippedOfToolSentences(unit);
    if (text === null) continue;
    if (used + gcount(text) + 1 > cap) continue;
    out.push(text); used += gcount(text) + 1;
  }
  return out.join("\n");
}

/** Fails OPEN: a missing or empty required section yields "" and the caller sends the whole file. */
export function localDigest(rules, limit = LOCAL_DIGEST_LIMIT) {
  const sections = rules.split("\n## ").slice(1).map((chunk) => {
    const lines = chunk.split("\n");
    return { heading: lines[0].toLowerCase(), body: lines.slice(1).join("\n") };
  });
  const parts = [];
  for (const spec of DIGEST_SECTIONS) {
    const section = sections.find((s) => s.heading.includes(spec.heading));
    if (!section) return "";
    const text = ruleLines(section.body, spec.cap, spec.firstParagraphOnly);
    if (text === "") return "";
    parts.push(text);
  }
  return gprefix(parts.join("\n"), limit);
}

/** `rules` null = SCHEDULING.md could not be read. `text` is the whole request the app sends, not just what he said. */
export function schedulingContext({ text, routing, rules }) {
  if (!RELEVANT.test(text)) return "";
  if (rules === null || rules === undefined) return "[Scheduling memory unavailable: read SCHEDULING.md and current tasks/calendar before planning.]\n\n";
  if (servesSchedulingLocally(routing)) {
    const digest = localDigest(rules);
    if (digest !== "") return `[Nick's scheduling preferences]\n${digest}\n\n[Current user request]\n`;
  }
  return `[ORION scheduling preferences — consult with current calendar and Orion to-dos]\n${gprefix(rules, 12000)}\n\n[Current user request]\n`;
}
