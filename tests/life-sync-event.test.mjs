import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEvent, makeEvent } from "../scripts/lib/life/sync-event.mjs";

const good = () => makeEvent({ device: "iphone", clock: 3, kind: "capture.add", payload: { text: "idea" }, at: 1790000000000 });
test("a valid event passes", () => assert.deepEqual(validateEvent(good()), { ok: true }));
test("id is device and clock", () => assert.equal(good().id, "iphone:3"));
test("unknown kinds are rejected", () => assert.deepEqual(validateEvent({ ...good(), kind: "delete.everything" }).errors, ["kind"]));
test("oversized payloads are rejected", () => assert.ok(validateEvent({ ...good(), payload: { text: "x".repeat(9000) } }).errors.includes("payload")));
test("each bad field is named", () => {
  const errors = validateEvent({ id: "x", device: "Bad Device", clock: 0, kind: "nope", at: -1, payload: [] }).errors;
  for (const f of ["device", "clock", "kind", "at", "payload"]) assert.ok(errors.includes(f), f);
});
