// Wave 6 (2026-11-01): orion-trash moves one named item into the Trash, never with rm, only inside Desktop/Documents/Downloads,
// never hidden, the repo, or anything holding .git, only with a confirmation naming it, and logged so it can come back.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TRASH = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-trash");

function home() {
  const h = mkdtempSync(join(tmpdir(), "orion-trash-"));
  const canary = join(h, "Documents", "zz-canary");
  mkdirSync(join(canary, "old-notes"), { recursive: true });
  mkdirSync(join(canary, "keep"), { recursive: true });
  writeFileSync(join(canary, "junk.txt"), "junk");
  writeFileSync(join(canary, "old-notes", "a.md"), "a");
  mkdirSync(join(h, "Documents", "proj", "src"), { recursive: true });
  mkdirSync(join(h, "Documents", "proj", ".git"));
  mkdirSync(join(h, "Documents", ".secret"), { recursive: true });
  writeFileSync(join(h, "Documents", ".secret", "x.txt"), "x");
  mkdirSync(join(h, "Desktop", "ORION", "scripts"), { recursive: true });
  mkdirSync(join(h, "Library"), { recursive: true });
  writeFileSync(join(h, "Library", "prefs.txt"), "p");
  const run = (...args) => {
    const r = spawnSync(process.execPath, [TRASH, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: h, ORION_TRASH_DIR: join(h, ".Trash"), ORION_CONTROLLED_DIR: join(h, "ctl"), ORION_REPO_DIR: join(h, "Desktop", "ORION") } });
    return { status: r.status, json: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr };
  };
  return { h, canary, run };
}

test("find locates a named file inside a named folder, and says what it is", () => {
  const { run } = home();
  const out = run("find", "junk.txt", "--root", "documents", "--in", "zz-canary").json;
  assert.equal(out.matches.length, 1);
  assert.deepEqual([out.matches[0].shown, out.matches[0].kind, out.matches[0].refused], ["Documents/zz-canary/junk.txt", "file", undefined]);
  const folder = run("find", "old-notes").json.matches[0];
  assert.deepEqual([folder.kind, folder.items], ["folder", 1]);
});

test("move needs a confirmation that names the item; with it the file goes to the Trash and nothing else changes", () => {
  const { h, canary, run } = home();
  const path = join(canary, "junk.txt");
  assert.match(run("move", path).json.refused, /confirmation/);
  assert.match(run("move", path, "--confirm", "old-notes").json.refused, /confirmation/);
  assert.ok(existsSync(path));
  const out = run("move", path, "--confirm", "junk.txt").json;
  assert.equal(out.ok, true);
  assert.ok(!existsSync(path));
  assert.ok(existsSync(join(h, ".Trash", "junk.txt")));
  assert.ok(existsSync(join(canary, "old-notes", "a.md")) && existsSync(join(canary, "keep")));
  const back = run("restore", out.id).json;
  assert.equal(back.ok, true);
  assert.equal(readFileSync(path, "utf8"), "junk");
  assert.match(readFileSync(join(h, "ctl", "trash-log.jsonl"), "utf8"), /junk\.txt/);
});

test("refuses outside the three folders, the roots themselves, hidden items, git repos, the ORION repo and links", () => {
  const { h, run } = home();
  const refused = (p, name) => run("move", p, "--confirm", name).json.refused;
  assert.match(refused(join(h, "Library", "prefs.txt"), "prefs.txt"), /not inside/);
  assert.match(refused(join(h, "Documents"), "Documents"), /not inside/);
  assert.match(refused(h, h.split("/").pop()), /not inside/);
  assert.match(refused(join(h, "Documents", ".secret", "x.txt"), "x.txt"), /hidden/);
  assert.match(refused(join(h, "Documents", "proj"), "proj"), /git/);
  assert.match(refused(join(h, "Desktop", "ORION"), "ORION"), /ORION/);
  assert.match(refused(join(h, "Desktop", "ORION", "scripts"), "scripts"), /ORION/);
  symlinkSync(join(h, "Library"), join(h, "Documents", "lib-link"));
  assert.match(refused(join(h, "Documents", "lib-link"), "lib-link"), /link/);
  assert.match(refused(join(h, "Documents", "nope.txt"), "nope.txt"), /does not exist/);
  assert.ok(existsSync(join(h, "Library", "prefs.txt")) && existsSync(join(h, "Documents", "proj", ".git")));
});

