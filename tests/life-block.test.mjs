import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  KINDS,
  SOURCES,
  validateBlock,
  normalizeBlock,
  blockMinutes,
} from "../scripts/lib/life/block.mjs";

const VALID_BLOCK = {
  id: "class-cs2100-mon",
  title: "CS2100 Lecture",
  kind: "class",
  date: "2026-09-28",
  start: 540,
  end: 630,
  fixed: true,
  source: "calendar",
};

describe("life-block", () => {
  it("a valid class block passes", () => {
    const result = validateBlock(VALID_BLOCK);
    assert.equal(result.ok, true);
  });

  it("each bad field is named", () => {
    // id
    {
      const b = { ...VALID_BLOCK, id: "Bad Id!" };
      const r = validateBlock(b);
      assert.equal(r.ok, false);
      assert.ok(r.errors.includes("id"));
    }
    // title
    {
      const b = { ...VALID_BLOCK, title: "" };
      const r = validateBlock(b);
      assert.equal(r.ok, false);
      assert.ok(r.errors.includes("title"));
    }
    // kind
    {
      const b = { ...VALID_BLOCK, kind: "invalid_kind" };
      const r = validateBlock(b);
      assert.equal(r.ok, false);
      assert.ok(r.errors.includes("kind"));
    }
    // date
    {
      const b = { ...VALID_BLOCK, date: "not-a-date" };
      const r = validateBlock(b);
      assert.equal(r.ok, false);
      assert.ok(r.errors.includes("date"));
    }
    // start
    {
      const b = { ...VALID_BLOCK, start: -1 };
      const r = validateBlock(b);
      assert.equal(r.ok, false);
      assert.ok(r.errors.includes("start"));
    }
    // end
    {
      const b = { ...VALID_BLOCK, end: 0 };
      const r = validateBlock(b);
      assert.equal(r.ok, false);
      assert.ok(r.errors.includes("end"));
    }
    // fixed
    {
      const b = { ...VALID_BLOCK, fixed: "yes" };
      const r = validateBlock(b);
      assert.equal(r.ok, false);
      assert.ok(r.errors.includes("fixed"));
    }
    // source
    {
      const b = { ...VALID_BLOCK, source: "unknown" };
      const r = validateBlock(b);
      assert.equal(r.ok, false);
      assert.ok(r.errors.includes("source"));
    }
  });

  it("impossible dates are rejected", () => {
    const feb30 = { ...VALID_BLOCK, date: "2026-02-30" };
    const r1 = validateBlock(feb30);
    assert.equal(r1.ok, false);
    assert.ok(r1.errors.includes("date"));

    const dec13 = { ...VALID_BLOCK, date: "2026-13-01" };
    const r2 = validateBlock(dec13);
    assert.equal(r2.ok, false);
    assert.ok(r2.errors.includes("date"));
  });

  it("normalize trims and drops unknown fields", () => {
    const b = {
      ...VALID_BLOCK,
      title: "  Trimmed Title  ",
      extraField: "should disappear",
    };
    const normalized = normalizeBlock(b);
    assert.equal(normalized.title, "Trimmed Title");
    assert.equal(normalized.extraField, undefined);
    assert.equal(Object.keys(normalized).length, 8);
  });

  it("normalize never mutates its argument", () => {
    const b = { ...VALID_BLOCK };
    const originalTitle = b.title;
    normalizeBlock(b);
    assert.equal(b.title, originalTitle);
  });

  it("normalize throws on an invalid block", () => {
    const b = { ...VALID_BLOCK, id: "Bad!" };
    assert.throws(() => normalizeBlock(b), TypeError, "invalid block");
  });

  it("blockMinutes is end minus start", () => {
    const minutes = blockMinutes(VALID_BLOCK);
    assert.equal(minutes, 90);
  });
});
