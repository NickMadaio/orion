import { type ToolResult } from "./work-check.js";
/** One of the variants, chosen from the seed; with `key`, never the same one twice in a row for that key. */
export declare function pickVariant<T>(key: string | undefined, seed: string, list: readonly T[]): T;
export declare const resetVariants: () => void;
export declare const attemptPhrase: (t: ToolResult) => string;
/** What the failed tools say went wrong, with the next step. Empty when nothing failed. */
export declare function failureStory(tools: ReadonlyArray<ToolResult>): string;
export type HonestCtx = {
    calendar: boolean;
    message?: string;
    tools?: ReadonlyArray<ToolResult>;
    rotate?: boolean;
};
/** A bare "go" / "that one" with no tool run and nothing to say yes to: said plainly, then asked (live gate 3 #97 #98, not "I got ahead of myself"). */
export declare const NOTHING_PENDING_LINES: string[];
export declare const isBareGoAhead: (message: string | undefined) => boolean;
/** The honest line for a reply that claimed more than the tools show. From tool results when there are any. */
export declare function honestReply(ctx: HonestCtx): string;
/** True when the model's reply plainly says nothing happened and claims no change. The check may flag "is already running"; that stays. */
export declare function truthfulDenial(reply: string, tools?: ReadonlyArray<ToolResult>): boolean;
/** A different, more useful reply to the same failed ask: the reason plus a concrete alternative. */
export declare function repeatedFailure(previous: string, level: number, key?: string): string;
export declare const BUILD_OFFER: RegExp;
export declare const offersBuild: (text: string) => boolean;
/** A short phrase for what he asked ("close some of the apps that are open"), pronouns turned around. */
export declare function gistOf(message: string): string;
/** The honest line when the capability is missing: what is missing in plain words, and the offer that hands off to the self-fix flow. */
export declare function capabilityLine(message: string, key?: string): string;
/** The reply to use in place of a model refusal that neither tried nor explained: the capability line. */
export declare function refusalRewrite(reply: string, message: string, tools?: ReadonlyArray<ToolResult>, key?: string): string | undefined;
