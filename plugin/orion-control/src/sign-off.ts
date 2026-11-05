/*
 A sign-off is a sign-off (w20 round 6, live gate 4 #89: "ok last one, cheers" was read as an answer to "which apps?" -> "I couldn't find Last one
 and Cheers, so the allowed apps are as they were"). Thanks, cheers, night and "that's all" never answer a pending question or name an app.
*/
const THANKS = "(?:cheers|thanks|thank you|thx|ta|ty|nice one|legend|appreciate it|much appreciated)";
const CLOSER = "(?:last one|that'?s all|thats all|that'?s it|thats it|all done|nothing else|no more|i'?m good|im good|all good|we'?re done|were done|sorted|perfect|great|nice|cool|brilliant|sound)";
const BYE = "(?:night|goodnight|good night|nighty night|bye|goodbye|laters|later|see ya|see you|ttyl|catch you later|speak soon|peace)";
const WORD = `(?:${THANKS}|${CLOSER}|${BYE}|mate|man|bro|orion|ok|okay|alright|right|so|yeah|yep|cheers|then|now|and|for (?:that|everything|today|now)|lol|haha|x|sir|boss|buddy)`;
const SIGN_OFF = new RegExp(`^(?:${WORD}[\\s,.!-]*)+$`, "i");

/** A message that is only thanks / a closer / a goodbye. It must contain at least one of those, not just filler. */
export function isSignOff(message: string): boolean {
  const m = message.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  if (!m || m.length > 60 || !SIGN_OFF.test(m)) return false;
  return new RegExp(`\\b(?:${THANKS}|${CLOSER}|${BYE})\\b`, "i").test(m);
}
