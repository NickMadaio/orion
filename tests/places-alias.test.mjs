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
