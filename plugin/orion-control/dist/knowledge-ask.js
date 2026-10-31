/*
 A general-knowledge question (2026-10-31, gate run-1031133008 regression cha-thinking-aloud-c).

 "orion whats the formula for the multiplier in econ, i forgot" was answered with the 4B front desk's draft, word for word:
 "Price = Quantity × Multiplier". The 30-10 run had the 9B answer it (1 / (1 − MPC)). A textbook question is the worker's,
 with a prompt that asks for the standard answer and nothing about his day, and no draft to copy. The work check never
 replaces such an answer: no tool, no claim about him, nothing for it to catch.
*/
const ASKS = /\b(?:formula|equation|definition|define|meaning of|what does [\w' -]{1,40} (?:mean|stand for)|how (?:do|does|did) [\w' -]{1,40} work|explain|derivative|integral|theorem|law of|principle of|difference between|who (?:was|invented|wrote|discovered|painted|said)|capital of|how many [\w ]{1,30} (?:are )?in an?|what is an?|what'?s an?|whats an?|what are|why does|why do|why is|convert|square root|percent of)\b/i;
const ABOUT_HIM = /\b(?:my|me|mine|i'?m|im|i have|i've|ive|do i|did i|am i|should i|can i|will i|i need|today|tonight|tomorrow|this week|calendar|schedule|session|reminder|weather|rain|text|email|message)\b/i;
const QUESTION = /\?\s*$|^(?:(?:orion|hey|ok(?:ay)?|so|um+|uh+|wait)[,\s]+)*(?:what|whats|what's|how|why|who|which|when (?:was|did)|where (?:is|was)|define|explain|is (?:it|there|the)|are (?:there|the)|does|do (?:you know|u know))\b/i;
const HIS_OWN = /\b(?:i forgot|i forget|i can'?t remember|remind me what|quick question)\b/gi;
/** "whats the formula for the multiplier in econ, i forgot": a textbook question, not about him or his day. */
export function isKnowledgeAsk(message) {
    const m = message.trim().replace(/^(?:(?:hey|ok(?:ay)?|so)[,\s]+)*orion[,\s]*/i, "");
    if (!QUESTION.test(m) || !ASKS.test(m))
        return false;
    return !ABOUT_HIM.test(m.replace(HIS_OWN, " "));
}
export const KNOWLEDGE_PROMPT = "Nick asked a general-knowledge question. Give the standard, textbook-correct answer in one or two short sentences (a formula written plainly, e.g. \"1 / (1 − MPC)\", with what each letter means). If the subject has more than one common version, give the one taught in an intro course and name it. No tools, nothing about his day, no follow-up offer.";
