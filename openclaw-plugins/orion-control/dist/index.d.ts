declare const entry: import("openclaw/plugin-sdk/tool-plugin").DefinedToolPluginEntry;
/**
 * Minimal surface of the host plugin API this plugin depends on for provenance.
 * Typed structurally so the plugin does not import runtime-internal types.
 */
interface ProvenanceHostApi {
    on?: (hookName: string, handler: (event: unknown, hookContext: unknown) => unknown, options?: {
        priority?: number;
    }) => void;
    logger?: {
        warn?: (message: string) => void;
    };
}
/**
 * Install the harness-only trust channel.
 *
 * These three host hooks are the ONLY writers of Orion's trust state:
 *   - message_received: the raw inbound user message for a turn.
 *   - llm_input:        the prompt the host assembled for a turn (fallback).
 *   - before_tool_call: binds the host tool-call id to the run that issued it.
 *
 * The model cannot invoke a hook, cannot choose the values a hook carries, and
 * cannot reach the store from tool parameters. If none of these fire, no
 * authenticated user turn exists and every gated action fails closed.
 */
export declare function installProvenanceHooks(api: ProvenanceHostApi): void;
export default entry;
