import { strictEqual, deepStrictEqual } from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stat } from "node:fs/promises";
import { buildTodayFeed, writeTodayFeed } from "../scripts/lib/attention/today-feed.mjs";

const FIXED_NOW = 1790000000000;

describe("today-feed", () => {
  let tmp;

  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), "orion-att-today-"));
  });

  after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("ranked items become the feed", () => {
    const ranked = {
      now: [{ id: "cal:1", title: "Meeting", source: "calendar", score: 0.9, reason: "urgent", dueAt: FIXED_NOW + 60000 }],
      later: [{ id: "wait:2", title: "Reply expected", source: "waiting", score: 0.4, reason: "today", dueAt: null }],
      dropped: [],
    };

    const feed = buildTodayFeed(ranked, { now: FIXED_NOW });

    strictEqual(feed.version, 1);
    strictEqual(feed.generatedAt, new Date(FIXED_NOW).toISOString());
    deepStrictEqual(feed.interrupt, ranked.now);
    deepStrictEqual(feed.today, ranked.later);
    deepStrictEqual(feed.outages, []);
    strictEqual(feed.note, null);
  });

  it("an outage is named, never 'nothing needs you'", () => {
    const ranked = {
      now: [],
      later: [],
      dropped: [],
    };

    const feed = buildTodayFeed(ranked, { now: FIXED_NOW, outages: ["calendar", "focus"] });

    deepStrictEqual(feed.outages, ["calendar", "focus"]);
    strictEqual(feed.note, "Could not read: calendar, focus. Missing sources are unknown, not quiet.");
  });

  it("an empty day with every source read says nothing needs you", () => {
    const ranked = {
      now: [],
      later: [],
      dropped: [],
    };

    const feed = buildTodayFeed(ranked, { now: FIXED_NOW });

    strictEqual(feed.note, "Nothing needs you.");
  });

  it("the feed file is written privately", async () => {
    const feed = buildTodayFeed(
      { now: [], later: [], dropped: [] },
      { now: FIXED_NOW }
    );

    const path = join(tmp, "attention-today.json");
    await writeTodayFeed(path, feed);

    const s = await stat(path);
    // mode 0o600 means owner read+write only
    strictEqual(s.mode & 0o777, 0o600);
  });
});
