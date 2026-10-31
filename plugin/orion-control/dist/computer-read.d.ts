/**
 * "whats on my screen" / "read this slide" (2026-10-30): the focused window's accessibility text and title first,
 * on-device OCR of the window (`screen_ocr`, Vision) when AX has too little text, and nothing else. Read-only:
 * this file never calls a bridge action that changes the screen.
 *
 * Screen text goes to the summariser inside an untrusted envelope with the instruction to treat it as data. The
 * summariser has no tools, so even text that talks like an instruction can only change words, never actions.
 */
import { type Observation } from "./computer-ax.js";
import { type ComputerBridge } from "./computer-bridge.js";
export type ScreenData = {
    readonly appName: string;
    readonly windowTitle: string | null;
    readonly lines: readonly string[];
    readonly source: "ax" | "ocr" | "ax+ocr";
};
export declare function readScreen(bridge: ComputerBridge, observation: Observation): Promise<ScreenData>;
export declare function screenPrompt(question: string, data: ScreenData): string;
/** The answer when no summariser is wired, or it fails: what app and window, and the first lines it shows. */
export declare function plainScreenReply(data: ScreenData): string;
export declare function failureReply(error: unknown, doing: "see" | "control"): string;
