import test from "node:test";
import assert from "node:assert/strict";
import { chooseChannel, speakingVolume, allowed } from "../scripts/lib/reach/route.mjs";

test("away from the Mac → his phone", () => {
  assert.equal(chooseChannel({ idleSeconds: 900 }).channel, "phone");
  assert.equal(chooseChannel({ idleSeconds: 5, locked: true }).channel, "phone");
});

test("at the Mac but out → a silent bubble; at home or with headphones → aloud", () => {
  assert.equal(chooseChannel({ idleSeconds: 10, out: true }).channel, "mac-bubble");
  assert.equal(chooseChannel({ idleSeconds: 10, out: false }).channel, "mac-voice");
  assert.equal(chooseChannel({ idleSeconds: 10, out: true, headphones: true }).channel, "mac-voice");
});

test("quiet hours hold everything but urgent", () => {
  assert.equal(chooseChannel({ idleSeconds: 9999, quiet: true }).channel, "hold");
  assert.equal(chooseChannel({ idleSeconds: 9999, quiet: true }, { urgent: true }).channel, "phone");
});

test("speaking volume is brought to a sensible level", () => {
  assert.equal(speakingVolume(0, { muted: true }), 45);
  assert.equal(speakingVolume(90), 55);
  assert.equal(speakingVolume(40), 40);
  assert.equal(speakingVolume(5, { headphones: true }), 35);
});

test("no repeats and no more than six an hour", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const at = (m) => new Date(now - m * 60000).toISOString();
  assert.equal(allowed("Rain at 3", [{ text: "rain at 3!", at: at(30) }], { now }).ok, false);
  assert.equal(allowed("Rain at 3", [{ text: "rain at 3", at: at(200) }], { now }).ok, true);
  const six = Array.from({ length: 6 }, (_, i) => ({ text: `m${i}`, at: at(i * 5), channel: "phone" }));
  assert.equal(allowed("new", six, { now }).ok, false);
});