test("a relative path or a path given to find is a usage error", () => {
  const { run } = home();
  assert.equal(run("move", "Documents/zz-canary/junk.txt", "--confirm", "junk.txt").status, 2);
  assert.equal(run("find", "../etc/passwd").status, 2);
});

// REV6 item 2: the brain vault (an allowed root, not hidden, no .git) was trashable: "delete Nick.md" moved a vault note at once.
test("the brain vault and anything holding it are refused, at the default place and at ORION_BRAIN_VAULT", () => {
  const { h, run } = home();
  mkdirSync(join(h, "Documents", "orionBrain", "20 Areas", "Me"), { recursive: true });
  writeFileSync(join(h, "Documents", "orionBrain", "20 Areas", "Me", "Nick.md"), "# Nick");
  const note = join(h, "Documents", "orionBrain", "20 Areas", "Me", "Nick.md");
  assert.match(run("move", note, "--confirm", "Nick.md").json.refused, /notes vault/);
  assert.match(run("move", join(h, "Documents", "orionBrain"), "--confirm", "orionBrain").json.refused, /notes vault/);
  assert.match(run("find", "Nick.md").json.matches[0].refused, /notes vault/);
  assert.ok(existsSync(note));
  // An elsewhere vault named by ORION_BRAIN_VAULT: its notes are refused, and a folder holding it is too.
  mkdirSync(join(h, "Desktop", "work", "brain"), { recursive: true });
  writeFileSync(join(h, "Desktop", "work", "brain", "todo.md"), "t");
  const env = { PATH: process.env.PATH, HOME: h, ORION_TRASH_DIR: join(h, ".Trash"), ORION_CONTROLLED_DIR: join(h, "ctl"), ORION_REPO_DIR: join(h, "Desktop", "ORION"), ORION_BRAIN_VAULT: join(h, "Desktop", "work", "brain") };
  const runV = (...args) => JSON.parse(spawnSync(process.execPath, [TRASH, ...args], { encoding: "utf8", env }).stdout);
  assert.match(runV("move", join(h, "Desktop", "work", "brain", "todo.md"), "--confirm", "todo.md").refused, /notes vault/);
  assert.match(runV("move", join(h, "Desktop", "work"), "--confirm", "work").refused, /notes vault/);
  assert.ok(existsSync(join(h, "Desktop", "work", "brain", "todo.md")));
});

test("find marks an exact-name match apart from a loose one", () => {
  const { canary, run } = home();
  writeFileSync(join(canary, "To-Do.md"), "x");
  const loose = run("find", "todo.md").json.matches;
  assert.deepEqual(loose.map((m) => [m.name, m.exact]), [["To-Do.md", false]]);
  assert.deepEqual(run("find", "junk.txt").json.matches.map((m) => m.exact), [true]);
});

// REV6 item 3: ~/Desktop/orion/README.md is the repo on a case-insensitive disk, and was allowed.
test("a case variant of the ORION repo path is still the ORION project", () => {
  const { h, run } = home();
  writeFileSync(join(h, "Desktop", "ORION", "README.md"), "r");
  const variant = join(h, "Desktop", "orion", "README.md");
  if (!existsSync(variant)) return;   // a case-sensitive disk has no such path: nothing to bypass
  assert.match(run("move", variant, "--confirm", "README.md").json.refused, /ORION/);
  assert.match(run("move", join(h, "desktop", "Orion"), "--confirm", "Orion").json.refused, /ORION|not inside/);
  assert.ok(existsSync(join(h, "Desktop", "ORION", "README.md")));
});
