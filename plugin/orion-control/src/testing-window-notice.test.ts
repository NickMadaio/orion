import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkTestingWindow, noticeText, registerTestingWindowNotice } from "./testing-window-notice.js";

const H = 3600_000;
const UNTIL = "2026-10-18T10:58:00Z";
const untilMs = Date.parse(UNTIL);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "twn-"));
  const statePath = join(dir, "state.json");
  const outboxPath = join(dir, "outbox.jsonl");
  const lines = () =>
    existsSync(outboxPath) ? readFileSync(outboxPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { statePath, outboxPath, lines };
}

describe("testing window heads-up", () => {
  it("stays quiet more than 6 h before the end", () => {
    const s = setup();
    expect(checkTestingWindow({ ...s, testingUntil: UNTIL, now: () => untilMs - 6.5 * H })).toBe(false);
    expect(s.lines()).toEqual([]);
  });

  it("queues one phone line inside the last 6 h, and not again", () => {
    const s = setup();
    const now = () => untilMs - 5.9 * H;
    expect(checkTestingWindow({ ...s, testingUntil: UNTIL, now })).toBe(true);
    expect(checkTestingWindow({ ...s, testingUntil: UNTIL, now: () => untilMs - 1 * H })).toBe(false);
    const [line, ...rest] = s.lines();
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ kind: "checkin", id: `testing-window-${UNTIL.replace("Z", ".000Z")}` });
    expect(line.text).toMatch(/ends in about 6 h/);
    expect(line.text).toMatch(/OK a renewal/);
    expect(line.text.length).toBeLessThanOrEqual(240);
  });

  it("alerts again for a renewed window", () => {
    const s = setup();
    checkTestingWindow({ ...s, testingUntil: UNTIL, now: () => untilMs - 3 * H });
    const renewed = new Date(untilMs + 40 * H).toISOString();
    expect(checkTestingWindow({ ...s, testingUntil: renewed, now: () => untilMs + 38 * H })).toBe(true);
    expect(s.lines()).toHaveLength(2);
  });

  it("says nothing once the window has closed, or when none is set or it is malformed", () => {
    const s = setup();
    expect(checkTestingWindow({ ...s, testingUntil: UNTIL, now: () => untilMs + 1 })).toBe(false);
    expect(checkTestingWindow({ ...s })).toBe(false);
    expect(checkTestingWindow({ ...s, testingUntil: "soon", now: () => untilMs })).toBe(false);
    expect(s.lines()).toEqual([]);
  });

  it("checks at load when registered", () => {
    const s = setup();
    registerTestingWindowNotice({ ...s, testingUntil: UNTIL, now: () => untilMs - 2 * H, checkEveryMs: 0 });
    expect(s.lines()).toHaveLength(1);
  });

  it("reports an unwritable outbox through warn instead of throwing", () => {
    const s = setup();
    const warnings: string[] = [];
    expect(
      checkTestingWindow({ statePath: s.statePath, outboxPath: "/dev/null/x/outbox.jsonl", testingUntil: UNTIL, now: () => untilMs - H, warn: (m) => warnings.push(m) }),
    ).toBe(false);
    expect(warnings[0]).toMatch(/not queued/);
  });

  it("rounds the hours left", () => {
    expect(noticeText(untilMs, untilMs - 2.4 * H)).toMatch(/about 2 h/);
  });
});
