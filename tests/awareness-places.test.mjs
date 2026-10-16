import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { distanceM, matchPlace, learnHome, reconcileHome, readKnownPlaces, writeKnownPlaces, SEEDED_HOME, isNickConfirmed } from "../scripts/lib/awareness/places.mjs";
import { overnightCharging, daytime, HOME, CAMPUS } from "./fixtures/health-log.mjs";

const now = new Date(2026, 9, 16, 12, 0);

test("distanceM: about 111 m for 0.001 degrees of latitude", () => {
  const d = distanceM({ lat: 51.5, lon: -0.1 }, { lat: 51.501, lon: -0.1 });
  assert.ok(d > 105 && d < 117, String(d));
});

test("the seeded home is Nick's confirmed address, 150 m, and is the default with no file", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-places-"));
  const [home] = readKnownPlaces(dir);
  assert.equal(home.id, "home");
  assert.equal(home.lat, 51.5273608);
  assert.equal(home.lon, -0.0865265);
  assert.equal(home.radiusM, 150);
  assert.equal(home.source, "nick-confirmed address");
  assert.match(home.label, /Scape Shoreditch, 45 Brunswick Place, London N1 6DX/);
  assert.equal(isNickConfirmed(home), true);
});

test("the phone's 3 dp-rounded fix near home still matches the seeded home", () => {
  assert.equal(matchPlace({ lat: 51.528, lon: -0.087 }, [SEEDED_HOME])?.id, "home");
  assert.equal(matchPlace({ lat: 51.54, lon: -0.087 }, [SEEDED_HOME]), null);
});

test("known places round-trip through the file, and an explicit file wins over the seed", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-places-"));
  writeKnownPlaces(dir, [{ id: "gym", name: "gym", lat: 1, lon: 2, radiusM: 80, kind: "gym", source: "nick" }]);
  assert.deepEqual(readKnownPlaces(dir).map((p) => p.id), ["gym"]);
});

test("learnHome picks the overnight-charging cell over a busier daytime cell", () => {
  const log = [...overnightCharging(12, HOME), ...overnightCharging(2, CAMPUS, [2026, 9, 10]), ...daytime(60, CAMPUS)];
  const r = learnHome(log, { now });
  assert.equal(r.refused, undefined);
  assert.ok(distanceM(r, HOME) < 5);
  assert.equal(r.nights, 12);
});

test("learnHome refuses with fewer than 5 nights of evidence", () => {
  const r = learnHome([...overnightCharging(4, HOME), ...daytime(40, CAMPUS)], { now });
  assert.match(r.refused, /only 4 night/);
  assert.match(learnHome([], { now }).refused, /no overnight/);
});

test("learnHome ignores samples that are not charging, outside 01-06, or older than 14 days", () => {
  const notCharging = overnightCharging(8, HOME).map((s) => ({ ...s, charging: false }));
  assert.ok(learnHome(notCharging, { now }).refused);
  const old = overnightCharging(8, HOME, [2026, 8, 20]);
  assert.ok(learnHome(old, { now }).refused);
});

test("a learned home never overrides a Nick-confirmed one: confirms, refines, or reports a conflict", () => {
  const near = { lat: SEEDED_HOME.lat, lon: SEEDED_HOME.lon };
  assert.equal(reconcileHome(near, [SEEDED_HOME]).action, "confirms");
  const refine = { lat: SEEDED_HOME.lat + 0.0007, lon: SEEDED_HOME.lon };
  assert.equal(reconcileHome(refine, [SEEDED_HOME]).action, "refines");
  assert.equal(reconcileHome(HOME, [SEEDED_HOME]).action, "conflict");
  assert.equal(reconcileHome(HOME, []).action, "propose");
});
