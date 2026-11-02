// orion-brain mine / unlearn / edit (wave 12 L1): ORION changes only his own (#orion) notes.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-brain");
function env() {
  const root = mkdtempSync(join(tmpdir(), "brain-own-"));
  const vault = join(root, "vault"); mkdirSync(join(vault, "20 Areas/Me"), { recursive: true });
  writeFileSync(join(vault, "20 Areas/Me/Nick.md"), "## Learned\n- [fact] DS lab partner is Priya (2026-10-16)\n- [answer] Who is Sam? → gym buddy #orion (2026-11-01)\n");
  const ws = join(root, "ws"); mkdirSync(ws);
  writeFileSync(join(ws, "USER.md"), "# USER\n- 2026-10-31 — stop being so formal\n");
  return { vault, ws, ctl: join(root, "ctl"), note: join(vault, "20 Areas/Me/Nick.md") };
}
const run = (e, ...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ORION_BRAIN_VAULT: e.vault, ORION_WORKSPACE_DIR: e.ws, ORION_CONTROLLED_DIR: e.ctl }, encoding: "utf8" });
const forgetIds = (e, words) => JSON.parse(run(e, "forget", words).stdout).matches.map((m) => m.id);

test("learn twice into an existing note: one Learned header, both lines under it, --own tagged, a typed #orion defused", () => {
  const e = env();
  writeFileSync(e.note, "---\ntitle: Nick\n---\n\n## Learned\n- [fact] DS lab partner is Priya (2026-10-16)\n\n## Relations\n- lives_in [[London]]\n");
  const a = run(e, "learn", "Nick", "fact", "takes creatine at 8 #orion");
  const b = run(e, "learn", "--own", "Nick", "guess", "probably lifts tuesdays");
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  const note = readFileSync(e.note, "utf8");
  assert.equal((note.match(/^## Learned/gm) ?? []).length, 1);
  assert.match(note, /Priya \(2026-10-16\)\n- \[fact\] takes creatine at 8 orion \(\d{4}-\d{2}-\d{2}\)\n- \[guess\] probably lifts tuesdays #orion \(\d{4}-\d{2}-\d{2}\)\n\n## Relations/);
});

test("mine lists only ORION's own lines, without the tag", () => {
  const e = env();
  const out = JSON.parse(run(e, "mine").stdout);
  assert.deepEqual(out.mine.map((m) => m.text), ["Who is Sam? → gym buddy"]);
});

test("unlearn archives his own line and refuses Nick's and USER.md's", () => {
  const e = env();
  const [own] = JSON.parse(run(e, "mine").stdout).mine;
  const [priya] = forgetIds(e, "priya");
  const [formal] = forgetIds(e, "formal");
  const refusedOnly = run(e, "unlearn", priya, formal);
  assert.equal(refusedOnly.status, 3);
  assert.deepEqual(JSON.parse(refusedOnly.stdout).refused, [priya, formal]);
  const ok = run(e, "unlearn", own.id);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).archived.map((a) => a.id), [own.id]);
  const note = readFileSync(e.note, "utf8");
  assert.doesNotMatch(note, /gym buddy/);
  assert.match(note, /Priya/);
  assert.match(readFileSync(join(e.ws, "USER.md"), "utf8"), /stop being so formal/);
});

test("edit rewrites his own line; Nick's is refused with nothing changed", () => {
  const e = env();
  const [own] = JSON.parse(run(e, "mine").stdout).mine;
  const ok = run(e, "edit", own.id, "Sam is his gym buddy (Tuesdays)");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(readFileSync(e.note, "utf8"), /- \[answer\] Sam is his gym buddy \(Tuesdays\) #orion \(\d{4}-\d{2}-\d{2}\)/);
  const [priya] = forgetIds(e, "priya");
  const no = run(e, "edit", priya, "Priya is nobody");
  assert.equal(no.status, 3);
  assert.match(no.stderr, /not one of ORION's own notes/);
  assert.match(readFileSync(e.note, "utf8"), /DS lab partner is Priya/);
});
