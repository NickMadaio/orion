import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { remoteAuditStats } from "../scripts/lib/orion-remote-audit-stats.mjs";

describe("ops-remote-audit-stats", () => {
  // Helper: make a row
  function row(at, decision, verb, reason) {
    const r = { at, decision };
    if (verb !== undefined) r.verb = verb;
    if (reason !== undefined) r.reason = reason;
    return r;
  }

  it("decisions and verbs are counted", () => {
    const rows = [
      row("2025-01-01T00:00:00Z", "accepted", "brain"),
      row("2025-01-01T01:00:00Z", "refused", "write", "policy"),
      row("2025-01-01T02:00:00Z", "accepted", "brain"),
      row("2025-01-01T03:00:00Z", "rejected", "read", "auth"),
    ];
    const from = Date.parse("2025-01-01T00:00:00Z");
    const to = Date.parse("2025-01-02T00:00:00Z");

    const result = remoteAuditStats(rows, { from, to });

    assert.equal(result.total, 4);
    assert.deepEqual(result.byDecision, { accepted: 2, refused: 1, rejected: 1 });
    // byVerb sorted desc count then asc name
    assert.deepEqual(result.byVerb, [
      { verb: "brain", count: 2 },
      { verb: "read", count: 1 },
      { verb: "write", count: 1 },
    ]);
    assert.deepEqual(result.perDay, { "2025-01-01": 4 });
    // refusal reasons from refused + rejected
    assert.deepEqual(result.topRefusalReasons, [
      { reason: "auth", count: 1 },
      { reason: "policy", count: 1 },
    ]);
    assert.equal(result.skipped, 0);
  });

  it("only the top verbs and reasons are kept", () => {
    const rows = [];
    // 12 distinct verbs, each with different counts so we can verify top-10 cutoff
    for (let i = 0; i < 12; i++) {
      const count = 12 - i; // verb_0 gets 12, verb_11 gets 1
      for (let j = 0; j < count; j++) {
        rows.push(row(`2025-01-01T${String(j).padStart(2, "0")}:00:00Z`, "accepted", `verb_${i}`));
      }
    }

    // 7 distinct refusal reasons with varying counts.
    // Use unique verbs per reason-row so they don't pollute the verb_0..verb_11 counts.
    // Each helper-verb appears at most once, staying below verb_9's count of 3.
    const reasonData = [
      { r: "reason_a", n: 7 },
      { r: "reason_b", n: 6 },
      { r: "reason_c", n: 5 },
      { r: "reason_d", n: 4 },
      { r: "reason_e", n: 3 },
      { r: "reason_f", n: 2 },
      { r: "reason_g", n: 1 },
    ];
    let helperIdx = 0;
    for (const { r, n } of reasonData) {
      for (let j = 0; j < n; j++) {
        rows.push(row(`2025-01-01T12:00:00Z`, "refused", `rv_${helperIdx++}`, r));
      }
    }

    const from = Date.parse("2025-01-01T00:00:00Z");
    const to = Date.parse("2025-01-02T00:00:00Z");

    const result = remoteAuditStats(rows, { from, to });

    // Only top 10 verbs kept (verb_0 through verb_9)
    assert.equal(result.byVerb.length, 10);
    assert.equal(result.byVerb[0].verb, "verb_0");
    assert.equal(result.byVerb[0].count, 12);
    assert.equal(result.byVerb[9].verb, "verb_9");
    assert.equal(result.byVerb[9].count, 3);

    // Only top 5 refusal reasons kept
    assert.equal(result.topRefusalReasons.length, 5);
    assert.equal(result.topRefusalReasons[0].reason, "reason_a");
    assert.equal(result.topRefusalReasons[4].reason, "reason_e");
  });

  it("per-day counts use UTC dates", () => {
    // A timestamp that is midnight UTC but different local times depending on TZ
    const rows = [
      row("2025-06-15T00:00:00Z", "accepted", "brain"),
      row("2025-06-14T23:59:59Z", "accepted", "brain"),
    ];
    const from = Date.parse("2025-06-14T00:00:00Z");
    const to = Date.parse("2025-06-16T00:00:00Z");

    const result = remoteAuditStats(rows, { from, to });

    assert.deepEqual(result.perDay, { "2025-06-14": 1, "2025-06-15": 1 });
  });

  it("the window and bad rows are respected", () => {
    const from = Date.parse("2025-01-01T00:00:00Z");
    const to = Date.parse("2025-01-02T00:00:00Z");

    const rows = [
      // Inside window, valid
      row("2025-01-01T12:00:00Z", "accepted", "brain"),
      // Outside window (before) — excluded, not skipped
      row("2024-12-31T23:59:59Z", "accepted", "brain"),
      // Outside window (after, at boundary is exclusive) — excluded, not skipped
      row("2025-01-02T00:00:00Z", "accepted", "brain"),
      // Bad timestamp — skipped
      { at: "not-a-date", decision: "accepted" },
      // Missing decision — skipped
      { at: "2025-01-01T12:00:00Z" },
      // Decision is not a string — skipped
      { at: "2025-01-01T12:00:00Z", decision: 42 },
      // Missing verb counts as "(none)"
      row("2025-01-01T13:00:00Z", "accepted"),
    ];

    const result = remoteAuditStats(rows, { from, to });

    assert.equal(result.total, 2);
    assert.equal(result.skipped, 3);
    assert.deepEqual(result.byDecision, { accepted: 2 });
    // one "(none)" verb and one "brain" verb
    assert.deepEqual(result.byVerb, [
      { verb: "(none)", count: 1 },
      { verb: "brain", count: 1 },
    ]);
  });
});
