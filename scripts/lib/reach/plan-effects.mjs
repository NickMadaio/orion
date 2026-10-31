// The outward steps of a plan loop (lib/reach/plan-loop.mjs), for orion-checkin tick (2026-10-30). Each is one spawn of an
// existing tool: orion-reach for every message (its gate, channel rule, budgets and isolation apply), orion-reschedule displace
// for the replan, orion-ontask act for the restriction. A state copy (lib/clock.mjs isolated) restricts nothing: the step
// goes to the isolated outbox.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { isolated, toOutbox } from "../clock.mjs";
import { validUntilOf } from "./block-window.mjs";
import { END_RUNG, rungName } from "./plan-ladder.mjs";

const SENT = /^(Sent|Already said)/;
const DROPPED = /^NOT SENT: (ceiling|budget|blank-budget|dropped|expired)/;
const endOfDay = (nowMs) => { const d = new Date(nowMs); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59).toISOString(); };

/** orion-reach's argv for one ladder message. The closing message is always protected: a loop must be able to close. */
export function reachArgs(c, msg, { nowMs, channel = null, text = msg.text, askId = msg.msgId } = {}) {
  const ask = { type: "mismatch", blockId: c.block, title: c.what, window: c.blockWindow ?? null, level: msg.rung + 1, rung: rungName(msg.rung), askId };
  const end = msg.rung >= END_RUNG;
  const until = end ? endOfDay(nowMs) : validUntilOf(c.blockWindow);
  return [text, "--kind", "checkin", "--why", `plan: ${c.block}`, "--ask", JSON.stringify(ask),
    ...(end || c.tier === "protected" ? ["--tier", "protected"] : []), ...(until ? ["--valid-until", until] : []),
    ...(msg.urgent && !channel ? ["--urgent", "--urgent-kind", "plan", "--channel", "phone"] : []), ...(channel ? ["--channel", channel] : [])];
}

const outcomeOf = (r) => {
  const out = String(r?.stdout ?? "").trimStart();
  return { reached: r?.status === 0 && SENT.test(out), dropped: r?.status === 3 && DROPPED.test(out) };
};

/**
 * @param here   the scripts directory
 * @param env    process.env (the seams: ORION_REACH_BIN, ORION_RESCHEDULE_BIN, ORION_ONTASK_BIN)
 * @param record(what) -> void   recordOutcome + summarize, or null during an evaluation
 */
export function planEffects({ here, env = process.env, nowMs, evaluating = false, outcome = null }) {
  const spawn = (bin, args) => { try { return spawnSync(bin, args, { encoding: "utf8", timeout: 30_000, env }); } catch { return { status: 1, stdout: "" }; } };
  const reach = (args) => spawn(env.ORION_REACH_BIN || join(here, "orion-reach"), args);
  return {
    send(c, msg) {
      const first = outcomeOf(reach(reachArgs(c, msg, { nowMs })));
      if (!first.reached || !msg.voice) return { ...first, channels: first.reached ? [msg.urgent ? "phone-time-sensitive" : "auto"] : [] };
      // L2: the Mac says it aloud too, when he is home or has headphones in (route.mjs speakOnMac decided `voice`)
      const voice = outcomeOf(reach(reachArgs(c, msg, { nowMs, channel: "mac", text: msg.voice, askId: `${msg.msgId}-voice` })));
      return { ...first, channels: ["phone-time-sensitive", ...(voice.reached ? ["mac-voice"] : [])] };
    },
    displace(c) {
      if (evaluating) return { status: 1, stdout: "" };
      return spawn(env.ORION_RESCHEDULE_BIN || join(here, "orion-reschedule"), ["displace", c.what, "--why", "gave-up"]);
    },
    restrict(c, plan) {
      if (evaluating) return false;
      if (isolated(env) && !env.ORION_ONTASK_BIN) { toOutbox("focus-restrict", { step: plan.step, app: plan.app ?? null, block: c.block, title: c.what }, { env, by: "orion-checkin" }); return true; }
      const r = spawn(env.ORION_ONTASK_BIN || join(here, "orion-ontask"), ["act", plan.step, ...(plan.app ? ["--app", plan.app] : [])]);
      return r.status === 0;
    },
    outcome(row) { if (!evaluating && outcome) { try { outcome(row); } catch { /* the loop still closes */ } } },
  };
}
