/*
 "why" to something ORION sent (W10-A1 follow-up, gate run-1102020539: "why" after "Heads up — take a jacket when you leave for the gym"
 got "I didn't actually do that — nothing was started or changed", because the worker answered about the weather with no lookup and the
 work-check turned that into a refusal).

 Code answers it. A weather notice (jacket, umbrella, rain, cold) is a weather lookup that code asks for and the worker only words from
 the result; a leave nudge, a bedtime line and a start line are explained from their own text. Anything else returns undefined and the
 worker gets the message as context (outreach-reply.ts whyNote). Pure: no I/O.
*/
import type { Outreach } from "./outreach-reply.js";
import type { ToolDirective } from "./tool-moves.js";
import { weatherDirective } from "./tool-moves.js";

export type WhyAnswer = { kind: "say"; text: string } | Extract<ToolDirective, { kind: "call" }>;

const WEATHERISH = /\b(?:jacket|coat|umbrella|raincoat|rain\w*|drizzle|snow\w*|storm\w*|cold|freezing|chilly|warm|hot|heat|windy|weather|forecast|sunscreen|sun ?glasses|gloves|scarf|layers?)\b/i;
const LEAVE = /^leave in (\d{1,3}) min for (.+?) at (\d{1,2}:\d{2}\s*(?:am|pm)?)/i;

export function whyAnswer(o: Outreach): WhyAnswer | undefined {
  const text = o.text.trim();
  if (o.kind === "bedtime") return { kind: "say", text: "Because it's getting late for the bedtime you set, and the later you stay up the less sleep you get before your alarm." };
  const leave = text.match(LEAVE);
  if (leave) return { kind: "say", text: `Because ${leave[2]!.trim()} is at ${leave[3]!.trim()}, and leaving in about ${leave[1]} minutes is what gets you there on time.` };
  if (WEATHERISH.test(text)) {
    return weatherDirective(text);
  }
  if (o.kind === "start" && o.title) return { kind: "say", text: `Because ${o.title} was planned for about now and I hadn't seen it start.` };
  return undefined;
}
