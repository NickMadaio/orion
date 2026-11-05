/*
 The last pass over every reply (w20 round 6; made surgical after review r6). Only shapes that are unambiguously OUR internal text are cut:
   - the tool-result envelope fields that leaked in live gate 4 #45 (`"outcome": "NOTHING WAS DONE. ...",`, `"executed": false`, `"isError": true`, ...),
   - `[object Object]` (and the parenthetical it sits in),
   - one of OUR tool ids (a closed list: media_play_pause, orion_task_run, tool_call, ...) named as a tool, and our own script paths.
 Never touched: anything inside a code span, a fenced block or a URL; the words undefined / NaN / null in running prose; any other JSON or key he
 may have asked for; an `orion-…` script name used as an instruction. When he asked for code, JSON, a script or a tool, nothing is touched at all
 (`asked`). A reply is never replaced: LEAK_FALLBACK is only for text that was nothing but a leak. Pure and idempotent.
*/
export const LEAK_FALLBACK = "I couldn't finish that just now.";

/** Our own tool ids, exactly. Anything else that merely looks like snake_case is prose or code. */
const TOOL_IDS = ["orion_task_run", "tool_call", "tool_search", "tool_describe", "media_play_pause", "media_next_track", "media_previous_track", "browser_open_url", "app_open", "app_quit", "folder_open",
  "alarm_set", "timer_set", "weather_now", "volume_set", "reminder_cancel", "reminder_list", "apple_reminder_add", "supplement_add", "supplement_update", "supplement_remove", "supplement_take", "supplement_status", "messages_send"];
const TOOL_ID = new RegExp(`\\b(?:${TOOL_IDS.join("|")})\\b`);
const TOOL_PHRASE = new RegExp(`(?:the |a |an |my )?(?:${TOOL_IDS.join("|")})(?: tool| function| action| command)?`, "g");
/** A sentence that tells him to use one of our tools ("you can use the media_play_pause tool to control playback"): the id becomes "that", the rest stays. */
const TOOL_USE = new RegExp(`\\b(?:use|using|call|calling|run|running|try|via|through|with)\\s+(?:the |a |an |my )?(?:${TOOL_IDS.join("|")})\\b|\\b(?:${TOOL_IDS.join("|")}) (?:tool|function|action)\\b`, "i");
/** Our own script path. */
const SCRIPT_PATH = /(?:~|\/Users\/[A-Za-z0-9._-]+)\/Desktop\/ORION\/(?:\.claude\/worktrees\/[A-Za-z0-9._-]+\/)?scripts\/orion-[a-z0-9-]+/g;
/** A script name only where it is clearly a log of what ran ("I ran orion-reschedule", "(orion-food-estimate gave no answer)"), never as an instruction. */
const SCRIPT_LOG = /(?:\bI (?:ran|called|used)\s+|\()orion-[a-z][a-z0-9-]*(?=\s+(?:gave|returned|exited|failed|refused|said|printed|timed|didn'?t|did not|isn'?t|is not|not found)\b)|\b(?:I (?:ran|called|used)\s+)orion-[a-z][a-z0-9-]*/g;
/** The envelope fields of a tool result, as leaked: only our keys, with a string, number or boolean value. */
const ENVELOPE_KEYS = "outcome|executed|isError|is_error|exitCode|exit_code|stdout|stderr|nothingChanged|nothing_changed";
const ENVELOPE_FIELD = new RegExp(String.raw`\s*"(?:${ENVELOPE_KEYS})"\s*:\s*(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)\s*,?`, "g");
const OBJECT_OBJECT = /\s*\([^)]*\[object [A-Za-z]+\][^)]*\)|[,;]?\s*\b[A-Za-z ]{1,24}:\s*\[object [A-Za-z]+\]|\[object [A-Za-z]+\]/g;

/** Splits a reply into protected spans (code, fences, URLs: never touched) and plain text. */
function parts(text: string): Array<{ protect: boolean; text: string }> {
  const out: Array<{ protect: boolean; text: string }> = [];
  const re = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s)]+|www\.[^\s)]+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ protect: false, text: text.slice(last, m.index) });
    out.push({ protect: true, text: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ protect: false, text: text.slice(last) });
  return out;
}

const tidy = (s: string): string => s.replace(/\(\s*\)/g, "").replace(/\s+([.,;:!?])/g, "$1").replace(/:\s*([.!?])/g, "$1").replace(/:\s*,/g, ",").replace(/([.,;])\1+/g, "$1").replace(/[ \t]{2,}/g, " ");

function clean(plain: string): string {
  let s = plain;
  s = s.replace(ENVELOPE_FIELD, " ").replace(OBJECT_OBJECT, "");
  s = s.replace(SCRIPT_PATH, "that").replace(SCRIPT_LOG, (m) => m.replace(/orion-[a-z][a-z0-9-]*/, "that"));
  if (TOOL_ID.test(s)) s = s.replace(TOOL_PHRASE, "that").replace(/\bthat(?:\s+that)+\b/g, "that");
  return s;
}

/** The reply with our internal shapes cut out. `asked`: he asked about code, JSON, scripts or tools, so nothing is touched. */
export function finalSanitize(text: string, opts: { asked?: boolean } = {}): string {
  const original = String(text ?? "");
  if (!original.trim() || opts.asked) return original;
  const pieces = parts(original);
  const cleaned = pieces.map((p) => (p.protect ? p.text : clean(p.text)));
  if (cleaned.every((c, i) => c === pieces[i]!.text)) return original;
  const out = tidy(cleaned.join("")).trim();
  return /[A-Za-z0-9]/.test(out) ? out : LEAK_FALLBACK;
}

/** He is asking about code, data or our tools: leave every word of the answer alone. */
export const askedForTechnical = (message: string | undefined): boolean =>
  !!message && /\b(?:json|code|script|snippet|regex|function|javascript|typescript|python|api|payload|syntax|tool|tools|command|commands|stack ?trace|debug)\b/i.test(message);

export { TOOL_USE };
