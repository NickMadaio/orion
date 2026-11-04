/*
 Which chat turns are about shutting the Mac down for the night (w18 bedtime, 2026-11-04). Pure: bedtime-shutdown-chat.ts carries them out.

 On 2026-11-03 22:09 ORION asked "Want me to shut things down so you actually go to bed?" and Nick said "Fine. Yes." That is not one of the short
 bedtime replies, so it reached the local model, which answered "I'm shutting down your apps now so you can sleep." without calling any tool.
 Nothing was closed or locked. Now a yes to that offer is code's: it runs `orion-bedtime-shutdown run`.

   run       yes to the offer ("fine yes", "yeah do it"); or asking for it at night ("shut it all down", "yes close everything",
             "lock it all down"); or, any time of day, "put my computer to bed".
   pass      "i need 20 more minutes", only once the guard is armed (a shutdown happened tonight) and it is night.
   override  "leave my computer alone tonight" (on) / "lock my mac again" (off), at night.
 Never a shutdown: a no or a stall, a question, "close everything except chrome" (that is the apps turn), "put my kid to bed".
*/
export type ShutdownTurn = { kind: "run" } | { kind: "pass"; minutes: number } | { kind: "override"; on: boolean };
export type ShutdownCtx = { offered: boolean; night: boolean; armed: boolean };

/** ORION's offer, in both wordings of the firm rung (scripts/lib/life/sleep-nudge.mjs). */
export const isShutdownOffer = (text: string): boolean => /\bwant me to shut (?:things|it all|everything) down\b/i.test(text);

const norm = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,…]+/g, " ").replace(/\s+/g, " ").trim();
const NEG = /\b(?:don'?t|dont|do not|not|no|nah|nope|wait|stop|cancel|later|never|without|except|besides)\b/;

const YES_WORDS = new Set(["yes", "yeah", "yea", "ya", "yep", "yup", "sure", "ok", "okay", "k", "fine", "alright", "aight", "please", "pls", "plz", "bet", "fr", "go", "ahead", "do", "sounds", "good"]);
const YES_FILLER = new Set([...YES_WORDS, "it", "that", "ugh", "lol", "orion", "thanks", "thx", "i", "guess", "then", "now", "thing", "for", "shut", "down", "everything", "close", "all", "them", "em", "and", "lock", "the", "mac", "my", "computer", "laptop", "sleep", "bed", "put", "to", "so"]);

function readYes(m: string): boolean {
  const words = m.split(" ");
  return words.length <= 8 && words.some((w) => YES_WORDS.has(w)) && words.every((w) => YES_FILLER.has(w));
}

const LEAD = /^(?:(?:yes|yeah|yea|yep|yup|ok|okay|alright|fine|pls|please|orion|yo|hey|just|then|and|can you|could you|will you|would you|go ahead and)\s+)+/;
const MACHINE = "(?:computer|compter|comp|mac|macbook|laptop|pc|machine)";
const ALL_DOWN = /^(?:shut|close|quit|lock|power)\s+(?:it\s+all|everything|all\s+of\s+it|it)\s+down\b|^(?:close|quit)\s+everything\b|^lock\s+(?:it\s+all|everything)\b/;
const PUT_BED = new RegExp(`^put\\s+(?:my|the)\\s+${MACHINE}\\s+(?:to\\s+bed|down\\s+for\\s+the\\s+night)\\b|^put\\s+(?:my|the)\\s+${MACHINE}\\s+to\\s+sleep\\s+for\\s+the\\s+night\\b`);

const ON = new RegExp(`\\b(?:leave|let)\\s+(?:my\\s+)?${MACHINE}\\s+(?:alone|be)\\b|\\b(?:stop|quit)\\s+locking\\b.*\\b${MACHINE}\\b|\\b(?:don'?t|dont|do not)\\s+(?:lock|shut)\\s+(?:my\\s+)?${MACHINE}\\b`);
const OFF = new RegExp(`\\b(?:lock|shut)\\s+(?:my\\s+)?${MACHINE}\\s+(?:again|back)\\b|\\bturn\\s+(?:the\\s+)?(?:bedtime\\s+)?lock\\s+back\\s+on\\b|\\block\\s+it\\s+again\\b`);

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty five": 45, "half an": 0.5 };
const AMOUNT = /\b(\d{1,3}|half an|forty five|an?|one|two|three|five|ten|fifteen|twenty|thirty)\s+(?:more\s+)?(min|mins|minute|minutes|hour|hours|hr|hrs)\b/;
const ASKING = /^(?:i\s+)?(?:need|want)\b|\b(?:gimme|give me|lemme have|let me have|can i (?:get|have)|just)\b|^\d/;

function readPass(m: string): number | undefined {
  if (m.split(" ").length > 12 || /\bsleep\b/.test(m)) return undefined;
  const hit = AMOUNT.exec(m);
  if (!hit || !ASKING.test(m)) return undefined;
  const n = /^\d+$/.test(hit[1]!) ? Number(hit[1]) : NUM[hit[1]!];
  if (n === undefined) return undefined;
  const minutes = Math.round(/^h/.test(hit[2]!) ? n * 60 : n);
  return minutes > 0 ? minutes : undefined;
}

export function readShutdownTurn(message: string, ctx: ShutdownCtx): ShutdownTurn | null {
  const m = norm(message);
  if (!m || m.split(" ").length > 14) return null;
  if (ctx.night) {
    if (ON.test(m)) return { kind: "override", on: true };
    if (OFF.test(m)) return { kind: "override", on: false };
  }
  if (NEG.test(m) || /^(?:how|what|why|when|where|who|which)\b/.test(m)) return null;
  if (ctx.armed && ctx.night) {
    const minutes = readPass(m);
    if (minutes !== undefined) return { kind: "pass", minutes };
  }
  const bare = m.replace(LEAD, "");
  if (PUT_BED.test(bare)) return { kind: "run" };
  if (ctx.night && ALL_DOWN.test(bare) && bare.split(" ").length <= 8) return { kind: "run" };
  if (ctx.offered && readYes(m)) return { kind: "run" };
  return null;
}
