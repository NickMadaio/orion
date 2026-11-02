import { weatherDirective } from "./tool-moves.js";
const WEATHERISH = /\b(?:jacket|coat|umbrella|raincoat|rain\w*|drizzle|snow\w*|storm\w*|cold|freezing|chilly|warm|hot|heat|windy|weather|forecast|sunscreen|sun ?glasses|gloves|scarf|layers?)\b/i;
const LEAVE = /^leave in (\d{1,3}) min for (.+?) at (\d{1,2}:\d{2}\s*(?:am|pm)?)/i;
export function whyAnswer(o) {
    const text = o.text.trim();
    if (o.kind === "bedtime")
        return { kind: "say", text: "Because it's getting late for the bedtime you set, and the later you stay up the less sleep you get before your alarm." };
    const leave = text.match(LEAVE);
    if (leave)
        return { kind: "say", text: `Because ${leave[2].trim()} is at ${leave[3].trim()}, and leaving in about ${leave[1]} minutes is what gets you there on time.` };
    if (WEATHERISH.test(text)) {
        return weatherDirective(text);
    }
    if (o.kind === "start" && o.title)
        return { kind: "say", text: `Because ${o.title} was planned for about now and I hadn't seen it start.` };
    return undefined;
}
