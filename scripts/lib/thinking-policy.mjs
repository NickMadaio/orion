// When ORION thinks (2026-10-07): the same rule as MobileCore/ThinkingPolicy.swift.
// Ordinary talk: off. His day, to-dos, times, or several steps at once: low.
// Local (ollama/) models never think.
const ACTION = /\b(re)?schedul\w*|\bcalendar\b|\bplan\w*\b|\b(move|shift|push|swap|extend|shorten|resize|cancel|skip|drop|delete|remove|clear|book)\b|\b(longer|shorter|earlier|later)\b|\b(block|event|class|lecture|lab|seminar|meeting|appointment)s?\b|\bto-?dos?\b|\btasks?\b|\bremind\w*\b|\b(deadline|due)\b|\b(tomorrow|tonight|this (morning|afternoon|evening))\b|\b(until|before|after|between)\b|\borgani[sz]e\b|\bpriorit\w*\b|\bfocus session\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b/i;

export function needsReasoning(text) {
  const said = String(text ?? "");
  return ACTION.test(said) || said.split(/\s+/).filter(Boolean).length >= 35;
}

export function thinkingLevel(text, { model } = {}) {
  if (String(model ?? "").startsWith("ollama/")) return "off";
  return needsReasoning(text) ? "low" : "off";
}
