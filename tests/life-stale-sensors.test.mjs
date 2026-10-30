import { test } from "node:test";
import assert from "node:assert/strict";
import { sensorHealth, SENSOR_LIVE_LIMIT } from "../scripts/lib/awareness/facets.mjs";
import { sensorNotices, noticeLine } from "../scripts/lib/life/stale-sensors.mjs";

const now = new Date(2026, 9, 30, 8, 0);   // Friday 08:00 local
const at = (h) => new Date(now.getTime() - h * 3600_000).toISOString();
const phoneThen = new Date(2026, 9, 26, 18, 3).toISOString();   // Monday

test("2 h is the line", () => {
  assert.equal(SENSOR_LIVE_LIMIT, 7200000);
  const h = sensorHealth({ now, at: { phone: at(1.9), mac: at(2.1), whoop: null } });
  assert.equal(h.phone.state, "live"); assert.equal(h.mac.state, "stale"); assert.equal(h.whoop.state, "stale"); assert.equal(h.whoop.lastAt, null);
});
test("a sensor that should not be live is off, never stale", () => {
  assert.equal(sensorHealth({ now, at: {}, expected: { phone: true, mac: false, whoop: false } }).mac.state, "off");
});
test("the dead phone gets one notice naming the day and the fix", () => {
  const health = sensorHealth({ now, at: { phone: phoneThen, mac: at(0.01), whoop: at(1) } });
  const r = sensorNotices({ health, now });
  assert.equal(r.notices.length, 1);
  assert.equal(r.notices[0].text, "your phone hasn't reported since Monday - open ORION on it");
  assert.match(noticeLine(r.notices), /^Your phone hasn't reported since Monday/);
});
test("told once: the same outage is not repeated, a new one is", () => {
  const health = sensorHealth({ now, at: { phone: phoneThen, mac: at(0.01), whoop: at(1) } });
  const first = sensorNotices({ health, now });
  assert.equal(sensorNotices({ health, told: first.told, now }).notices.length, 0);
  const later = sensorHealth({ now, at: { phone: at(5), mac: at(0.01), whoop: at(1) } });
  assert.equal(sensorNotices({ health: later, told: first.told, now }).notices.length, 1);
});
test("WHOOP only speaks after half a day without a sync", () => {
  assert.equal(sensorNotices({ health: sensorHealth({ now, at: { phone: at(0), mac: at(0), whoop: at(3) } }), now }).notices.length, 0);
  assert.equal(sensorNotices({ health: sensorHealth({ now, at: { phone: at(0), mac: at(0), whoop: at(20) } }), now }).notices[0].sensor, "whoop");
});
test("a sensor never seen is told once as never reporting", () => {
  const r = sensorNotices({ health: sensorHealth({ now, at: { phone: at(0), mac: at(0) } }), now });
  assert.match(r.notices[0].text, /WHOOP hasn't synced at all yet/);
});
