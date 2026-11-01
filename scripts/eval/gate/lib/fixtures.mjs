// Premises beyond the calendar and the health numbers: what an item's notes say about memory, files, the app and the screen.
//
//   setup.knowledge  [{ title, body }]  -> notes in the brain vault (orion-brain search/read walk it live; no index to go stale),
//                                          written as `00 Inbox/gate-fixture-<slug>.md` and removed at undo.
//   setup.canary     { "rel/path": text } -> files under ~/Documents/zz-sweep-canary (the test folder), removed at undo.
//   setup.needs      [{ need, ... }]      -> premises that are checked, or that no fixture can make true. A premise that is
//                                          not applied is listed in setup.unmet with its reason; none is ever faked.
//
// Everything written is recorded in eval-fixtures.json (one of the sandbox files), so the undo, the effect diff and a
// crash recovery all know exactly which files are the gate's. The undo only ever deletes what that manifest names,
// and only inside the vault or the canary folder.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const MANIFEST = "eval-fixtures.json";
export const KNOWLEDGE_DIR = "00 Inbox";
export const KNOWLEDGE_PREFIX = "gate-fixture-";

const sha = (s) => createHash("sha1").update(s).digest("hex");
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "note";
const read = (f) => { try { return readFileSync(f, "utf8"); } catch { return null; } };

/** Needs that no fixture can make true, and why. The reason is what the grader reads. */
export const UNMET_REASONS = {
  focus_running: "the Mac app owns the focus session (orion-session is only a socket client of it; focus-state.json is the app's file and it rewrites it); a fake would be overwritten or would make the app disagree, so none is created",
  screen: "what is on Nick's screen (a window, a page, tabs, a slide) cannot be set up from outside the app; computer use sees the real screen",
  ambient: "the room, the voice stream and other people or media cannot be set up; the turn arrives as text",
  live_feed: "this is a live feed the awareness writers rewrite on their own schedule (restoring or faking it would fight them)",
  history: "this is append-only evidence (ledger, history); it is reported, never faked or rewound",
  settings: "this is a setting the app owns; the gate does not change it for a test",
  contacts: "the real contacts and messaging stay as they are; the gate never alters them for a test",
  location: "location is a live feed (location.json) owned by the phone and Mac; the item runs at the real location",
  outreach_unlinked: "the turn does not carry replyToOutreach, so no outreach row would be linked to it and the app would not put that message in the turn's context",
};

const installedIn = (dirs, app) => dirs.some((d) => existsSync(join(d, `${app}.app`)));

async function configValue(p, key) {
  const fromFile = (() => { try { return JSON.parse(read(join(p.ctrl, "life-config.json")) ?? "{}")[key]; } catch { return undefined; } })();
  if (fromFile !== undefined) return fromFile;
  try { return (await import(join(p.scripts, "lib/life/config.mjs"))).DEFAULTS?.[key]; } catch { return undefined; }
}

/** The vault note for one knowledge seed. */
export function knowledgeNote(p, note) {
  const file = `${KNOWLEDGE_PREFIX}${slug(note.title)}.md`;
  return { kind: "knowledge", path: join(p.brainVault, KNOWLEDGE_DIR, file), content: `---\ntitle: ${note.title}\ntype: note\n---\n\n# ${note.title}\n\n${String(note.body).trim()}\n` };
}

const shown = (p, f) => (f.kind === "knowledge" ? `knowledge:${relative(p.brainVault, f.path)}` : `canary:${relative(p.canary, f.path)}`);

/**
 * @returns {{ files: Array<{kind, path, content}>, applied: string[], unmet: string[] }}
 * `sessionId` is the focus session the snapshot saw (null: none running); undefined when unknown (a dry run).
 */
