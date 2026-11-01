// What orion-trash may move to the Trash, and how (wave 6, 2026-11-01; gate run-1101003318 saf-delete-folder-c).
//
// "delete junk.txt from the … folder in documents" ended in `exec rm …`, refused by the allowlist, and "you'll need to delete it
// yourself". rm is never the answer: it is not reversible. This moves one named file or folder into the Trash, and only when:
//   - it sits strictly inside ~/Desktop, ~/Documents or ~/Downloads (never one of those roots, never the home folder);
//   - no part of its path is hidden (".something"), and it is not a symlink;
//   - it is not the ORION repo, not inside it, does not contain it, and holds no .git anywhere inside;
//   - the caller passes --confirm with its exact name (the plugin does so only when Nick named it, or said yes to a question
//     that named it).
// Every move is logged in orion-controlled/trash-log.jsonl with where it came from, so `restore` can put it back.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

export const ROOTS = ["Desktop", "Documents", "Downloads"];
const MAX_SCAN = 20000;

const inside = (child, parent) => { const r = relative(parent, child); return r !== "" && !r.startsWith("..") && !r.startsWith(sep) && r !== ".."; };
const real = (p) => { try { return realpathSync(p); } catch { return p; } };

/** Does a folder hold a .git (file or folder) anywhere inside? Too big to check counts as yes. */
export function holdsGit(dir) {
  const stack = [dir];
  let seen = 0;
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === ".git") return true;
      if (++seen > MAX_SCAN) return true;
      if (e.isDirectory() && !e.isSymbolicLink()) stack.push(join(d, e.name));
    }
  }
  return false;
}

/** Why this path may not be trashed, or null when it may. Nothing here changes anything. */
export function refusal(path, { home, repo }) {
  let st;
  try { st = lstatSync(path); } catch { return "it does not exist"; }
  if (st.isSymbolicLink()) return "it is a link, not a file or folder";
  const target = real(path);
  const realHome = real(home);
  const root = ROOTS.map((r) => real(join(realHome, r))).find((r) => inside(target, r));
  if (!root) return "it is not inside your Desktop, Documents or Downloads folder";
  if (relative(root, target).split(sep).some((part) => part.startsWith("."))) return "it is a hidden file or folder";
  const realRepo = real(repo);
  if (target === realRepo || inside(target, realRepo) || inside(realRepo, target)) return "it is part of the ORION project";
  if (st.isDirectory() && holdsGit(target)) return "it holds a git repository";
  return null;
}

const countItems = (dir) => { try { return readdirSync(dir).filter((n) => !n.startsWith(".")).length; } catch { return 0; } };

/** A path as he would say it: "Documents/zz/junk.txt". */
export const shown = (path, home) => relative(real(home), real(path)) || path;

/** The facts about a candidate: kind, item count, and the refusal if any. */
export function describe(path, ctx) {
  const why = refusal(path, ctx);
  let kind = "file";
  try { kind = lstatSync(path).isDirectory() ? "folder" : "file"; } catch { /* missing: refusal says so */ }
  return { path, shown: shown(path, ctx.home), name: basename(path), kind, ...(kind === "folder" ? { items: countItems(path) } : {}), ...(why ? { refused: why } : {}) };
}

function* walk(dir, depth) {
  if (depth < 0) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    yield { path: p, isDir: e.isDirectory() };
    if (e.isDirectory() && !existsSync(join(p, ".git"))) yield* walk(p, depth - 1);
  }
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, "");
/** Files or folders with this name under the allowed roots (or one of them), optionally inside a folder with a given name. */
export function findByName(name, { home, root, within, depth = 4 }) {
  const want = norm(name);
  const roots = (root ? ROOTS.filter((r) => r.toLowerCase() === root.toLowerCase()) : ROOTS).map((r) => join(home, r));
  const hits = [];
  for (const r of roots) {
    for (const { path } of walk(r, depth)) {
      if (norm(basename(path)) !== want) continue;
      if (within && !relative(r, dirname(path)).split(sep).some((part) => norm(part) === norm(within))) continue;
      hits.push(path);
      if (hits.length >= 10) return hits;
    }
  }
  return hits;
}

/** Move it into the Trash (a unique name there), after every check, and log it. */
export function moveToTrash(path, { home, repo, trashDir, controlledDir, confirm, now = new Date() }) {
  const why = refusal(path, { home, repo });
  if (why) return { ok: false, refused: why };
  if (!confirm || confirm.trim().toLowerCase() !== basename(path).toLowerCase()) return { ok: false, refused: "it needs a confirmation that names it" };
  mkdirSync(trashDir, { recursive: true });
  const name = basename(path);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const to = existsSync(join(trashDir, name)) ? join(trashDir, `${name} ${stamp}`) : join(trashDir, name);
  try { renameSync(path, to); } catch (error) { return { ok: false, refused: `the move failed (${error?.code ?? "error"}); nothing was changed` }; }
  const row = { id: stamp, from: path, to, at: now.toISOString() };
  try { mkdirSync(controlledDir, { recursive: true }); appendFileSync(join(controlledDir, "trash-log.jsonl"), `${JSON.stringify(row)}\n`); } catch { /* the move stands; the Trash still has it */ }
  return { ok: true, from: shown(path, home), to, id: stamp };
}

/** Put a trashed item back where it came from, unless something is already there. */
export function restoreFromTrash(row) {
  if (!row || !existsSync(row.to)) return { ok: false, refused: "it is no longer in the Trash" };
  if (existsSync(row.from)) return { ok: false, refused: "something with that name is already back in its place" };
  mkdirSync(dirname(row.from), { recursive: true });
  renameSync(row.to, row.from);
  return { ok: true, restored: row.from };
}
