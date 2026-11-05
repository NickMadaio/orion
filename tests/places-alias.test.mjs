// Places answer to a short alias ("spit" for Chapter Spitalfields): set --alias, place alias add/remove, find, and the lookup helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cleanAliases, findPlace, namesOf } from "../scripts/lib/awareness/places.mjs";

const BIN = join(import.meta.dirname, "..", "scripts", "orion-awareness");
const dirFor = (t) => { const d = mkdtempSync(join(tmpdir(), "places-alias-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const run = (dir, ...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, ORION_CONTROLLED_DIR: dir } });
const SET = ["place", "set", "chapter-spitalfields", "--lat", "51.5201", "--lon", "-0.0762", "--name", "Chapter Spitalfields", "--source", "nick-confirmed"];

test("place set --alias saves the alias, list shows it, find resolves it", (t) => {
  const d = dirFor(t);
  assert.equal(run(d, ...SET, "--alias", "spit").status, 0);
  const list = run(d, "place", "list").stdout.split("\n").find((l) => l.startsWith("chapter-spitalfields\t"));
  assert.equal(list.split("\t")[5], "spit");
  for (const q of ["spit", "Spit", "the spit", "chapter spitalfields", "Chapter-Spitalfields"]) assert.equal(run(d, "place", "find", q).stdout.split("\t")[0], "chapter-spitalfields", q);
  assert.equal(run(d, "place", "find", "spitfire").status, 1);
});

test("place alias add / remove, repeated set keeps earlier aliases, a place's own name is never an alias", (t) => {
  const d = dirFor(t);
  run(d, ...SET);
  assert.equal(run(d, "place", "alias", "chapter-spitalfields", "add", "spit").status, 0);
  assert.equal(run(d, "place", "alias", "chapter-spitalfields", "add", "the chapter").status, 0);
  run(d, ...SET, "--alias", "spitty");
  const row = () => run(d, "place", "list").stdout.split("\n").find((l) => l.startsWith("chapter-spitalfields\t")).split("\t")[5];
  assert.equal(row(), "spit,the chapter,spitty");
  assert.equal(run(d, "place", "alias", "chapter-spitalfields", "remove", "the chapter").status, 0);
  assert.equal(row(), "spit,spitty");
  run(d, "place", "alias", "chapter-spitalfields", "add", "Chapter Spitalfields");
  assert.equal(row(), "spit,spitty", "its own name is not an alias");
});

test("an alias that already means another place is refused", (t) => {
  const d = dirFor(t);
  run(d, ...SET, "--alias", "spit");
  const r = run(d, "place", "set", "library", "--lat", "51.5", "--lon", "-0.08", "--name", "Library", "--alias", "spit");
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /already means chapter-spitalfields/);
  assert.equal(run(d, "place", "alias", "nope", "add", "x").status, 1);
});

test("the helpers", () => {
  const places = [{ id: "home", name: "home" }, { id: "chapter-spitalfields", name: "Chapter Spitalfields", aliases: ["spit"] }, { id: "gym", name: "The Gym", aliases: ["spit gym"] }];
  assert.deepEqual(namesOf(places[1]), ["chapter spitalfields", "spit"]);
  assert.equal(findPlace(places, "spit").id, "chapter-spitalfields");
  assert.equal(findPlace(places, "the spit").id, "chapter-spitalfields");
  assert.equal(findPlace(places, "spit gym").id, "gym");
  assert.equal(findPlace(places, "home").id, "home");
  assert.equal(findPlace(places, "nowhere"), null);
  assert.equal(findPlace([{ id: "a", name: "Sam", aliases: ["x"] }, { id: "b", name: "Sue", aliases: ["x"] }], "x"), null, "two places claiming it is ambiguous, never a guess");
  assert.deepEqual(cleanAliases({ id: "a", name: "Alpha" }, ["Spit", "spit", " ", "alpha", '"quoted"']), ["Spit", "quoted"]);
});

// ---- "when i get to spit": arrival reminders at a named place, matched by alias ----
import { writeFileSync, readFileSync } from "node:fs";
import { runTick } from "../scripts/lib/reminders/tick.mjs";
const T = (h, m = 0, d = 5) => new Date(2026, 10, d, h, m, 0);
const reach = () => { const calls = []; const fn = (args) => { calls.push(args); return { status: 0, stdout: "Sent.\n" }; }; fn.calls = calls; return fn; };
const withPlaces = (t, reminder) => {
  const d = dirFor(t);
  writeFileSync(join(d, "known-places.json"), JSON.stringify({ schema: "orion.known-places.v1", places: [{ id: "home", name: "home", kind: "home", lat: 51.5, lon: -0.08, radiusM: 150 }, { id: "chapter-spitalfields", name: "Chapter Spitalfields", aliases: ["spit"], kind: "other", lat: 51.52, lon: -0.076, radiusM: 120 }] }));
  writeFileSync(join(d, "reminders.json"), JSON.stringify([{ id: "a1", kind: "alarm", label: "ring avery", dueAt: T(9, 0, 6).getTime(), createdAt: T(9).getTime(), ...reminder }]));
  return d;
};
const at = (placeId, state = placeId ? "known" : "elsewhere") => ({ derived: { atHome: false }, location: { state, placeId } });

test("a reminder for 'spit' arms while he is elsewhere and fires when awareness puts him at Chapter Spitalfields, once", async (t) => {
  const d = withPlaces(t, { place: "spit" }); const r = reach();
  await runTick({ dir: d, now: T(12), aw: at("home", "home"), reach: r });
  assert.equal(r.calls.length, 0);
  assert.equal(JSON.parse(readFileSync(join(d, "reminders.json"), "utf8"))[0].armed, true, "armed once he is somewhere else");
  await runTick({ dir: d, now: T(13), aw: at("chapter-spitalfields"), reach: r });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0][0], "You're at spit. Reminder: ring avery.");
  await runTick({ dir: d, now: T(13, 5), aw: at("chapter-spitalfields"), reach: r });
  assert.equal(r.calls.length, 1, "never twice");
});

test("the full name works the same, and being at the place when asked waits for the next arrival", async (t) => {
  const d = withPlaces(t, { place: "chapter spitalfields" }); const r = reach();
  await runTick({ dir: d, now: T(12), aw: at("chapter-spitalfields"), reach: r });
  assert.equal(r.calls.length, 0, "already there when asked");
  await runTick({ dir: d, now: T(12, 30), aw: at(null), reach: r });
  await runTick({ dir: d, now: T(13), aw: at("chapter-spitalfields"), reach: r });
  assert.equal(r.calls.length, 1);
});

test("a place nobody knows never fires or arms, and an unknown location never arms", async (t) => {
  const d = withPlaces(t, { place: "narnia" }); const r = reach();
  await runTick({ dir: d, now: T(12), aw: at(null), reach: r });
  await runTick({ dir: d, now: T(13), aw: at("chapter-spitalfields"), reach: r });
  assert.equal(r.calls.length, 0);
  const d2 = withPlaces(t, { place: "spit" });
  await runTick({ dir: d2, now: T(12), aw: { derived: { atHome: null }, location: { state: "unknown", placeId: null } }, reach: r });
  assert.equal(JSON.parse(readFileSync(join(d2, "reminders.json"), "utf8"))[0].armed, undefined);
});
