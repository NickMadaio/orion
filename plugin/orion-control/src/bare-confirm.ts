/*
 A bare go-ahead ("go", "yeah go on", "do it", "ok sure") says nothing about topics (w20 xf-other, live gate 2, #38 #41 #81).
 Searching his notes with those words fetched an old bedtime nudge from the brain, and the worker answered THAT ("You're still awake past
 your bedtime...") instead of the offer it had just made. A bare confirm never pulls notes into the prompt.
*/
const FILLER = "(?:y|ya|yeah|yea|yep|yup|yes|ok|okay|k|sure|alright|aight|fine|please|pls|lol|then|now|just|actually|and|so|thanks|thx)";
const GO = "(?:go|go on|go ahead|go for it|do it|do that|lets go|let'?s go|lets do it|let'?s do it|sounds good|that works|carry on|proceed|continue|run it|yes do it|make it so)";
const BARE = new RegExp(`^(?:${FILLER}[, ]+)*${GO}(?:[, ]+${FILLER})*$|^(?:${FILLER}[, ]*)+$`, "i");

/** True for a message that is only a go-ahead. */
export const isBareConfirm = (message: string): boolean => {
  const said = message.toLowerCase().replace(/[’]/g, "'").replace(/[.!?…]+/g, " ").replace(/\s+/g, " ").trim();
  return said.length > 0 && said.length <= 40 && BARE.test(said);
};
