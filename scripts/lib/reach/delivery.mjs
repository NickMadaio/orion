// Did an orion-reach run actually say it? (2026-10-16 audit, finding 6: "NOT SENT"
// exited 0, so orion-proactive marked the key as said and a "Leave in 11 min" was lost.)
// Said = sent, held (queued, not lost) or already said. Never a refusal or a failure.
export function deliveryOutcome({ status, stdout = "" }) {
  const out = String(stdout).trimStart();
  const failed = status === 4 || /^NOT SENT: delivery failed/.test(out);
  const said = status === 0 && /^(Sent|Held|Already said)/.test(out);
  // Dropped by a budget or the ceiling (or an earlier drop's cooldown): handled, and not to be retried on the next tick.
  const dropped = status === 3 && /^NOT SENT: (ceiling|budget|blank-budget|dropped|expired)/.test(out);
  return { said, failed, dropped, refused: !said && !failed };
}
