import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { attentionDigest } from "../scripts/lib/attention/digest.mjs";

describe("attention digest", () => {
  it("now and later are listed", () => {
    const feed = {
      interrupt: [{ title: "Standup in 5 min" }, { title: "Deploy window opens" }],
      today: [{ title: "Review PR #42" }, { title: "Write status update" }],
      outages: [],
      note: null,
    };

    const result = attentionDigest(feed);

    assert.ok(result.includes("Now:"), "should have Now: header");
    assert.ok(result.includes("- Standup in 5 min"), "should list interrupt items");
    assert.ok(result.includes("- Deploy window opens"), "should list interrupt items");
    assert.ok(result.includes("Later today:"), "should have Later today: header");
    assert.ok(result.includes("- Review PR #42"), "should list today items");
    assert.ok(result.includes("- Write status update"), "should list today items");
  });

  it("long sections are capped", () => {
    const feed = {
      interrupt: [
        { title: "Item 1" },
        { title: "Item 2" },
        { title: "Item 3" },
        { title: "Item 4" },
        { title: "Item 5" },
        { title: "Item 6" },
        { title: "Item 7" },
      ],
      today: [],
      outages: [],
      note: null,
    };

    const result = attentionDigest(feed, { max: 5 });

    assert.ok(result.includes("Now:"), "should have Now: header");
    for (let i = 1; i <= 5; i++) {
      assert.ok(result.includes(`- Item ${i}`), `should list first ${i} items`);
    }
    assert.ok(!result.includes("- Item 6"), "should not list item 6");
    assert.ok(!result.includes("- Item 7"), "should not list item 7");
    assert.ok(result.includes("…and 2 more"), "should show overflow count");
  });

  it("an outage is always said", () => {
    const feed = {
      interrupt: [{ title: "Urgent fix" }],
      today: [],
      outages: ["calendar"],
      note: "Calendar service is down.",
    };

    const result = attentionDigest(feed);

    assert.ok(result.includes("Now:"), "should have Now: header");
    assert.ok(result.includes("- Urgent fix"), "should list interrupt item");
    assert.ok(result.endsWith("Calendar service is down."), "should end with outage note");
  });

  it("an empty, fully read day is quiet", () => {
    const feed = {
      interrupt: [],
      today: [],
      outages: [],
      note: null,
    };

    const result = attentionDigest(feed);

    assert.strictEqual(result, "Nothing needs you.");
  });
});
