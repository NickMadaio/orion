/*
 Saving a place he is at (w20, live 11-05 13:05-13:06). ORION asked "You've been here a while - want me to save this spot? What is it?", he answered with the name,
 the desk drafted "Got it, Chapter Spitalfields. Want me to save that spot for you?" (nothing saved), and his "yes" met nothing pending. The thread is now code's:
   his answer with a name saves it at once (the name IS the yes) and reads it back: "Saved "Chapter Spitalfields" as a place."
   a bare yes / no to a save-the-spot question: yes saves it (asking only for the name when none is known), no leaves it
   a question for a name ("What should I call it?") is the pending item, and the next answer is the name
 Pure parsing here; the one writer is scripts/orion-awareness (place set <id> --here --name N), read back with `place list`.
*/
export type PlaceReply =
  | { kind: "name"; name: string; alias?: string }
  | { kind: "yes" }
  | { kind: "no" };
export type PlacePending = { stage: "confirm" | "name"; name?: string; at: number };

const SAVE_Q = /\b(?:save|remember|keep|add)\b[^.?!]{0,30}\b(?:this|that|the)?\s*(?:spot|place|location)\b/i;
/** ORION's own question about saving where he is (the proactive one, or a follow-up). */
export const asksToSavePlace = (text: string): boolean => SAVE_Q.test(text) && /\?\s*$/.test(text.trim().replace(/["')]+$/, ""));

const YES = /^(?:y|ya|yes|yeah|yea|yep|yup|sure|ok|okay|please|do it|go ahead|go on|sounds good|yes please|yeah please|yep please|save it|yes save it)(?:[\s,]+(?:please|pls|mate|then|thanks))*[\s.!]*$/i;
const NO = /^(?:n|no|nah|nope|not now|no thanks|nah thanks|dont|don'?t|skip|never ?mind|nvm|leave it)(?:[\s,]+(?:please|pls|mate|thanks))*[\s.!]*$/i;
const NAME_LEAD = /^(?:(?:it'?s|its|it is|this is|that'?s|thats|that is|here is|here'?s|i call (?:it|this place|this|here)|call (?:it|this|here)|it'?s called|its called|called|the name is|name it|name is)\s+)+/i;
const ALIAS = /\(?\s*(?:i |we )(?:just )?(?:call|know) (?:it|this|that|here)\s+["“']?([^"”',.()]{1,30})["”']?\s*\)?/i;
const TRAILER = /[,.;]?\s+(?:i |we )?(?:go|come|work|study|live|meet|stay|hang|usually|always|mostly|come here|its where|it'?s where)\b.*$/i;

/** His answer to ORION's question about a place: a name, a yes, a no, or null (something else entirely). */
export function readPlaceReply(message: string, pending?: PlacePending): PlaceReply | null {
  const m = message.trim().replace(/\s+/g, " ");
  if (!m || m.length > 220) return null;
  const flat = m.toLowerCase().replace(/[’]/g, "'");
  if (YES.test(flat)) return { kind: "yes" };
  if (NO.test(flat)) return { kind: "no" };
  if (/\?\s*$/.test(m) && !pending) return null;
  // Without a lead ("it's X", "this is X", "call it X") only an answer to a place question can be a bare name: the caller says so with `pending`.
  if (!NAME_LEAD.test(m) && !pending) return null;
  // Even in answer to a place question, a request or a question is not a name.
  if (!NAME_LEAD.test(m) && (/\?\s*$/.test(m) || /^(?:what|whats|what's|when|how|why|who|where|can|could|would|is|are|do|does|did|tell|show|move|add|set|remind|open|play|start|put|push|cancel|turn|log|text|call|check)\b/i.test(m))) return null;
  const alias = ALIAS.exec(m)?.[1]?.trim();
  let name = m.replace(ALIAS, " ").replace(NAME_LEAD, "").replace(TRAILER, "").replace(/[()"“”]/g, " ").replace(/\s+/g, " ").trim().replace(/[.,;!]+$/, "");
  name = name.replace(/^(?:the )?(?:place is|place called)\s+/i, "").trim();
  if (!name || name.length > 60 || name.split(" ").length > 6 || !/[a-z0-9]/i.test(name)) return null;
  return { kind: "name", name, ...(alias && alias.toLowerCase() !== name.toLowerCase() ? { alias } : {}) };
}

/** The place id for a name: lowercase, dashes. */
export const placeId = (name: string): string => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "place";

/** The name a model-drafted question carries ("Got it, Chapter Spitalfields. Want me to save that spot for you?"), or undefined. */
export function nameInQuestion(reply: string): string | undefined {
  const m = /^(?:got it|okay|ok|sure|nice|cool|noted)[,.]?\s+(?:so\s+)?(?:it'?s\s+|this is\s+)?([A-Z][A-Za-z0-9' &-]{2,50}?)[.!]\s/i.exec(reply.trim());
  return m?.[1]?.trim();
}

export const placeAskName = "Sure. What should I call it?";
export const placeDeclined = "Okay, I won't save it.";
export const placeSaved = (name: string): string => `Saved "${name}" as a place.`;
export const placeFailed = (why: string): string => `I couldn't save that place (${why.slice(0, 120)}), so nothing was saved.`;
