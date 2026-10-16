// The pure delivery gate (contract C2) and its reader of awareness.json (C1, with staleness).
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gate, loadAwareness, resolveAwareness, audienceOf, sessionFromStatus } from "../scripts/lib/reach/gate.mjs";
import { chooseChannel, speakOnMac } from "../scripts/lib/reach/route.mjs";
import { awareness, harness, NOW } from "./delivery-helpers.mjs";

const aw = (over) => awareness(NOW, over);
const at = (secondsAgo) => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();
const verdict = (over, opts = {}) => gate(aw(over), { kind: "info", now: NOW, ...opts });

test("focus, sleep and class hold; a break, none, waiting and unknown deliver", () => {
  assert.deepEqual(verdict({ session: { state: "focus", at: at(0) } }), { action: "hold", reason: "a focus session is running - batched until a break", heldFor: "focus" });
  assert.equal(verdict({ sleep: { state: "asleep", at: at(0) } }).heldFor, "quiet");
  assert.equal(verdict({ calendar: { state: "ok", now: { kind: "class", title: "CS1800" }, at: at(0) } }).heldFor, "class");
  for (const state of ["rest", "none", "waiting", "unknown"]) assert.equal(verdict({ session: { state, at: at(0) } }).action, "deliver", state);
  assert.equal(verdict({ calendar: { state: "ok", now: { kind: "class", missed: true }, at: at(0) } }).action, "deliver", "a missed class does not hold");
});

test("a reminder he set and a class nudge always go, through focus, sleep and class", () => {
  const busy = { session: { state: "focus", at: at(0) }, sleep: { state: "asleep", at: at(0) }, calendar: { state: "ok", now: { kind: "class" }, at: at(0) } };
  for (const urgentKind of ["reminder", "class"]) assert.equal(verdict(busy, { urgentKind }).action, "deliver", urgentKind);
  assert.equal(verdict(busy, { urgentKind: "checkin" }).action, "hold", "no other kind bypasses");
});

test("a pause holds for 3 minutes (from session.since), then delivers", () => {
  const paused = (secondsAgo) => ({ session: { state: "paused", since: at(secondsAgo), at: at(0) } });
  assert.equal(verdict(paused(120)).action, "hold");
  assert.equal(verdict(paused(181)).action, "deliver");
});

test("no awareness at all delivers (unknown is never a reason to hold)", () => {
  assert.equal(gate(null, { now: NOW }).action, "deliver");
  assert.equal(gate({}, { now: NOW }).action, "deliver");
});

test("loadAwareness: a facet past its limit is unknown, whatever it says", () => {
  const h = harness();
  h.setAwareness({ session: { state: "focus", at: at(120) }, sleep: { state: "asleep", at: at(60) }, location: { state: "home", source: "sample", at: at(30 * 60) },
    audio: { mac: { headphones: true, at: at(120) }, phone: { headphones: true, at: at(600) } } });
  const loaded = loadAwareness({ dir: h.dir, now: NOW });
  assert.equal(loaded.session.state, "unknown", "90 s limit");
  assert.equal(loaded.sleep.state, "asleep", "sleep is fresh for 15 min");
  assert.equal(loaded.location.state, "unknown", "a sample is good for 20 min");
  assert.equal(loaded.audio.mac.headphones, null);
  assert.equal(loaded.audio.phone.headphones, true, "phone audio is good for 20 min");
  assert.equal(loadAwareness({ dir: join(h.dir, "nope"), now: NOW }).session.state, "unknown");
});

test("a region fix is good for 12 h; home is true only when known", () => {
  const h = harness();
  h.setAwareness({ location: { state: "home", placeId: "home", source: "region", at: at(5 * 3600) } });
  assert.equal(audienceOf(loadAwareness({ dir: h.dir, now: NOW })).atHome, true);
  h.setAwareness({ location: { state: "elsewhere", placeId: null, source: "sample", at: at(10) } });
  assert.equal(audienceOf(loadAwareness({ dir: h.dir, now: NOW })).atHome, false);
  h.setAwareness({ location: { state: "unknown", at: at(10) } });
  assert.equal(audienceOf(loadAwareness({ dir: h.dir, now: NOW })).atHome, null);
});

test("resolveAwareness fills an unknown session from the socket status and unknown sleep from the legacy window", () => {
  const h = harness();
  const r = resolveAwareness({ dir: join(h.dir, "none"), now: NOW, env: h.env, legacy: { quiet: true }, probe: false });
  assert.equal(r.session.state, "unknown");
  assert.equal(r.sleep.state, "asleep");
  assert.equal(sessionFromStatus({ status: "running", phase: "rest" }, NOW).state, "rest");
  assert.equal(sessionFromStatus({ status: "running", phase: "focus" }, NOW).state, "focus");
  assert.equal(sessionFromStatus({ status: "running" }, NOW).state, "focus", "no phase: stay conservative");
  assert.equal(sessionFromStatus({ status: "none" }, NOW).state, "none");
  assert.equal(sessionFromStatus(null, NOW).state, "unknown");
});

test("channel rule 3.4.4: the bubble always, voice only when home or in headphones", () => {
  const at_ = (f) => chooseChannel({ idleSeconds: 5, ...f, speakOnMac: speakOnMac(f) }).channel;
  assert.equal(at_({ atHome: true }), "mac-voice");
  assert.equal(at_({ atHome: null, headphones: true }), "mac-voice");
  assert.equal(at_({ atHome: null, headphones: false }), "mac-bubble");
  assert.equal(at_({ atHome: false, headphones: false }), "mac-bubble");
  assert.equal(at_({ atHome: true, lateAwake: true }), "mac-bubble");
  assert.equal(chooseChannel({ idleSeconds: 360, speakOnMac: true }).channel, "phone");
});
