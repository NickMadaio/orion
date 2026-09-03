import { Type } from "typebox";
export declare const ConfigSchema: Type.TObject<{
    ledgerPath: Type.TOptional<Type.TString>;
    enableTestWorkspaceActions: Type.TOptional<Type.TBoolean>;
    testWorkspaceRoot: Type.TOptional<Type.TString>;
    enableScratchWorkspaceActions: Type.TOptional<Type.TBoolean>;
    scratchWorkspaceRoot: Type.TOptional<Type.TString>;
    enableDesktopReadActions: Type.TOptional<Type.TBoolean>;
    enableDesktopTestWorkspaceActions: Type.TOptional<Type.TBoolean>;
    enableDesktopModifyActions: Type.TOptional<Type.TBoolean>;
    enableDesktopDirectWriteActions: Type.TOptional<Type.TBoolean>;
    enableScratchDirectWriteActions: Type.TOptional<Type.TBoolean>;
    enableAppControlActions: Type.TOptional<Type.TBoolean>;
    enableBrowserControlActions: Type.TOptional<Type.TBoolean>;
    browserPreference: Type.TOptional<Type.TString>;
    enableMediaControlActions: Type.TOptional<Type.TBoolean>;
    enableHomeReadActions: Type.TOptional<Type.TBoolean>;
    homeRoot: Type.TOptional<Type.TString>;
    enableAmbientInfoActions: Type.TOptional<Type.TBoolean>;
    defaultWeatherLocation: Type.TOptional<Type.TString>;
    enableReminderActions: Type.TOptional<Type.TBoolean>;
    remindersPath: Type.TOptional<Type.TString>;
    enableFileMutateActions: Type.TOptional<Type.TBoolean>;
    trashRoot: Type.TOptional<Type.TString>;
    workshopPath: Type.TOptional<Type.TString>;
    enableHealthTrackingActions: Type.TOptional<Type.TBoolean>;
    healthLogPath: Type.TOptional<Type.TString>;
    enableCalendarActions: Type.TOptional<Type.TBoolean>;
    enableEpisodicCapture: Type.TOptional<Type.TBoolean>;
    episodicMemoryPath: Type.TOptional<Type.TString>;
    enableSelfTuningActions: Type.TOptional<Type.TBoolean>;
    enableSelfModificationActions: Type.TOptional<Type.TBoolean>;
    enableSelfPluginActions: Type.TOptional<Type.TBoolean>;
    enableSelfScriptsActions: Type.TOptional<Type.TBoolean>;
    enableSelfConfigActions: Type.TOptional<Type.TBoolean>;
    desktopRoot: Type.TOptional<Type.TString>;
    trustAllowPromptSource: Type.TOptional<Type.TBoolean>;
    trustAllowSessionBinding: Type.TOptional<Type.TBoolean>;
    trustAllowRecentBinding: Type.TOptional<Type.TBoolean>;
    trustAllowTranscriptSource: Type.TOptional<Type.TBoolean>;
    trustTranscriptAgent: Type.TOptional<Type.TString>;
    trustTtlMs: Type.TOptional<Type.TInteger>;
    trustRecentWindowMs: Type.TOptional<Type.TInteger>;
    permissionStatePath: Type.TOptional<Type.TString>;
    permissionAuditPath: Type.TOptional<Type.TString>;
    strictnessStatePath: Type.TOptional<Type.TString>;
    approvalRoot: Type.TOptional<Type.TString>;
    enableDevOperationsActions: Type.TOptional<Type.TBoolean>;
    enableAutomationActions: Type.TOptional<Type.TBoolean>;
    enableStrictArguments: Type.TOptional<Type.TBoolean>;
    enableV2SystemStatusAdapter: Type.TOptional<Type.TBoolean>;
}>;
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
    pluginConfig?: Record<string, unknown>;
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
