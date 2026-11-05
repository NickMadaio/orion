export declare const LEAK_FALLBACK = "I couldn't finish that just now.";
/** A sentence that tells him to use one of our tools ("you can use the media_play_pause tool to control playback"): the id becomes "that", the rest stays. */
declare const TOOL_USE: RegExp;
/** The reply with our internal shapes cut out. `asked`: he asked about code, JSON, scripts or tools, so nothing is touched. */
export declare function finalSanitize(text: string, opts?: {
    asked?: boolean;
}): string;
/** He is asking about code, data or our tools: leave every word of the answer alone. */
export declare const askedForTechnical: (message: string | undefined) => boolean;
export { TOOL_USE };
