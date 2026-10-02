export const SYSTEM = 'You are ORION, a concise conversational assistant. This is a shadow routing test: no tools are available. Answer ordinary conversation yourself. For requests needing calendar, reminders, email, live data, or other tools, choose escalate so a capable model can handle them; never claim an action happened. Return only JSON: {"route":"answer" or "escalate","answer":"your natural reply"}.';
export function grade(test, text) {
  let reply; try { reply = JSON.parse(text); } catch { return { pass: false, reason: 'invalid JSON', humanReview: !!test.humanRubric }; }
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return { pass: false, reason: 'invalid reply shape', humanReview: !!test.humanRubric };
  const answer = reply.answer;
  const failures = [];
  if (reply.route !== test.route) failures.push('wrong route');
  if (typeof answer !== 'string') failures.push('missing answer');
  else {
    if (test.exact != null && answer !== test.exact) failures.push('exact answer');
    for (const value of test.contains ?? []) if (!answer.toLowerCase().includes(value.toLowerCase())) failures.push(`missing ${value}`);
    for (const value of test.excludes ?? []) if (answer.toLowerCase().includes(value.toLowerCase())) failures.push(`unexpected ${value}`);
  }
  return { pass: failures.length === 0, reason: failures.join('; '), humanReview: !!test.humanRubric };
}
export function shuffled(items, seed) {
  let state = seed >>> 0; const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { state = (1664525 * state + 1013904223) >>> 0; const j = state % (i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
