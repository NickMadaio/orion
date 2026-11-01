// The brain vault (~/Documents/orionBrain): every .md an item could write (orion-remember and orion-brain learn put
// preferences in "20 Areas/Me/Nick.md" and under "20 Areas/Learned/", and may create notes anywhere) is snapshotted,
// reported as an effect when it changes, and put back at undo. New files are removed, directories the item created
// are removed when empty. Dot directories (.obsidian, .git, ...) are not the vault's notes and are left alone.
// REV6 item 7: what the restore removes or overwrites may be Nick's own (a daily note, an edit made in the item's window), so
// every such version is first copied to orion-controlled/gate-vault-quarantine/<run>/<same path> and the report names it.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const clip = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}...` : s);

function walk(root, dir = root, out = { files: [], dirs: [] }) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) { out.dirs.push(relative(root, path)); walk(root, path, out); } else if (e.name.endsWith(".md")) out.files.push(relative(root, path));
  }
  return out;
}

/** { files: { "<rel>.md": text }, dirs: [rel] } as the vault is now. */
export function vaultSnapshot(p) {
  const { files, dirs } = walk(p.brainVault);
  return { files: Object.fromEntries(files.map((f) => [f, readFileSync(join(p.brainVault, f), "utf8")])), dirs };
}

const lines = (t) => (t ?? "").split("\n").filter((l) => l.trim());

/** What changed between two snapshots: created files, changed files (lines added/removed), deleted files. */
export function vaultDelta(before, after) {
  const names = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort();
  const out = { created: [], changed: [], deleted: [] };
  for (const f of names) {
    const a = before.files[f], b = after.files[f];
    if (a === b) continue;
    if (a === undefined) out.created.push({ path: f, lines: lines(b).slice(0, 40).map((l) => clip(l)) });
    else if (b === undefined) out.deleted.push({ path: f });
    else {
      const was = new Set(lines(a)), is = new Set(lines(b));
      out.changed.push({ path: f, added: lines(b).filter((l) => !was.has(l)).map((l) => clip(l)).slice(0, 40), removed: lines(a).filter((l) => !is.has(l)).map((l) => clip(l)).slice(0, 40) });
    }
  }
  return out;
}

export const vaultChanged = (d) => Boolean(d.created.length || d.changed.length || d.deleted.length);

/** The quarantine folder for one run: a single safe path segment under orion-controlled. */
export const quarantineDir = (p, runId) => join(p.ctrl, "gate-vault-quarantine", String(runId || new Date().toISOString()).replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "") || "run");

/** Copy the version about to be removed or overwritten into the quarantine; a failed copy means the note is left as it is. */
function quarantine(p, runId, f, text) {
  const to = join(quarantineDir(p, runId), f);
  try { mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, text); return to; } catch { return null; }
}

/** Put the vault's notes back to `snap`, quarantining every version it removes or overwrites. Returns what it did. */
export function restoreVault(p, snap, { runId } = {}) {
  const now = vaultSnapshot(p);
  const actions = [];
  for (const f of Object.keys(now.files)) {
    if (snap.files[f] !== undefined) continue;
    const kept = quarantine(p, runId, f, now.files[f]);
    if (!kept) { actions.push(`NOT REMOVED new vault note ${f}: it could not be quarantined first`); continue; }
    rmSync(join(p.brainVault, f), { force: true });
    actions.push(`removed new vault note ${f} (quarantined to ${kept})`);
  }
  for (const [f, text] of Object.entries(snap.files)) {
    if (now.files[f] === text) continue;
    if (now.files[f] !== undefined) {
      const kept = quarantine(p, runId, f, now.files[f]);
      if (!kept) { actions.push(`NOT RESTORED vault note ${f}: its current version could not be quarantined first`); continue; }
      actions.push(`quarantined the changed vault note ${f} to ${kept}`);
    }
    mkdirSync(dirname(join(p.brainVault, f)), { recursive: true });
    writeFileSync(join(p.brainVault, f), text);
    actions.push(`${now.files[f] === undefined ? "recreated" : "restored"} vault note ${f}`);
  }
  // Directories the item created, deepest first, only when empty.
  const had = new Set(snap.dirs);
  for (const d of [...now.dirs].filter((x) => !had.has(x)).sort((a, b) => b.length - a.length)) {
    try { if (existsSync(join(p.brainVault, d)) && readdirSync(join(p.brainVault, d)).length === 0) { rmdirSync(join(p.brainVault, d)); actions.push(`removed new vault folder ${d}`); } } catch { /* in use */ }
  }
  return actions;
}

/** Differences left between the vault and `snap`. */
export function vaultProblems(p, snap) {
  const d = vaultDelta(snap, vaultSnapshot(p));
  return [...d.created.map((x) => `vault note left: ${x.path}`), ...d.changed.map((x) => `vault note differs: ${x.path}`), ...d.deleted.map((x) => `vault note missing: ${x.path}`)];
}
