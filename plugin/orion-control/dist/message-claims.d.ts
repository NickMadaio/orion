import type { ToolResult } from "./work-check.js";
/** True when the reply denies messages yet reports some, or the messages read this turn returned some. */
export declare function denialContradictsMessages(reply: string, turnResults: ToolResult[], now?: Date): boolean;
