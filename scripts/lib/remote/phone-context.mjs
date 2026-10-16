// The small phone context (r8b2, 2026-10-16). Under local routing the worker has its own tuned
// system prompt, and a real phone turn carried ~18.6k chars of injected text in the USER message
// (the whole SCHEDULING.md, the day rules, the channel brief): 14,894 input tokens, 0 cache reads,
// median 15.8 s. This builds only what one turn needs. The cloud path keeps the full text.
//
// Everything here counts as something Nick said (the host records it as one user turn), so no word
// from catalog.ts AUTHORITY_INSTRUCTION may appear in it — tests/remote-phone-context.test.mjs
// matches the built message against that regex itself. Nick's words stay last, after the marker
// "--- Nick's message follows ---", which the plugin's userText (local-routing.ts MARKERS) splits on.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const MARKER = "--- Nick's message follows ---";

/**
 * True when the plugin routes locally: localRouting "on" in openclaw.json (plugins.entries.orion-control.config). Since
 * 2026-10-16 (278d75e, "local always") the plugin has no acceptance gate and no testing window, so neither does this
 * (review 5 M4 had mirrored the old gate). Otherwise the configured model answers and needs the full text.
 */
export function localRoutingOn(home) {
  try {
    return JSON.parse(readFileSync(join(home, ".openclaw/openclaw.json"), "utf8"))?.plugins?.entries?.["orion-control"]?.config?.localRouting === "on";
  } catch { return false; }
}

// Word stems, like the plugin's SCHEDULING pattern: a miss only costs the model one rule line.
const DAY = /\b(schedul|plan|calendar|day\b|today|tonight|tomorrow|morning|afternoon|evening|block|move|push|pull|swap|resiz|extend|shorten|shorter|longer|clear|drop|skip|free|fit|slot|book|class|lab\b|lectur|stud|gym|nap|dinner|lunch|breakfast|meeting|late|overrun|running over|break|task|to-?do|due|deadline|reschedul|undo)\w*|\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i;
const CHECKIN = /\b(later|delay|push|start|starting|finish|finished|done|back in|after|because|check.?in|one more|minutes?|mins?|hour)\b/i;
const APPS = /\b(apps?|open|launch|running|installed|quit|close|show|tab|page|screen|window|browser|safari|chrome)\b/i;
const LOCK = /\b(lock|locked|unlock|unblock|screen ?time|apps?|extra time|phone time|block(ed)?)\b/i;

export const relevance = (text) => ({
  day: DAY.test(text), checkin: CHECKIN.test(text), apps: APPS.test(text), lock: LOCK.test(text),
});

const DAY_RULE = [
  "- His day: ONE orion-reschedule call (move \"X\" --to HH:MM | --by 30; extend; resize; swap; drop; skip; now; late; overrun; tidy; day --plan \"<title>, <min>[, HH:MM][, fixed]\").",
  "  Name blocks with HIS words; HH:MM only if he said a time; never retype the day to change one block; nothing in \"Earlier today\" is re-planned.",
  "  Schedule changes never use the generic calendar actions. Report only what the output says was written; SHIFTED / SHRUNK / NOT BOOKED means tell him.",
  "  Planning or priorities: read ~/.openclaw/workspace/SCHEDULING.md (the read tool, or cat) when planning.",
].join("\n");

const CHECKIN_RULE = (checkin) => `- Closing the loop: delayed with a reason → ${checkin} add <min> "<what>" --because "<reason>"; starting → started; finished → done; plans changed → cancel. "Later" is not a reason: add a short check-in anyway.`;

const APP_RULE = (show) => `- ORION's own app is the native Mac app Orion.app, not a website: never open a localhost address for it. Tabs: Home, Tasks, Projects, Health, Finances, Brand, Settings. Show one with ${show} <tab>. Before saying an app is not installed, try app_open.`;

// Only facts about this channel, no word from the authority gate (see the header).
export const COMPACT_PHONE_BRIEF = [
  "[orion-remote] Context from the transport, not from Nick:",
  "This message arrived from the ORION app on Nick's iPhone. Same conversation as the Mac app; he may not be at the Mac. Keep replies short, plain text.",
  "The remote channel is ALREADY working: never offer to configure or repair it.",
  "status, pause, resume, cancel, approve, deny, priority, device, apps, files, agent are handled by the transport before you see them: never claim to have run them.",
  "You cannot create or approve an approval id; never invent one. If you have none in front of you, say there is no pending approval.",
  MARKER,
].join("\n");

/**
 * The compact phone message. `parts` are the live facts the caller read (strings or null):
 * today, checkins, apps (array of names), lock, watch, outreach, testClock, savedNote.
 */
export function compactPhoneMessage({ text, parts, paths }) {
  const need = relevance(text);
  return [
    "[orion-remote] Live facts for this message (read just now, not from Nick):",
    parts.testClock,
    parts.today,
    parts.checkins,
    need.lock ? parts.lock : null,
    parts.watch,
    parts.outreach,
    need.apps ? (parts.apps?.length ? `- Apps open on the Mac: ${parts.apps.join(", ")}.` : null) : null,
    need.apps ? APP_RULE(paths.show) : null,
    need.day ? DAY_RULE : "- Planning or the day: read ~/.openclaw/workspace/SCHEDULING.md (the read tool, or cat) when planning.",
    need.checkin || need.day ? CHECKIN_RULE(paths.checkin) : null,
    parts.savedNote ? parts.savedNote.trimEnd() : null,
    COMPACT_PHONE_BRIEF,
    text,
  ].filter(Boolean).join("\n");
}
