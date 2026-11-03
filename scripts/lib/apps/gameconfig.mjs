// The files game mode lives in, under ~/.openclaw/orion-controlled (tests pass a temp dir):
//   game-prep.json     { version, autoPrep, keep: [app names] }: written here and by the Mac app's setting; reading never creates it
//   game-session.json  { version, active, game, pids, startedAt, endedAt, prep: {...} }: the Mac app writes the session part, orion-apps the prep part.
//                      Each writer re-reads before it writes (tmp + rename), so neither drops the other's keys.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { norm } from "./policy.mjs";

export const DEFAULT_KEEP = ["Discord", "Spotify", "Music", "Zoom", "FaceTime", "Microsoft Teams", "Skype", "Mumble", "TeamSpeak"];

export const controlledDir = () => process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw", "orion-controlled");

function readJson(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${name}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, join(dir, name));
}

export function loadConfig(dir) {
  const j = readJson(join(dir, "game-prep.json")) ?? {};
  const keep = Array.isArray(j.keep) ? j.keep.filter((k) => typeof k === "string" && k.trim()) : DEFAULT_KEEP;
  return { version: 1, autoPrep: j.autoPrep !== false, keep };
}
const saveConfig = (dir, c) => writeJson(dir, "game-prep.json", { version: 1, autoPrep: c.autoPrep, keep: c.keep });

const list = (xs) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const title = (s) => s.trim().replace(/\s+/g, " ");

export function addKeep(dir, names) {
  const c = loadConfig(dir);
  const have = new Set(c.keep.map(norm));
  const added = [];
  for (const n of names.map(title).filter(Boolean)) if (!have.has(norm(n))) { have.add(norm(n)); added.push(n); }
  const shown = names.map(title).filter(Boolean);
  if (added.length) saveConfig(dir, { ...c, keep: [...c.keep, ...added] });
  return { ok: true, changed: added.length > 0, keep: [...c.keep, ...added],
    say: added.length ? `Got it, I won't close ${list(added)} when you game.` : `${list(shown)} ${shown.length > 1 ? "are" : "is"} already on the list I leave alone when you game.` };
}

export function removeKeep(dir, names) {
  const c = loadConfig(dir);
  const drop = names.map((n) => norm(n)).filter(Boolean);
  const gone = c.keep.filter((k) => drop.includes(norm(k)));
  const keep = c.keep.filter((k) => !gone.includes(k));
  if (gone.length) saveConfig(dir, { ...c, keep });
  return { ok: true, changed: gone.length > 0, keep,
    say: gone.length ? `Okay, ${list(gone)} can close when you game.` : `${list(names.map(title))} wasn't on the keep list.` };
}

export function setAutoPrep(dir, on) {
  const c = loadConfig(dir);
  saveConfig(dir, { ...c, autoPrep: on });
  return { ok: true, autoPrep: on, say: on ? "Okay, I'll get your Mac ready whenever a game opens." : "Okay, I won't close anything when a game opens. Mouse shortcuts still pause while you're gaming." };
}

export const loadSession = (dir) => readJson(join(dir, "game-session.json"));
export function updateSession(dir, change) {
  const next = change(loadSession(dir) ?? { version: 1, active: false });
  writeJson(dir, "game-session.json", next);
  return next;
}

const gb = (bytes) => { const g = bytes / 1e9; return g >= 1.5 ? `${Math.round(g)} GB` : g >= 0.1 ? `${g.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`; };
export const freedText = (bytes) => `~${gb(bytes)}`;

/** The reply to "what did you close": the last prep in game-session.json. */
export function lastPrepSay(session) {
  const p = session?.prep;
  if (!p || (!p.closed?.length && !p.reported?.length && !p.unloaded?.length)) return "I haven't closed anything for a game yet.";
  const game = session.game?.name ? ` for ${session.game.name}` : "";
  const parts = [];
  if (p.closed?.length) parts.push(`I closed ${list(p.closed.map((c) => c.name))}${p.helperCount ? ` and ${p.helperCount} helper${p.helperCount === 1 ? "" : "s"}` : ""}`);
  if (p.unloaded?.length) parts.push(`${parts.length ? "unloaded" : "I unloaded"} the idle models ${list(p.unloaded.map((m) => m.name))}`);
  if (p.freedBytes > 1e8) parts.push(`freed ${freedText(p.freedBytes)}`);
  const left = p.reported?.length ? ` I left ${list(p.reported.map((r) => `${r.name} (${r.why})`))} open for you.` : "";
  return `Last time${game}, ${parts.join(", ") || "I closed nothing"}.${left}`;
}
export const configExists = (dir) => existsSync(join(dir, "game-prep.json"));
