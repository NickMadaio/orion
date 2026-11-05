/*
 Long chats keep working (w20 round 3, gate #57: after 57 turns Nick was shown the host's raw "Context overflow: prompt too large for the
 model. Try /reset"). The local model reads at most num_ctx tokens, and the chat history is what grows. Before the prompt is built the
 oldest turns are dropped, in place (the host hands the same array to the model), until what is left fits a budget that leaves room for
 the system prompt, the tools and the answer. The newest turns always stay, and the history always starts on a user turn, so a tool
 result is never left without the call that made it. A raw host error is never shown: it is replaced by one honest line with a retry.
 Pure except that trimHistory edits the array it is given.
*/
export const OVERFLOW = /\bcontext overflow\b|\bprompt too large for the model\b|\btry \/reset \(or \/new\)|\bcontext (?:length|window) exceeded\b/i;
export const OVERFLOW_LINE = "That chat got too long for me to hold, so I've trimmed the oldest part. Say go and I'll retry it.";

/** Characters per token for English text and JSON, on the high side so the estimate errs toward trimming. */
const CHARS_PER_TOKEN = 3;
const textOf = (message: unknown): number => { try { return JSON.stringify(message)?.length ?? 0; } catch { return 0; } };
export const estimateTokens = (messages: readonly unknown[]): number => Math.ceil(messages.reduce<number>((n, m) => n + textOf(m), 0) / CHARS_PER_TOKEN);

/** History tokens allowed for a model whose context budget is `contextTokens`: a third of it, never more than 12k, never less than 2k. */
export const historyBudget = (contextTokens: number | undefined): number => Math.max(2000, Math.min(12_000, Math.floor((contextTokens ?? 32_768) / 3)));

/** Drops the oldest messages until the rest fit `budget` tokens. The last message always stays; the first one left is a user turn. Returns how many went. */
export function trimHistory(messages: unknown[], budget: number): number {
  if (!Array.isArray(messages) || estimateTokens(messages) <= budget) return 0;
  let keepFrom = messages.length - 1; let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    used += Math.ceil(textOf(messages[i]) / CHARS_PER_TOKEN);
    if (used > budget && i < messages.length - 1) break;
    keepFrom = i;
  }
  const role = (m: unknown): unknown => (m && typeof m === "object" ? (m as { role?: unknown }).role : undefined);
  while (keepFrom < messages.length - 1 && role(messages[keepFrom]) !== "user") keepFrom += 1;
  if (keepFrom <= 0) return 0;
  messages.splice(0, keepFrom);
  return keepFrom;
}
