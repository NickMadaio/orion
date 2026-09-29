import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEvent } from "../scripts/lib/life/sync-event.mjs";
import { mergeLogs, since } from "../scripts/lib/life/sync-merge.mjs";

const e = (device, clock, at, text = "t") => makeEvent({ device, clock, kind: "capture.add", payload: { text }, at });
const phone = [e("iphone", 1, 100), e("iphone", 2, 300)];
const mac = [e("mac", 1, 200), e("mac", 2, 300)];
test("merge is the same in either order", () => assert.deepEqual(mergeLogs(phone, mac), mergeLogs(mac, phone)));
test("duplicates collapse", () => assert.equal(mergeLogs(phone, phone, mac).length, 4));
test("order is time then device then clock", () => assert.deepEqual(mergeLogs(phone, mac).map((x) => x.id), ["iphone:1", "mac:1", "iphone:2", "mac:2"]));
test("since returns only unseen events", () => assert.deepEqual(since([...phone, ...mac], { iphone: 1, mac: 2 }).map((x) => x.id), ["iphone:2"]));
test("invalid events are dropped", () => assert.equal(mergeLogs([...phone, { id: "junk", device: "x", clock: 1 }]).length, 2));
