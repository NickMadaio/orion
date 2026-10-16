/*
 Testing-window heads-up: tell Nick on his phone ~6 h before `localRoutingTestingUntil` lapses.

 `localRouting: "on"` without an acceptance record runs under a time-boxed window (max 48 h,
 checked at plugin load). When it closes ORION falls back to the configured cloud model, which
 may be silent (no credit), so a lapse must never be a surprise. Renewing needs Nick's OK and a
 gateway restart, so the message says how.

 One line per distinct window end, remembered in testing-window-notice.json so a gateway
 restart inside the last 6 h does not repeat it. Checked at load and every 10 minutes.
*/
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const NOTICE_LEAD_MS = 6 * 3600_000;
const CHECK_EVERY_MS = 10 * 60_000;
const PHONE_LIMIT = 240;

export type TestingWindowNoticeOptions = {
  /** `localRoutingTestingUntil` as configured (ISO time). */
  testingUntil?: string;
  statePath: string;
  outboxPath: string;
  now?: () => number;
  /** Poll interval; 0 checks once at load only (tests). */
  checkEveryMs?: number;
  warn?: (message: string) => void;
};

export function noticeText(untilMs: number, nowMs: number): string {
  const hours = Math.max(0, Math.round((untilMs - nowMs) / 3600_000));
  const when = new Date(untilMs).toISOString().replace(/:\d\d\.\d+Z$/, "Z");
  return `ORION's local-model testing window ends in about ${hours} h (${when}). After that it falls back to the cloud model. To keep going: OK a renewal (max 48 h), then set localRoutingTestingUntil and restart the gateway.`.slice(0, PHONE_LIMIT);
}

function lastNoticed(statePath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as { noticedFor?: unknown };
    return typeof parsed.noticedFor === "string" ? parsed.noticedFor : undefined;
  } catch {
    return undefined;
  }
}

/** Sends the heads-up if due and not yet sent for this window end. Returns whether it queued one. */
export function checkTestingWindow(options: TestingWindowNoticeOptions): boolean {
  const untilMs = options.testingUntil ? Date.parse(options.testingUntil) : NaN;
  const nowMs = (options.now ?? Date.now)();
  if (!Number.isFinite(untilMs) || untilMs <= nowMs || untilMs - nowMs > NOTICE_LEAD_MS) return false;
  const key = new Date(untilMs).toISOString();
  if (lastNoticed(options.statePath) === key) return false;
  try {
    mkdirSync(dirname(options.outboxPath), { recursive: true });
    appendFileSync(
      options.outboxPath,
      `${JSON.stringify({ id: `testing-window-${key}`, at: new Date(nowMs).toISOString(), kind: "checkin", level: 1, text: noticeText(untilMs, nowMs) })}\n`,
    );
    mkdirSync(dirname(options.statePath), { recursive: true });
    const temp = `${options.statePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ noticedFor: key })}\n`, { mode: 0o600 });
    renameSync(temp, options.statePath);
    return true;
  } catch (error) {
    options.warn?.(`testing-window heads-up not queued: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export function registerTestingWindowNotice(options: TestingWindowNoticeOptions): void {
  if (!options.testingUntil) return;
  checkTestingWindow(options);
  const every = options.checkEveryMs ?? CHECK_EVERY_MS;
  if (every > 0) setInterval(() => checkTestingWindow(options), every).unref();
}
