// The test-only escalation pipeline (ORION V3 handoff §11.1): the front desk
// picks a move; answers are spoken directly; one tool runs; an escalation
// speaks the `say` line and hands the FULL conversation (including turns the
// front desk answered alone) to a tier model through the real ORION route.
// Times to the say line and to the final answer, and which model answered,
// are recorded. Calendar tools run on the sandbox; anything that would touch
// the world (lights, phone lock) is simulated.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { messagesFor } from "./frontdesk.mjs";

const SIMULATED = { weather: "London: 14°C, rain 3–5 PM (60%).", lights: "Lights: sent (simulated in evaluation).", phone_time: "Not sent: evaluation run.",
  alarm: "Not set: evaluation run.", wake: "Not sent: evaluation run.", session: "Session started (simulated).", media: "Paused (simulated).",
  app_open: "Opened (simulated).", browser: "Opened (simulated).", show: "Showing (simulated).", log_intake: "Logged (simulated).", supplements: "Updated (simulated).",
  brain: "No matches (evaluation fixture).", repair_note: "learned → ORION repair queue (simulated)." };

const earlierBlock = (turns) => (turns.length ? `Earlier in this conversation (some answered by the front desk):\n${turns.map((t) => `Nick: ${t.nick}\nORION: ${t.orion}`).join("\n")}\n\n` : "");

/**
 * One conversation. deps: { frontDesk(case) → { move, tool, args, tier, think, say, answer, ttftMs, wallMs },
 *   escalate({ text, tier, think, session }) → { reply, model, wallMs }, runTool(tool, args) → stdout, now() }.
 */
export async function runConversation(c, { frontDesk, escalate, runTool = async (tool) => SIMULATED[tool] ?? "(simulated)", tiers, now = () => performance.now() }) {
  const turns = [];
  const steps = [];
  const session = `orion-v3-pipe-${c.id}`;
  for (const text of c.turns ?? [c.say]) {
    const t0 = now();
    const fd = await frontDesk({ ...c, say: text, history: turns.flatMap((t) => [{ role: "user", content: t.nick }, { role: "assistant", content: t.orion }]) });
    const sayAt = now() - t0;
    let orion = ""; let answeredBy = "front-desk"; let escalated = null;
    if (fd.move === "escalate") {
      const model = tiers[fd.tier] ?? tiers.standard;
      const r = await escalate({ text: `${earlierBlock(turns)}Nick: ${text}`, tier: fd.tier, think: fd.think ?? "low", model, session });
      orion = r.reply; answeredBy = r.model ?? model; escalated = { tier: fd.tier, think: fd.think, model };
    } else if (fd.move === "tool") {
      const out = await runTool(fd.tool, fd.args ?? {});
      orion = `${fd.say ? `${fd.say} ` : ""}${out}`.trim();
    } else if (fd.move === "ignore") {
      orion = "";
    } else {
      orion = fd.answer ?? "";
    }
    steps.push({ text, move: fd.move, tool: fd.tool ?? null, escalated, say: fd.say ?? "", sayMs: sayAt, totalMs: now() - t0, answeredBy, reply: orion });
    turns.push({ nick: text, orion });
  }
  return { id: c.id, steps, replies: turns.map((t) => t.orion) };
}

export { messagesFor, earlierBlock };
