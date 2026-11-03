/*
 ORION speaks as "I" (w18 voiceself, 2026-11-03). Live: "that's not something ORION can do", "ORION can't use Claude".
 Root cause: the prompts and canned lines the model reads describe Orion in the third person (IDENTITY.md "Orion is a capable partner ... Its identity",
 USER.md "Orion complements ...", SELF.md "what Orion is", script outputs "ORION can skip it"), so it copies that register back.
 Sources now say "you"/"I" and carry SPEAK_AS_I; this is the cheap backstop at finalize (the agent CLI has no delivery stage).
 It rewrites only ORION as the SUBJECT of its own sentence (ORION + a modal or a verb). "ORION Link", "Open ORION", "orion-mouse" are left alone.
*/
export const SPEAK_AS_I = "Speak as I. Never call yourself ORION or refer to yourself in the third person.";

const BE: Record<string, string> = { is: "am", "isn't": "am not", was: "was", "wasn't": "wasn't" };
const HAVE: Record<string, string> = { has: "have", "hasn't": "haven't", does: "do", "doesn't": "don't", needs: "need", wants: "want" };
const PLAIN = "can't|cannot|can|could|couldn't|will|won't|would|wouldn't|should|shouldn't|must|may|might|did|didn't|do|don't";
const S_VERBS: Record<string, string> = { tracks: "track", reads: "read", sees: "see", uses: "use", keeps: "keep", sends: "send", checks: "check", gets: "get", hears: "hear", handles: "handle", runs: "run", opens: "open", logs: "log", knows: "know", only: "only" };
const ADVERB = "(?:only|always|never|just|also|still|really|actually|currently) ";
// "ORION is open on the phone" is the app, not me.
const APP_STATE = /^(?:open|closed|running|locked|installed|offline|updating|restarting|paused|in an evaluation|not running|not open)\b/i;

const RE = new RegExp(String.raw`(^|[^\w./-])ORION\s+(?:(${ADVERB})?(${PLAIN}|${Object.keys(BE).join("|")}|${Object.keys(HAVE).join("|")}|${Object.keys(S_VERBS).filter((v) => v !== "only").join("|")})\b)`, "gi");

/** The reply with ORION-as-subject sentences put in the first person. Pure. */
export function firstPerson(text: string): string {
  if (!/orion/i.test(text)) return text;
  return text.replace(RE, (whole, lead: string, adverb: string | undefined, verb: string, offset: number) => {
    const v = verb.toLowerCase();
    const rest = text.slice(offset + whole.length).trimStart();
    if (BE[v] && APP_STATE.test(rest)) return whole;
    const word = BE[v] ?? HAVE[v] ?? S_VERBS[v] ?? v;
    return `${lead}I ${adverb ?? ""}${word}`;
  });
}
