import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listsToBlock, groupName, LISTS } from "../scripts/lib/focus/phone-lists.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/orion-phone-time", import.meta.url));
const NOW = "2026-11-02T14:00:00Z";
const STUDY = { id: "s1", title: "Study", kind: "study", date: "2026-11-02", start: 840, end: 900, fixed: true, source: "ical" };

function world(t) {
  const dir = mkdtempSync(join(tmpdir(), "orion-phone-groups-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW, TZ: "UTC" } });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const file = () => JSON.parse(readFileSync(join(dir, "focus-phone-user.json"), "utf8"));
  return { dir, run, file };
}

test("browsers is a group, and old phone reports without it still work", () => {
  assert.ok(LISTS.includes("browsers"));
  const r = listsToBlock({ block: null, usedToday: { messaging: 0, feeds: 0, video: 0, games: 0 }, current: null, escalation: "none" });
  assert.deepEqual(r.block, []);
  assert.ok(r.keep.includes("browsers"));
});

test("a focus block blocks only the group actually overused", () => {
  const r = listsToBlock({ block: STUDY, usedToday: { messaging: 40, feeds: 22, video: 3, games: 0, browsers: 4 }, current: null, escalation: "block" });
  assert.deepEqual(r.block, ["feeds"]);
  assert.deepEqual(r.lists.map((l) => l.name), ["feeds"]);
  assert.match(r.lists[0].why, /22 min of feeds/);
});

test("browsers overuse blocks browsers and nothing else", () => {
  const r = listsToBlock({ block: STUDY, usedToday: { messaging: 0, feeds: 2, video: 0, games: 0, browsers: 31 }, current: null, escalation: "block" });
  assert.deepEqual(r.block, ["browsers"]);
});

test("no group over the line means nothing is blocked, even at the block step", () => {
  const r = listsToBlock({ block: STUDY, usedToday: { messaging: 90, feeds: 14, video: 9, games: 0, browsers: 1 }, current: null, escalation: "block" });
  assert.deepEqual(r.block, []);
});

test("the daily cap applies to browsers on its own", () => {
  const r = listsToBlock({ block: null, usedToday: { messaging: 0, feeds: 5, video: 5, games: 5, browsers: 125 }, current: null, escalation: "none" });
  assert.deepEqual(r.block, ["browsers"]);
});

test("aliases name groups only, never apps", () => {
  assert.equal(groupName("social"), "feeds");
  assert.equal(groupName("Social"), "feeds");
  assert.equal(groupName("browser"), "browsers");
  assert.equal(groupName("web"), "browsers");
  assert.equal(groupName("video"), "video");
  assert.equal(groupName("tiktok"), null);
  assert.equal(groupName("youtube"), null);
  assert.equal(groupName("everything"), null);
  assert.equal(groupName(undefined), null);
});

test("block social,video writes one entry per group with its own end and why", (t) => {
  const { run, file } = world(t);
  const r = run("block", "social,video", "--minutes", "30", "--why", "revision block");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /social and video blocked until 2:30 PM/);
  const lists = file().lists;
  assert.deepEqual(lists.map((l) => l.name), ["feeds", "video"]);
  assert.equal(lists[0].until, "2026-11-02T14:30:00.000Z");
  assert.equal(lists[0].why, "revision block");
});

test("a second block adds to the first; unblocking one group leaves the other", (t) => {
  const { run, file } = world(t);
  run("block", "games", "--minutes", "20");
  run("block", "browser", "--minutes", "45");
  assert.deepEqual(file().lists.map((l) => l.name), ["games", "browsers"]);
  const r = run("unblock", "games");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Still shut: browsers/);
  assert.deepEqual(file().lists.map((l) => l.name), ["browsers"]);
});

test("re-blocking a group replaces its end rather than duplicating it", (t) => {
  const { run, file } = world(t);
  run("block", "video", "--minutes", "10");
  run("block", "video", "--minutes", "50");
  const lists = file().lists;
  assert.equal(lists.length, 1);
  assert.equal(lists[0].until, "2026-11-02T14:50:00.000Z");
});

test("unblock all opens every group ORION shut", (t) => {
  const { run, file } = world(t);
  run("block", "games,video");
  const r = run("unblock", "all");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(file().lists, []);
});

test("unknown groups, single apps and 'all' to block are refused and write nothing", (t) => {
  const { dir, run } = world(t);
  for (const word of ["tiktok", "everything", "all", "social,instagram"]) {
    const r = run("block", word);
    assert.equal(r.code, 2, `${word}: ${r.out}`);
    assert.match(r.out, /NOT BLOCKED/);
  }
  assert.equal(existsSync(join(dir, "focus-phone-user.json")), false);
  assert.equal(run("block", "social", "--minutes", "0").code, 2);
  assert.equal(run("block", "social", "--minutes", "9999").code, 1);
  assert.equal(run("block").code, 2);
});

test("status lists what ORION has shut, and the grant path still works beside it", (t) => {
  const { run } = world(t);
  run("block", "social", "--minutes", "30", "--why", "studying");
  assert.match(run("status").out, /ORION has shut: social until 2:30 PM \(studying\)/);
  assert.equal(run("grant", "20", "--because", "x").code, 0);
});