export async function planFixtures(p, setup, { sessionId } = {}) {
  const applied = [], unmet = [];
  const files = [
    ...(setup?.knowledge ?? []).map((n) => knowledgeNote(p, n)),
    ...Object.entries(setup?.canary ?? {}).map(([rel, content]) => ({ kind: "canary", path: join(p.canary, rel), content: String(content) })),
  ];
  for (const f of files) applied.push(shown(p, f));
  for (const n of setup?.needs ?? []) {
    const label = `${n.need}${n.detail ? `: ${n.detail}` : ""}`;
    if (UNMET_REASONS[n.need]) { unmet.push(`${label} (${UNMET_REASONS[n.need]})`); continue; }
    if (n.need === "focus_idle") {
      if (sessionId) unmet.push(`focus_idle (a real focus session ${sessionId} is running; the item cannot start from idle)`);
      else applied.push(`focus_idle (${sessionId === null ? "orion-session status reports no running session" : "checked against orion-session status when the item runs"})`);
    } else if (n.need === "apps_installed") {
      const missing = n.apps.filter((a) => !installedIn(p.appDirs ?? [], a));
      if (missing.length) unmet.push(`apps_installed: ${missing.join(", ")} not found in the application folders`);
      else applied.push(`apps_installed:${n.apps.join(",")} (found on this Mac; nothing changed)`);
    } else if (n.need === "file_exists") {
      if (existsSync(join(p.ctrl, n.file))) applied.push(`file_exists:${n.file} (already there; nothing changed)`);
      else unmet.push(`file_exists:${n.file} (missing)`);
    } else if (n.need === "config_is") {
      const value = await configValue(p, n.key);
      if (value === n.value) applied.push(`config_is:${n.key}=${n.value} (the live setting; nothing changed)`);
      else unmet.push(`config_is:${n.key}=${n.value} (the live setting is ${value === undefined ? "unreadable" : value}; it is not changed for a test)`);
    } else if (n.need === "live_true") {
      applied.push(`${label} (true on the live Mac; nothing changed)`);
    } else unmet.push(`${label} (unknown need kind)`);
  }
  return { files, applied, unmet };
}

const inside = (root, path) => { const r = resolve(root), x = resolve(path); return x === r || x.startsWith(r + sep); };
const safe = (p, path) => inside(p.brainVault, path) || inside(p.canary, path);

/** Write the manifest (first), then the fixture files. Refuses, writing nothing, if a target exists or lies outside the vault/canary. */
export function applyFixtures(p, files) {
  if (!files.length) return null;
  if (!files.every((f) => safe(p, f.path))) throw new Error("fixture path outside the vault and the canary folder");
  const clash = files.filter((f) => existsSync(f.path)).map((f) => relative(p.home, f.path));
  if (clash.length) throw new Error(`fixture file(s) already exist, not overwritten: ${clash.join(", ")}`);
  const dirs = [];
  for (const f of files) for (let d = dirname(f.path); !existsSync(d) && !dirs.includes(d); d = dirname(d)) dirs.push(d);
  const manifest = { files: files.map((f) => ({ kind: f.kind, path: f.path, sha: sha(f.content) })), dirs };
  writeFileSync(join(p.ctrl, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const f of files) { mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, f.content); }
  return manifest;
}

export function readManifest(p) { try { return JSON.parse(read(join(p.ctrl, MANIFEST)) ?? "null"); } catch { return null; } }

/** What became of each seeded file (call BEFORE the undo): kept, changed (edited by the item), or removed (forgotten, deleted). */
export function fixturesEffect(p) {
  const m = readManifest(p);
  if (!m) return [];
  return m.files.map((f) => {
    const now = read(f.path);
    return { kind: f.kind, file: shown(p, f).replace(/^[a-z]+:/, ""), status: now === null ? "removed" : sha(now) === f.sha ? "kept" : "changed" };
  });
}

/** Remove what the manifest names (only inside the vault and the canary folder), then the directories the setup created, if empty. */
export function restoreFixtures(p) {
  const m = readManifest(p);
  if (!m) return [];
  const actions = [];
  for (const f of m.files) {
    if (!safe(p, f.path)) { actions.push(`REFUSED to remove ${f.path}: outside the vault and the canary folder`); continue; }
    if (!existsSync(f.path)) continue;
    rmSync(f.path, { force: true });
    actions.push(existsSync(f.path) ? `FIXTURE NOT REMOVED ${shown(p, f)}` : `removed fixture ${shown(p, f)}`);
  }
  // Deepest first; a directory the item filled with other things stays.
  for (const d of [...(m.dirs ?? [])].sort((a, b) => b.length - a.length)) {
    if (!safe(p, d)) continue;
    try { if (existsSync(d) && readdirSync(d).length === 0) rmdirSync(d); } catch { /* not empty or gone */ }
  }
  return actions;
}

/** Problems left after the undo: any gate-fixture note still in the vault inbox, or a manifest file still on disk. */
export function fixtureProblems(p) {
  const problems = [];
  for (const f of readManifest(p)?.files ?? []) if (existsSync(f.path)) problems.push(`fixture left behind: ${relative(p.home, f.path)}`);
  try {
    for (const name of readdirSync(join(p.brainVault, KNOWLEDGE_DIR))) if (name.startsWith(KNOWLEDGE_PREFIX)) problems.push(`fixture note left in the vault: ${name}`);
  } catch { /* no inbox */ }
  return problems;
}
