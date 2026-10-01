import { test } from "node:test";
import { strict as assert } from "node:assert";
import { triage, digest } from "../scripts/lib/notify/triage.mjs";

const NOW = { date: "2026-09-30", minute: 600 };

test("vip goes straight through", () => {
  const note = { app: "SMS", sender: "Mom", title: "", body: "Hey!", at: NOW };
  const result = triage(note, { now: NOW, vips: ["mom"] });
  assert.equal(result.action, "now");
  assert.equal(result.reason, "vip");
});

test("verification codes are urgent", () => {
  const note = { app: "SMS", sender: "Bank", title: "", body: "Your verification code is 123456", at: NOW };
  const result = triage(note, { now: NOW });
  assert.equal(result.action, "now");
  assert.equal(result.reason, "urgent");
});

test("promo is dropped", () => {
  const note = { app: "Temu", sender: null, title: "", body: "Check out this deal!", at: NOW };
  const result = triage(note, { now: NOW });
  assert.equal(result.action, "drop");
  assert.equal(result.reason, "promo");
});

test("instagram dm is not promo", () => {
  const note = { app: "Instagram", sender: "Sam", title: "", body: "Sam sent you a message", at: NOW };
  const result = triage(note, { now: NOW });
  assert.equal(result.action, "digest");
  assert.equal(result.reason, "later");
});

test("duplicate within 30 minutes is dropped and after 31 minutes is not", () => {
  const seen = [
    { app: "SMS", sender: "Mom", body: "Hey!", at: { date: "2026-09-30", minute: 580 } }
  ];
  // Within 30 min
  const note1 = { app: "SMS", sender: "Mom", title: "", body: "Hey!", at: { date: "2026-09-30", minute: 600 } };
  const result1 = triage(note1, { now: NOW, seen });
  assert.equal(result1.action, "drop");
  assert.equal(result1.reason, "duplicate");

  // After 31 min
  const note2 = { app: "SMS", sender: "Mom", title: "", body: "Hey!", at: { date: "2026-09-30", minute: 611 } };
  const result2 = triage(note2, { now: NOW, seen });
  assert.equal(result2.action, "digest");
});

test("canvas is school", () => {
  const note = { app: "Canvas", sender: null, title: "", body: "Assignment due soon", at: NOW };
  const result = triage(note, { now: NOW });
  assert.equal(result.action, "now");
  assert.equal(result.reason, "school");
});

test("money needs an amount", () => {
  // Monzo weekly summary — no amount → digest
  const note1 = { app: "Monzo", sender: null, title: "", body: "Your weekly summary", at: NOW };
  const result1 = triage(note1, { now: NOW });
  assert.equal(result1.action, "digest");

  // Monzo with amount → now
  const note2 = { app: "Monzo", sender: null, title: "", body: "You paid £4.50 to Tesco", at: NOW };
  const result2 = triage(note2, { now: NOW });
  assert.equal(result2.action, "now");
  assert.equal(result2.reason, "money");
});

test("quiet hours send friends to the digest but urgent still now", () => {
  const quietNow = { date: "2026-09-30", minute: 1500 }; // 25:00 = 1:00 AM next day, within 1410-450
  // Normal friend message → digest during quiet
  const note1 = { app: "SMS", sender: "Friend", title: "", body: "Hey what's up", at: quietNow };
  const result1 = triage(note1, { now: quietNow });
  assert.equal(result1.action, "digest");

  // Urgent message → still now during quiet
  const note2 = { app: "SMS", sender: "Friend", title: "", body: "Call me, emergency!", at: quietNow };
  const result2 = triage(note2, { now: quietNow });
  assert.equal(result2.action, "now");
  assert.equal(result2.reason, "urgent");
});

test("digest groups and caps", () => {
  // Create 12 senders with varying counts
  const items = [];
  for (let i = 0; i < 12; i++) {
    items.push({
      note: { app: "SMS", sender: `Sender${i}`, title: "", body: `Message from sender ${i}`, at: NOW },
      result: { action: "digest", reason: "later", summary: "" }
    });
  }
  // Add extra messages for some senders to test grouping
  items.push({
    note: { app: "SMS", sender: "Sender0", title: "", body: "Another from sender 0", at: NOW },
    result: { action: "digest", reason: "later", summary: "" }
  });
  items.push({
    note: { app: "SMS", sender: "Sender1", title: "", body: "Another from sender 1", at: NOW },
    result: { action: "digest", reason: "later", summary: "" }
  });

  const result = digest(items, { now: NOW });
  assert.equal(result.count, 14);
  const lines = result.text.split("\n");
  // Header + 8 group lines + "+4 more" = 10 lines
  assert.ok(lines[0].startsWith("While you were busy:"));
  assert.ok(lines[lines.length - 1].startsWith("+"));
});

test("invalid input throws", () => {
  assert.throws(() => triage(null, { now: NOW }), TypeError);
  assert.throws(() => triage({ app: "SMS", sender: null, title: "", body: "", at: null }, { now: NOW }), TypeError);
  assert.throws(() => digest("not an array", { now: NOW }), TypeError);
});
