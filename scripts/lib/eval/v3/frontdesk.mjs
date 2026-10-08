// The J1 front desk for the V3 evaluation (handoff §6 J1): one stable system
// prompt (prompt variant + tool menu), then one user message with the dynamic
// facts and recent conversation, Nick's message last — stable text first so
// Ollama reuses the cached prefix, and the facts at the end where long-context
// models use them best. Output is forced to JSON with Ollama's `format`.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)

export const FRONT_DESK_SCHEMA = {
  type: "object",
  properties: {
    move: { type: "string", enum: ["answer", "tool", "escalate", "ask", "ignore"] },
    tool: { type: "string" },
    args: { type: "object" },
    tier: { type: "string", enum: ["quick", "standard", "deep"] },
    think: { type: "string", enum: ["off", "low", "high"] },
    say: { type: "string" },
    answer: { type: "string" },
  },
  required: ["move"],
};

const toolLine = (t) => `- ${t.name}: ${t.does}. args: ${JSON.stringify(t.args)}`;

/** The prompt template with {{tools}} filled from the menu. */
export function systemPrompt(template, menu) {
  return template.replace("{{tools}}", menu.tools.map(toolLine).join("\n")).trim();
}

const speaker = (m) => (m.role === "assistant" ? "ORION" : "Nick");

export function messagesFor(c, { historyTurns = 4 } = {}) {
  const facts = [`Now: ${c.clock ?? "unknown"}`, c.facts?.channel ? `Channel: ${c.facts.channel}` : null].filter(Boolean).join(". ");
  const history = (c.history ?? []).slice(-historyTurns * 2).map((m) => `${speaker(m)}: ${m.content}`).join("\n");
  const body = [`${facts}.`, history ? `Earlier:\n${history}` : null, `Message:\nNick: ${c.say}`].filter(Boolean).join("\n\n");
  return [{ role: "user", content: body }];
}

// A string the case's args pattern accepts: its first alternative, unescaped.
const exampleFor = (pattern) => String(pattern).replace(/^\(\?i\)/, "").split("|")[0].replace(/\\(.)/g, "$1").replace(/ \?/g, " ").replace(/[()?^$]/g, "");

/** The labelled answer as the model would output it (the §13.5 oracle dry run). */
export function oracleOutput(c) {
  const want = c.expect.J1;
  const move = want.moves[0];
  const o = { move, say: move === "answer" || move === "ignore" ? "" : "One moment." };
  if (move === "tool") Object.assign(o, { tool: want.tools[0], args: want.args ? { value: exampleFor(want.args) } : {} });
  if (move === "escalate") Object.assign(o, { tier: want.tiers[0], think: "low" });
  if (move === "answer" || move === "ask") o.answer = "Okay.";
  return JSON.stringify(o);
}
