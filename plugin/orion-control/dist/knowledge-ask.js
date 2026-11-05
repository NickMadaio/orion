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
// w20 R3 (live gate #51): "is it bad to eat rice after the gym or whats the deal with carbs at night" got a calendar summary because "gym" is a
// scheduling word. A health, food or fitness FACT question ("is X bad", "whats the deal with X", "does X help") is general knowledge: the model
// answers it. It stays his day's question when it names his calendar, a time of his, or his own log.
const HEALTH_TOPIC = /\b(?:carbs?|carbohydrates?|protein|rice|pasta|bread|sugar|fats?|fibre|fiber|calories?|keto|fasting|creatine|caffeine|coffee|vitamins?|supplements?|whey|pre-?workout|cardio|stretch\w*|warm ?up|cool ?down|soreness|sore|muscles?|hydration|electrolytes?|alcohol|sleep|naps?|melatonin|magnesium|omega|cholesterol|insulin|metabolism|bulk(?:ing)?|cut(?:ting)?|abs|squats?|deadlifts?|lifting|gains?|eat(?:ing)?|food|meal|snack|diet)\b/i;
const HEALTH_FRAME = /^(?:(?:orion|hey|ok(?:ay)?|so|um+|uh+|wait)[,\s]+)*(?:is (?:it|that|this|[\w' -]{1,30}) (?:bad|ok|okay|fine|good|safe|healthy|unhealthy|worth it|true|a myth|better|worse)|are [\w' -]{1,30} (?:bad|ok|okay|good|safe|healthy|unhealthy|worth it)|whats the deal with|what's the deal with|wats the deal with|is there (?:any )?(?:point|benefit|harm|downside)|does [\w' -]{1,40} (?:help|work|matter|make|cause|burn|build|hurt|spike|kill|ruin|wreck|disrupt|affect|improve|raise|lower|increase|reduce|stop|break|mess)|do [\w' -]{1,40} (?:help|work|matter|make you|cause|burn|build|hurt)|why (?:do|does|is|are) [\w' -]{1,40}|how (?:long|much|many) [\w' -]{1,30} (?:should|do|does|to)|what happens if|should i (?:eat|have|take|drink|skip)|can i (?:eat|have|take|drink)|whats (?:better|worse|healthier)|what's (?:better|worse|healthier)|when should i (?:eat|take|drink))\b/i;
// Anything that makes it his own calendar or log, not a fact.
const HIS_DAY = /\b(?:my (?:calendar|schedule|day|plan|gym (?:block|session|time)|gym is|class|log)|calendar|schedule|reminder|block|booked|today|tomorrow|tonight|this (?:week|morning|afternoon|evening)|have i|did i|how many (?:calories|bottles)|am i|do i have|when (?:is|am|do) i)\b/i;
/** "is it bad to eat rice after the gym or whats the deal with carbs at night": a health or food fact, not his day. */
export function isHealthKnowledgeAsk(message) {
    const m = message.trim().replace(/^(?:(?:hey|ok(?:ay)?|so)[,\s]+)*orion[,\s]*/i, "");
    return m.length <= 200 && HEALTH_FRAME.test(m) && HEALTH_TOPIC.test(m) && !HIS_DAY.test(m);
}
/** "whats the formula for the multiplier in econ, i forgot": a textbook question, not about him or his day. */
export function isKnowledgeAsk(message) {
    if (isHealthKnowledgeAsk(message))
        return true;
    const m = message.trim().replace(/^(?:(?:hey|ok(?:ay)?|so)[,\s]+)*orion[,\s]*/i, "");
    if (!QUESTION.test(m) || !ASKS.test(m))
        return false;
    return !ABOUT_HIM.test(m.replace(HIS_OWN, " "));
}
export const KNOWLEDGE_PROMPT = "Nick asked a general-knowledge question. Give the standard, textbook-correct answer in one or two short sentences (a formula written plainly, e.g. \"1 / (1 − MPC)\", with what each letter means). If the subject has more than one common version, give the one taught in an intro course and name it. No tools, nothing about his day, no follow-up offer.";
