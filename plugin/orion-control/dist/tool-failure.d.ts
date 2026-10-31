import { type ToolResult } from "./work-check.js";
/** True when the host would count this reply as owning a failed command (so it appends no raw line). */
export declare const acknowledgesFailure: (text: string) => boolean;
/** Tool results this turn that failed or wrote nothing (a flow's own outputs are code-authored and filtered by the caller). */
export declare function failedTools(tools: ReadonlyArray<ToolResult>): ToolResult[];
/** True when any tool this turn really changed something. */
export declare const wroteSomething: (tools: ReadonlyArray<ToolResult>) => boolean;
/** One short human clause for why a tool failed ("" when the output says nothing a person could use). Never raw text. */
export declare function failureReason(stdout: string): string;
/** The sentence that owns the failure. Always satisfies acknowledgesFailure. */
export declare function acknowledgement(failed: ReadonlyArray<ToolResult>, changeRequest: boolean, withReason?: boolean): string;
