// The V3 local judge for spoken replies (handoff §8.4): one dimension per call,
// written anchors, an "Unknown" option, temperature 0. A judge is trusted only
// after it agrees with hand scores (exact or ±1 on ≥85% of items); a judge
// never grades its own model's replies alone.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { chat } from "./ollama.mjs";
import { thinkFor } from "./presets.mjs";

export const DIMENSIONS = {
  correctness: "Is the reply correct given the facts and conversation? 5 = fully correct; 3 = partly correct or vague; 1 = wrong or invents facts not given.",
  spoken: "Is it right for speech? 5 = one to three short sentences, no lists or markdown, times like '8:15 PM'; 3 = a bit long or one formatting slip; 1 = a list, markdown, or a wall of text.",
  context: "Does it use the conversation and facts it was given? 5 = uses exactly what matters; 3 = ignores some relevant context; 1 = ignores the context or contradicts it.",
  overAsk: "Does it avoid needless questions? 5 = asks nothing unnecessary (or one needed question); 3 = one avoidable question; 1 = answers a clear request with questions instead.",
  tone: "Is the tone right for a calm, direct personal assistant? 5 = warm, brief, natural; 3 = stiff, preachy or over-eager; 1 = rude, robotic or sycophantic.",
};

const SCHEMA = { type: "object", properties: { score: { type: "string", enum: ["1", "2", "3", "4", "5", "unknown"] }, why: { type: "string" } }, required: ["score", "why"] };

const itemText = ({ facts = [], history = [], say, reply }) => [
  facts.length ? `Facts ORION had:\n${facts.map((f) => `- ${f}`).join("\n")}` : "Facts ORION had: none",
  history.length ? `Earlier:\n${history.map((m) => `${m.role === "assistant" ? "ORION" : "Nick"}: ${m.content}`).join("\n")}` : null,
  `Nick: ${say}`, `ORION's reply: ${reply}`,
].filter(Boolean).join("\n\n");

/** One dimension → { score: 1-5 | null (unknown), why, error }. */
export async function judgeOne({ model, dimension, item, chatImpl = chat }) {
  const t = thinkFor(model, "high");
  const res = await chatImpl({ model, format: SCHEMA, think: t.think, options: { temperature: 0, num_ctx: 8192 }, timeoutMs: 180000,
    messages: [
      { role: "system", content: `You grade one reply from a voice assistant on ONE dimension.\n${dimension}: ${DIMENSIONS[dimension]}\nAnswer with JSON: {"score": "1"-"5" or "unknown", "why": "one sentence"}. Use "unknown" only if you cannot tell.` },
      { role: "user", content: itemText(item) },
    ] });
  if (res.error || res.aborted) return { score: null, why: "", error: res.error ?? res.aborted };
  try {
    const o = JSON.parse(res.message.content);
    return { score: o.score === "unknown" ? null : Number(o.score), why: String(o.why ?? "").slice(0, 300), error: null };
  } catch { return { score: null, why: "", error: "unparsable judge output" }; }
}

export async function judgeAll({ model, item, chatImpl = chat }) {
  const out = {};
  for (const d of Object.keys(DIMENSIONS)) out[d] = await judgeOne({ model, dimension: d, item, chatImpl });
  return out;
}

/** Agreement with hand scores: share of (item, dimension) pairs within ±1 (unknowns count as disagreement). */
export function agreement(pairs) {
  const scored = pairs.filter((p) => p.hand != null);
  const within = scored.filter((p) => p.judge != null && Math.abs(p.judge - p.hand) <= 1).length;
  const exact = scored.filter((p) => p.judge != null && p.judge === p.hand).length;
  return { n: scored.length, withinOne: scored.length ? within / scored.length : null, exact: scored.length ? exact / scored.length : null };
}
