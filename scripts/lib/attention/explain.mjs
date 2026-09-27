/**
 * Explain why an attention item was routed where it went.
 *
 * @param {object} item - the attention item
 * @param {object} scored - { score, known, unknown } from score.mjs
 * @param {object} gated - { route, reason } from gate.mjs
 * @returns {string[]} array of plain-sentence explanations
 */
export function explainAttention(item, scored, gated) {
  const sentences = [];

  // First sentence: gate reason
  sentences.push(reasonSentence(gated.reason, gated.route));

  // Second sentence: score summary
  if (scored.score === null) {
    sentences.push(`Only ${scored.known.length} of 6 signals are known.`);
  } else {
    sentences.push(`Scored ${scored.score} from ${scored.known.length} of 6 signals.`);
  }

  // Third sentence: unknown signals (only if any)
  if (scored.unknown && scored.unknown.length > 0) {
    sentences.push(`Unknown: ${scored.unknown.join(", ")}.`);
  }

  return sentences;
}

/**
 * Map a gate reason code to its human-readable sentence.
 */
function reasonSentence(reason, route) {
  const table = {
    expired: "Dropped: it expired.",
    unranked: "Filed for later: too little is known to rank it.",
    quiet_hours: "Held for later: it is quiet hours and this is not urgent enough to break them.",
    focus_active: "Held for later: you are focusing and this can wait.",
    focus_unknown: "Held for later: it is not known whether you are focusing, so it waits.",
    score: "Shown now: it scored high enough to interrupt.",
    low_score: "Filed for later: worth knowing, not worth interrupting for.",
  };

  if (reason in table) {
    return table[reason];
  }

  // Fallback for any unexpected reason
  return `Routed to ${route}: ${reason}.`;
}
