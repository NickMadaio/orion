/*
 Sleep wins over plan nudges (2026-11-02). Past tonight's bedtime-nudge time ORION does not tell Nick to go to the gym, work on a
 side project or catch the plan up: a skipped gym waits for the morning brief. Mirrors scripts/lib/reach/night-hush.mjs: his own
 wake-plan.json nudge (source "nick"), else life-config bedtime minus windDownMinutes. Pure apart from reading those two files.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bedtimeMin, windDownMin } from "./life-window.js";
import { sandboxNowMs } from "./plugin-clock.js";

const DAY_TURNS_AT = 5;   // hours: before 05:00 it is still last evening's night
const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function readWakePlan(stateDir: string): { source?: string; bedtimes?: Array<{ date?: string; nudgeAtIso?: string }> } | null {
  const name = sandboxNowMs({ dir: stateDir }) !== null ? "eval-wake-plan.json" : "wake-plan.json";
  try { return JSON.parse(readFileSync(join(stateDir, name), "utf8")); } catch { return null; }
}

/** True from tonight's nudge time until the night ends at 05:00. */
export function pastNudgeTime(stateDir: string | undefined, now: Date): boolean {
  if (!stateDir) return false;
  const evening = new Date(now.getTime() - DAY_TURNS_AT * 3600_000);
  const plan = readWakePlan(stateDir);
  const own = plan?.source === "nick" ? (plan.bedtimes ?? []).find((b) => b?.date === ymd(evening)) : undefined;
  const iso = own?.nudgeAtIso ? Date.parse(own.nudgeAtIso) : NaN;
  if (Number.isFinite(iso)) return now.getTime() >= iso;
  const bed = bedtimeMin(stateDir);
  const nudge = new Date(evening.getFullYear(), evening.getMonth(), evening.getDate(), 0, (bed < 12 * 60 ? bed + 1440 : bed) - windDownMin(stateDir));
  return now.getTime() >= nudge.getTime();
}

const PLAN_WORDS = "gym|workout|work out|side[- ]?project|catch(?:ing)? up";
/** A sentence that tells him to do gym or plan work: "Thirty minutes of gym, now." / "Go lift." / "Get the gym done tonight." */
const INSTRUCTION = new RegExp(`\\b(?:${PLAN_WORDS})\\b[^.!?]*\\b(?:now|right now|tonight|asap)\\b|^(?:no[,.]?\\s+)?(?:go|get|start|hit|do|finish|knock out)\\b[^.!?]*\\b(?:${PLAN_WORDS})\\b`, "i");
const ASKED = new RegExp(`\\b(?:${PLAN_WORDS})\\b`, "i");
export const NIGHT_FALLBACK = "It's late, so sleep wins. Anything skipped can wait for the morning.";

/** Late at night, drops sentences that order him to the gym or a plan task. Not when he asked about it himself. */
export function stripLateInstruction(reply: string, message: string): string {
  if (ASKED.test(message)) return reply;
  const sentences = reply.match(/[^.!?]+[.!?]*\s*/g) ?? [reply];
  const kept = sentences.filter((s) => !INSTRUCTION.test(s.trim()));
  if (kept.length === sentences.length) return reply;
  const out = kept.join("").trim();
  return out || NIGHT_FALLBACK;
}

/** The tone note's strict line without the gym order, for late nights. */
export const LATE_TONE_LINE = "It is past his wind-down time: never tell him to start gym, a side project or plan catch-up. Say sleep wins and a skipped plan waits for the morning.";
