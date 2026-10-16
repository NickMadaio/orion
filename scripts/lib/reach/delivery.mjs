// Did an orion-reach run actually say it? (2026-10-16 audit, finding 6: "NOT SENT"
// exited 0, so orion-proactive marked the key as said and a "Leave in 11 min" was lost.)
// Said = sent, held (queued, not lost) or already said. Never a refusal or a failure.
export function deliveryOutcome({ status, stdout = "" }) {
  const out = String(stdout).trimStart();
  const failed = status === 4 || /^NOT SENT: delivery failed/.test(out);
  const said = status === 0 && /^(Sent|Held|Already said)/.test(out);
  return { said, failed, refused: !said && !failed };
}
