/*
 "i hate this uni so much lol" (w20 xf-other, live gate 2 #86). Everyday venting about a place, a class or a chore is slang, not distress: the
 reply was "I hear you. That sounds really tough right now." (therapy tone). It gets one light tease and nothing else (memory:
 orion-dark-slang-is-a-joke). The safety tiers (distress.ts) always come first: anything crisisTier names, or any despair word, is not this.
*/
import { crisisTier, isOverwhelmed } from "./distress.js";

const PLACE = "uni|university|school|college|campus|class|classes|lecture|lectures|seminar|seminars|module|course|lab|labs|exams?|essays?|homework|assignments?|coursework|deadlines?|group project|work|my job|the job|commute|weather|rain|cold|traffic|bus|tube|train|wifi|internet|printer|laptop|library|coding|leetcode|maths?|stats|econ|marketing|chem|physics|bio";
const VENT = new RegExp(String.raw`\b(?:i )?(?:hate|hated|despise|cant stand|can'?t stand|am so sick of|so sick of|sick of|so over|dread|loathe)\s+(?:this |my |the |that |these |those |all this |all the )?(?:\w+ ){0,2}?(${PLACE})\b`, "i");
const DESPAIR = /\b(?:life|myself|me|everything|everyone|everybody|people|my body|being alive|existing|living|myself|us|humans?|mornings?|monday)\b|\b(?:kill|die|dead|suicid|end it|hurt|cut|worthless|hopeless|alone|cry|crying|panic|anxious|depress|cant cope|can'?t cope|cant do this|can'?t do this|give up)\w*/i;
const ASKS = /\?|\b(?:can|could|would|will) (?:you|u)\b|\b(?:please|pls|plz|help|remind|move|set|add|cancel|play|open|turn|text|call|log|book|schedule|tell|show|find|check|start|stop|put|push|skip|what|whats|when|how|why|where|who|which)\b/i;

const CAUSES: Array<[RegExp, string]> = [
  [/\b(?:uni|university|college|campus)\b/i, "the uni"], [/\bschool\b/i, "school"], [/\b(?:class|classes|lecture|lectures|seminar|seminars|module|course)\b/i, "the class"],
  [/\b(?:exams?|essays?|homework|assignments?|coursework|deadlines?)\b/i, "the workload"], [/\b(?:work|job)\b/i, "work"], [/\b(?:commute|bus|tube|train|traffic)\b/i, "the commute"],
];
const LINES: Array<(c: string) => string> = [
  (c) => `Dramatic. ${c.charAt(0).toUpperCase()}${c.slice(1)} will survive you, sir.`,
  (c) => `Noted. You and ${c} have a complicated relationship, sir.`,
  (c) => `Bold words for someone who still turns up to ${c}.`,
  () => "Okay, Shakespeare.",
  () => "Uh huh. Sure, sir.",
];

/** The one-line tease when the message is only everyday venting; null otherwise (a request, a despair word, or any safety tier). */
export function ventTease(message: string): string | null {
  const m = message.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  if (!m || m.length > 90 || !VENT.test(m) || ASKS.test(m) || DESPAIR.test(m)) return null;
  if (crisisTier(message) !== null || isOverwhelmed(message)) return null;
  const cause = CAUSES.find(([re]) => re.test(m))?.[1] ?? "it";
  let h = 0;
  for (const ch of m) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LINES[h % LINES.length]!(cause);
}
