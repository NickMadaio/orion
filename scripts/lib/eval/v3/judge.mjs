// The V3 local judge for spoken replies (handoff §8.4): one dimension per call,
// written anchors, an "Unknown" option, temperature 0. A judge is trusted only
// after it agrees with hand scores (exact or ±1 on ≥85% of items); a judge
// never grades its own model's replies alone.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { chat } from "./ollama.mjs";
import { thinkFor } from "./presets.mjs";

// v2 (2026-10-09): v1 agreed with hand scores on 82.5% (bar 85%) and was too lenient — it gave
// 5 to replies with the right shape ("apologises, offers to fix") without checking what they claimed.
export const JUDGE_VERSION = "v2";

export const DIMENSIONS = {
  correctness: "Is the reply correct given the facts and conversation? 5 = fully correct and specific; 4 = correct but vague in one place; 3 = partly correct, generic, or doesn't really answer; 2 = claims something is done, fixed or working that the facts do not show, or promises an action it cannot take; 1 = wrong or invents facts not given.",
  spoken: "Is it right for speech? 5 = one to three short sentences, no lists or markdown, times like '8:15 PM'; 3 = a bit long or one formatting slip; 1 = a list, markdown, or a wall of text.",
  context: "Does it use the conversation and facts it was given? 5 = uses the specific details that matter (names, times, what just happened); 4 = uses most of them; 3 = a generic reply that would fit any similar message, or ignores some relevant context; 2 = misreads what happened; 1 = ignores the context or contradicts it.",
  overAsk: "Does it avoid needless questions? 5 = asks nothing unnecessary (or one needed question); 3 = one avoidable question; 1 = answers a clear request with questions instead.",
  tone: "Is the tone right for a calm, direct personal assistant talking to Nick? 5 = warm, brief, natural, like a capable person; 4 = fine with one stiff phrase; 3 = generic customer-service phrasing ('I apologize for the inconvenience', 'I understand your frustration'), filler, or over-eager; 2 = grovelling, preachy or defensive; 1 = rude, robotic or sycophantic.",
};

const STRICT = "Be strict. Start from 3 and move up only for clear strengths. 5 means nothing could be improved; most ordinary replies get 3 or 4. A reply that merely has the right shape (it apologises, it offers to help) is not a 5 — check what it actually says against the facts. The 'facts' may include what a good answer should do; meeting them in form but not in substance is not a 5.";

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
      { role: "system", content: `You grade one reply from a voice assistant on ONE dimension.\n${dimension}: ${DIMENSIONS[dimension]}\n${STRICT}\nAnswer with JSON: {"score": "1"-"5" or "unknown", "why": "one sentence"}. Use "unknown" only if you cannot tell.` },
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
