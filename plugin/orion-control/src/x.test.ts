import { it } from "vitest";
import { readSleepTurn } from "./sleep-plan-read.js";
import { normalizeSpoken as n } from "./spoken-numbers.js";
const now = new Date(2026, 10, 4, 21, 30);
const P = ["push my bedtime to, um, eleven forty five", "Push my wake up time to six AM", "push my wake time to six thirty", "push bedtime back 30 min", "bed at quarter to 12", "wake me at half 6 tomorrow", "i want to sleep at 11 tonight", "change my alarm to 7", "no alarm tomorrow", "from now on bedtime 11", "move my bedtime to 11:45", "make my bed time 11 pm", "set my bedtime for eleven", "bedtime earlier pls", "i wanna go to sleep at 11:30 tonight", "wake me up at six thirty", "push my alarm to 7:15", "move bedtime up 30 mins", "set my wake time to 6 every day", "change my bed time to 11 from now on", "i want to wake up at half 6 tomorow", "push my bedtim to 12"];
it("x", () => { for (const p of P) { const t = readSleepTurn(n(p), { now }); console.log("P|", p, "=>", JSON.stringify(t)); } });
