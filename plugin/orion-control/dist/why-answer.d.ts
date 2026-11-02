import type { Outreach } from "./outreach-reply.js";
import type { ToolDirective } from "./tool-moves.js";
export type WhyAnswer = {
    kind: "say";
    text: string;
} | Extract<ToolDirective, {
    kind: "call";
}>;
export declare function whyAnswer(o: Outreach): WhyAnswer | undefined;
