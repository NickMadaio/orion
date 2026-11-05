/*
 A goodbye is a goodbye (w20 round 6, live gate 4 #89: "ok last one, cheers" was read as an answer to "which apps?"). Only REAL goodbyes count (review r6:
 "ok sound", "yeah perfect", "ok cool" answer an offer in British chat and are not sign-offs):
   strong   bye / night / goodnight / laters / ttyl / "that's all" / "that's it" / "all done" / "nothing else" / "no more" / "last one"
   weak     cheers / thanks / ta / ty / thx, which can also be a yes ("cheers" to an offer): a sign-off only when nothing is pending
 A message that is anything else, or mixes a goodbye with a request, is not one.
*/
const STRONG = "(?:night|goodnight|good night|nighty night|bye|goodbye|laters|later|see ya|see you|ttyl|catch you later|speak soon|that'?s all|thats all|that'?s it|thats it|all done|nothing else|no more|last one)";
const WEAK = "(?:cheers|thanks|thank you|thx|ta|ty|nice one|legend|much appreciated|appreciate it)";
const FILLER = "(?:mate|man|bro|orion|ok|okay|alright|right|so|yeah|yep|then|now|and|for (?:that|everything|today|now)|lol|haha|x|sir|boss|buddy)";
const ONLY = new RegExp(`^(?:(?:${STRONG}|${WEAK}|${FILLER})[\\s,.!-]*)+$`, "i");
/** A message that is only a goodbye. `pending`: ORION has a question open, so a bare thanks / cheers may be the answer to it and is not a sign-off. */
export function isSignOff(message, opts = {}) {
    const m = message.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
    if (!m || m.length > 60 || !ONLY.test(m))
        return false;
    if (new RegExp(`\\b${STRONG}\\b`, "i").test(m))
        return true;
    return new RegExp(`\\b${WEAK}\\b`, "i").test(m) && !opts.pending;
}
