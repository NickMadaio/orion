// A nutrition QUESTION ("how much protein is in this", "is a chipotle bowl high protein") is not a meal he ate: it is answered with
// only what he asked, then "Want me to log it?". Nothing is logged until he says yes. Used by orion-food-estimate (--ask) and by the
// food inbox (a phone photo whose note is a question). The plugin has its own reader for chat turns (food-read.ts); keep the two in step.
const NUTRIENT = String.raw`(?:cal(?:or|ar)\w*|cals?|kcals?|prot\w*|carbs?|carbohydrates?|fats?|macros?)`;
const HOW = String.raw`(?:h(?:ow|wo|w)\s+(?:many|much|mch|muh|mny))`;
const QUESTION = new RegExp(String.raw`\b(?:${HOW}\s+${NUTRIENT}|${NUTRIENT}\s+(?:in|for|of|on)\b|(?:is|are|does|do)\s+.{1,60}?\s+(?:high|low|good|a lot)(?:\s+in)?\s+${NUTRIENT}|(?:estimate|check)\s+(?:the |my )?${NUTRIENT}|macro (?:check|estimate))`, "i");
const DAY_TOTAL = /\b(?:today|so far|this week|yesterday|left|remaining|goal|target|budget|should i|do i need|my calorie|my protein|my macros)\b/i;

/** Whether this text is a nutrition question about a food (not his day's totals, not "log this"). */
export const isFoodQuestion = (text) => { const s = String(text ?? ""); return QUESTION.test(s) && !DAY_TOTAL.test(s); };

/** What he asked about: protein, calories, carbs, fat, or macros (the lot). */
export function focusOf(text) {
  const s = String(text ?? "").toLowerCase();
  if (/macro/.test(s)) return "macros";
  if (/prot/.test(s)) return "protein";
  if (/cal(?:or|ar)|\bcals?\b|kcal/.test(s)) return "calories";
  if (/carb/.test(s)) return "carbs";
  if (/\bfats?\b/.test(s)) return "fat";
  return "macros";
}

const g = (n) => `${Math.round(n)} g`;
const kcalOf = (t) => { const k = t.kcal >= 100 ? Math.round(t.kcal / 10) * 10 : Math.round(t.kcal); return `~${k} kcal`; };
const ASK_LOG = "Want me to log it?";
const JUDGE = { protein: [25, 10, "protein"], carbs: [60, 20, "carbs"], fat: [25, 8, "fat"] };

/** The one-line answer: what he asked first, the other headline number in brackets, then the offer. `question` decides "is this high X". */
export function answerLine(estimate, focus, question = "") {
  const t = estimate.totals;
  const isJudgement = /^\s*(?:is|are|does|do)\b/i.test(question) && /\b(?:high|low|good|a lot)\b/i.test(question) && JUDGE[focus];
  if (isJudgement) {
    const [hi, mid, word] = JUDGE[focus];
    const v = t[{ protein: "p", carbs: "c", fat: "f" }[focus]];
    const lead = v >= hi ? `Yes, about ${g(v)} of ${word}, that's a lot` : v >= mid ? `Kind of, about ${g(v)} of ${word}, so moderate` : `Not really, about ${g(v)} of ${word}`;
    return `${lead}. ${ASK_LOG}`;
  }
  switch (focus) {
    case "protein": return `About ${g(t.p)} of protein (and ${kcalOf(t)}). ${ASK_LOG}`;
    case "calories": return `About ${kcalOf(t).slice(1)} (${g(t.p)} protein). ${ASK_LOG}`;
    case "carbs": return `About ${g(t.c)} of carbs (and ${kcalOf(t)}). ${ASK_LOG}`;
    case "fat": return `About ${g(t.f)} of fat (and ${kcalOf(t)}). ${ASK_LOG}`;
    default: return `About ${kcalOf(t).slice(1)}: ${g(t.p)} protein, ${g(t.c)} carbs, ${g(t.f)} fat. ${ASK_LOG}`;
  }
}
