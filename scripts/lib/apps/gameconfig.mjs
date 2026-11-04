// The files game mode lives in, under ~/.openclaw/orion-controlled (tests pass a temp dir):
//   game-prep.json     { version, autoPrep, keep: [app names], always: [names he added], alwaysIds: [bundle ids] }: written here and by the Mac app's setting;
//                      reading never creates it. keep is the game list (defaults included); always is only what he added, and is also spared by quit-unused and bedtime.
//   game-session.json  { version, active, game, pids, startedAt, endedAt, prep: {...} }: the Mac app writes the session part, orion-apps the prep part.
//                      Each writer re-reads before it writes (tmp + rename), so neither drops the other's keys.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { norm } from "./policy.mjs";
import { resolveAppName, sameUpToTypo } from "./resolve.mjs";

export const DEFAULT_KEEP = ["Discord", "Spotify", "Music", "Zoom", "FaceTime", "Microsoft Teams", "Skype", "Mumble", "TeamSpeak"];

export const controlledDir = () => process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw", "orion-controlled");

function readJson(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${name}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, join(dir, name));
}

const strings = (x) => (Array.isArray(x) ? x.filter((k) => typeof k === "string" && k.trim()) : []);
export function loadConfig(dir) {
  const j = readJson(join(dir, "game-prep.json")) ?? {};
  const keep = Array.isArray(j.keep) ? strings(j.keep) : DEFAULT_KEEP;
  return { version: 1, autoPrep: j.autoPrep !== false, keep, always: strings(j.always), alwaysIds: strings(j.alwaysIds) };
}
const saveConfig = (dir, c) => writeJson(dir, "game-prep.json", { version: 1, autoPrep: c.autoPrep, keep: c.keep, always: c.always ?? [], alwaysIds: c.alwaysIds ?? [] });

/** What is spared everywhere (quit-unused, bedtime), not only when he games: the apps he asked to keep open, by name and bundle id. */
export function alwaysKept(dir) { const { always, alwaysIds } = loadConfig(dir); return { names: always, ids: alwaysIds }; }

const list = (xs) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const title = (s) => s.trim().replace(/\s+/g, " ");
const has = (xs, name) => xs.some((x) => norm(x) === norm(name) || sameUpToTypo(x, name));

/** A typed name becomes the real app's name when one is installed or running ("vorsaint" -> Vorssaint); otherwise it stays as he typed it. */
function resolved(names, candidates, bundleIdOf) {
  return names.map(title).filter(Boolean).map((typed) => {
    const hit = resolveAppName(typed, candidates);
    return { name: hit?.name ?? typed, bundleId: hit?.bundleId || (hit?.path && bundleIdOf ? bundleIdOf(hit.path) : "") };
  });
}

export function addKeep(dir, names, { candidates = [], bundleIdOf } = {}) {
  const c = loadConfig(dir);
  const picks = resolved(names, candidates, bundleIdOf);
  const shown = [...new Set(picks.map((p) => p.name))];
  const fresh = picks.filter((p, i) => picks.findIndex((q) => norm(q.name) === norm(p.name)) === i);
  const addedAlways = fresh.filter((p) => !has(c.always, p.name));
  const addedKeep = fresh.filter((p) => !has(c.keep, p.name));
  const ids = [...c.alwaysIds, ...addedAlways.map((p) => p.bundleId).filter((id) => id && !c.alwaysIds.includes(id))];
  const keep = [...c.keep, ...addedKeep.map((p) => p.name)], always = [...c.always, ...addedAlways.map((p) => p.name)];
  if (addedAlways.length || addedKeep.length) saveConfig(dir, { ...c, keep, always, alwaysIds: ids });
  return { ok: true, changed: addedAlways.length > 0 || addedKeep.length > 0, keep, always,
    say: addedAlways.length ? `I'll always leave ${list(addedAlways.map((p) => p.name))} open.` : `${list(shown)} ${shown.length > 1 ? "are" : "is"} already on the list I always leave open.` };
}

export function removeKeep(dir, names, { candidates = [], bundleIdOf } = {}) {
  const c = loadConfig(dir);
  const picks = resolved(names, candidates, bundleIdOf);
  const drops = (k) => picks.some((p) => norm(p.name) === norm(k) || sameUpToTypo(p.name, k));
  const gone = [...new Set([...c.keep, ...c.always].filter(drops))];
  const keep = c.keep.filter((k) => !drops(k)), always = c.always.filter((k) => !drops(k));
  const goneIds = picks.map((p) => p.bundleId).filter(Boolean);
  const alwaysIds = c.alwaysIds.filter((id) => !goneIds.includes(id));
  if (gone.length) saveConfig(dir, { ...c, keep, always, alwaysIds });
  return { ok: true, changed: gone.length > 0, keep, always,
    say: gone.length ? `Okay, ${list(gone)} can close again.` : `${list(picks.map((p) => p.name))} wasn't on the keep list.` };
}

/** The reply to "what do you always keep open": his own list first, then the apps game mode leaves alone by default. */
export function keepListSay(config) {
  const game = config.keep.filter((k) => !has(config.always, k));
  const mine = config.always.length ? `I always leave ${list(config.always)} open.` : "You haven't asked me to always keep anything open, so nothing is on the always list.";
  const defaults = game.length ? ` When you game I also leave ${list(game)} alone.` : "";
  return `${mine}${defaults}`;
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
