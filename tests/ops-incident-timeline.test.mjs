import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildIncidentTimeline } from "../scripts/lib/orion-incident-timeline.mjs";

describe("ops-incident-timeline", () => {
  const T0 = Date.UTC(2025, 0, 1, 0, 0, 0);

  it("all four logs merge in time order", () => {
    const logs = {
      permission: [
        { changedAt: new Date(T0 + 300_000).toISOString(), previous: { profile: "user" }, next: { profile: "admin" } },
      ],
      remote: [
        { at: new Date(T0 + 100_000).toISOString(), from: "nick", text: "hello", decision: "accepted", verb: "ping" },
      ],
      repair: [
        { at: new Date(T0 + 200_000).toISOString(), kind: "patch", surface: "ssh", target: "server1", outcome: "ok" },
      ],
      location: [
        { at: new Date(T0 + 400_000).toISOString(), action: "home" },
      ],
    };

    const result = buildIncidentTimeline(logs);

    assert.equal(result.events.length, 4);
    assert.equal(result.events[0].source, "remote");
    assert.equal(result.events[1].source, "repair");
    assert.equal(result.events[2].source, "permission");
    assert.equal(result.events[3].source, "location");

    for (let i = 1; i < result.events.length; i++) {
      assert.ok(result.events[i].at >= result.events[i - 1].at);
    }
  });

  it("each source is summarized with its severity", () => {
    const logs = {
      permission: [
        { changedAt: new Date(T0).toISOString(), previous: { profile: "user" }, next: { profile: "admin" } },
      ],
      remote: [
        { at: new Date(T0).toISOString(), from: "nick", text: "hello", decision: "refused", verb: "ping" },
        { at: new Date(T0 + 1_000).toISOString(), from: "nick", text: "world", decision: "accepted", verb: "pong" },
      ],
      repair: [
        { at: new Date(T0).toISOString(), kind: "patch", surface: "ssh", target: "server1", outcome: "ok" },
      ],
      location: [
        { at: new Date(T0).toISOString(), action: "home" },
      ],
    };

    const result = buildIncidentTimeline(logs);

    const permEvent = result.events.find((e) => e.source === "permission");
    assert.equal(permEvent.severity, "high");
    assert.equal(permEvent.summary, "permission user -> admin");

    const refusedEvent = result.events.find((e) => e.summary.startsWith("refused"));
    assert.equal(refusedEvent.severity, "medium");
    assert.ok(refusedEvent.summary.startsWith("refused ping:"));

    const acceptedEvent = result.events.find((e) => e.summary.startsWith("accepted"));
    assert.equal(acceptedEvent.severity, "low");

    const repairEvent = result.events.find((e) => e.source === "repair");
    assert.equal(repairEvent.severity, "high");
    assert.ok(repairEvent.summary.startsWith("patch ssh server1 -> ok"));

    const locEvent = result.events.find((e) => e.source === "location");
    assert.equal(locEvent.severity, "low");
    assert.equal(locEvent.summary, "location home");
  });

  it("since filters and bad times are counted", () => {
    const logs = {
      permission: [
        { changedAt: new Date(T0).toISOString(), previous: {}, next: {} },
        { changedAt: new Date(T0 + 500_000).toISOString(), previous: { profile: "a" }, next: { profile: "b" } },
      ],
      remote: [
        { at: "not-a-date", from: "nick", text: "bad", decision: "accepted", verb: "ping" },
        { at: new Date(T0 + 100_000).toISOString(), from: "nick", text: "good", decision: "accepted", verb: "ping" },
      ],
      repair: [],
      location: [],
    };

    const result = buildIncidentTimeline(logs, { since: T0 + 200_000 });

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].at, T0 + 500_000);

    assert.equal(result.skipped, 1);
  });
});
