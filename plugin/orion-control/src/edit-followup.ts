/*
 Edit-style follow-ups (live run 4, 2026-10-21): "lunch 45 min today at 1pm" started a focus session, then "make it an hour" RESTARTED it.
 "make it an hour", "make it 30", "longer", "shorter" are about the LAST thing ORION created or changed in this chat:
   - a calendar block: `resize` it to the new length (same start);
   - a focus session just started: said plainly, because a running session's length cannot be changed (orion-session has no such command)
     and a restart would end the one he is in; never a new session.
 With nothing on record it asks what he means. A bare "longer"/"shorter" with no amount asks how much.
*/
import { takeLength } from "./intent-time.js";
import { writesIn } from "./time-backstop.js";

export type EditTarget =
  | { kind: "block"; title: string; dateArgs: string[]; minutes?: number; at: number }
  | { kind: "session"; task: string; at: number };
export type EditRequest = { minutes?: number; delta?: number; direction?: "longer" | "shorter" };

const LEAD = /^(?:(?:ok(?:ay)?|actually|no|nah|wait|and|so|please|pls|just|hmm+|um+|can you|can u|could you)[,.\s]+)*/i;
const MAKE = /^(?:make|change|set)\s+(?:it|that|this|the (?:block|session|one))\s+(?:to\s+)?(?<len>.+?)\s*(?:instead|then|please|pls)?[.!]*$/i;
const BARE = /^(?:(?:make\s+(?:it|that)\s+)?(?:a\s+(?:bit|little)\s+|a lot\s+|much\s+)?(?<dir>longer|shorter)|(?:add|give it)\s+(?<more>.+?)\s+more)[.!]*$/i;

/** "make it an hour" -> { minutes: 60 }, "make it 30" -> { minutes: 30 }, "longer" -> { direction }, "make it 15 min longer" -> { delta: 15 }. */
export function parseEdit(message: string): EditRequest | undefined {
  const text = message.trim().replace(LEAD, "").trim();
  const bare = text.match(BARE);
  if (bare?.groups?.dir) return { direction: bare.groups.dir.toLowerCase() as "longer" | "shorter" };
  if (bare?.groups?.more) { const l = takeLength(bare.groups.more); return l.minutes && !l.rest ? { delta: l.minutes } : undefined; }
  const m = text.match(MAKE);
  if (!m?.groups) return undefined;
  const len = m.groups.len!.trim();
  const rel = len.match(/^(?<n>.+?)\s+(?<dir>longer|shorter)$/i);
  if (rel?.groups) { const l = takeLength(rel.groups.n!); return l.minutes && !l.rest ? { delta: /shorter/i.test(rel.groups.dir!) ? -l.minutes : l.minutes } : undefined; }
  // "make it 30" is 30 minutes; "change it to 6" is six o'clock (a reminder's correction), never a 6-minute block.
  if (/^\d{1,3}$/.test(len)) { const n = Number(len); return n >= 15 && n <= 480 ? { minutes: n } : undefined; }
  const l = takeLength(len);
  return l.minutes && !l.rest ? { minutes: l.minutes } : undefined;
}
export const isEdit = (message: string): boolean => !!parseEdit(message);

/** The block a calendar change just wrote, from its own call and output (what "make it an hour" means next). */
export function blockTarget(calls: string[], outputs: string[], at: number): EditTarget | undefined {
  const argv = calls.flatMap((c) => writesIn(c)).find((a) => ["add", "move", "resize", "extend", "day", "now"].includes(a[0] ?? ""));
  if (!argv) return undefined;
  const title = argv[0] === "day" ? (argv[2] ?? "").split(",")[0]!.trim() : argv[1];
  if (!title) return undefined;
  const d = argv.indexOf("--date");
  const out = outputs.join("\n");
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const span = out.match(new RegExp(String.raw`(?:planned ${esc}|${esc} moved|${esc} is now \d+ min)[^\n]*?(\d{2}):(\d{2})–(\d{2}):(\d{2})`, "i"));
  const minutes = span ? (Number(span[3]) * 60 + Number(span[4])) - (Number(span[1]) * 60 + Number(span[2])) : undefined;
  return { kind: "block", title, dateArgs: d >= 0 && argv[d + 1] ? ["--date", argv[d + 1]!] : [], ...(minutes && minutes > 0 ? { minutes } : {}), at };
}

/** The new length for the block, or what to ask. */
export function editLength(req: EditRequest, current?: number): { minutes: number } | { ask: string } {
  if (req.minutes) return { minutes: req.minutes };
  if (req.delta !== undefined && current) return { minutes: current + req.delta };
  return { ask: `How much ${req.direction ?? "longer"}${current ? `? It's ${current} minutes now` : "? Tell me the length, like \"make it an hour\""}. I haven't changed anything.` };
}

export const SESSION_EDIT = (task: string): string =>
  `Your ${task === "Focus" ? "focus" : `${task}`} session is already running, and I can't change its length without ending it, so I've left it as it is. Say "finish" when you're done, or tell me if you meant a calendar block.`;
export const NOTHING_TO_EDIT = "Make what longer or shorter? I haven't changed anything. Tell me which block and how long it should be.";
