export type Risk = "low" | "medium" | "high" | "critical";
export type CapabilityTier = "simulation" | "app_control" | "test_workspace" | "scratch_workspace" | "desktop_read" | "desktop_test_workspace" | "desktop_modify" | "desktop_direct_write" | "scratch_direct_write";
export type ControlledRoot = "test_workspace" | "scratch_workspace" | "desktop";
export interface CreateOnlyTextPolicy {
    kind: "create_only_text";
    root: ControlledRoot;
    subdirectory: string;
    nameArgument: string;
    contentArgument: string;
    fixedExtension?: string;
    extensionArgument?: string;
    allowedExtensions: readonly string[];
    maxBytes: number;
}
export interface DesktopTextMutationPolicy {
    kind: "mutate_text";
    operation: "create" | "append" | "replace";
    root: "desktop";
    relativePathArgument: string;
    contentArgument: string;
    expectedHashArgument: string;
    resultHashArgument: string;
    allowedExtensions: readonly string[];
    maxContentBytes: number;
    maxResultBytes: number;
}
export interface DesktopFileMutationPolicy {
    kind: "mutate_file";
    root: ControlledRoot;
    relativePathArgument: string;
    operationArgument: string;
    encodingArgument: string;
    contentArgument: string;
    contentSourceArgument: string;
    expectedHashArgument: string;
    resultHashArgument: string;
    maxContentBytes: number;
    maxResultBytes: number;
}
export type ExecutionPolicy = {
    kind: "simulate";
} | {
    kind: "app_control";
    operation: "open" | "quit";
    applicationArgument: string;
} | CreateOnlyTextPolicy | DesktopTextMutationPolicy | DesktopFileMutationPolicy | {
    kind: "create_directory";
    root: ControlledRoot;
    relativePathArgument: string;
} | {
    kind: "list_directory";
    root: "desktop";
    relativePathArgument: string;
    maxEntries: number;
} | {
    kind: "path_metadata";
    root: "desktop";
    relativePathArgument: string;
} | {
    kind: "read_text";
    root: "desktop";
    relativePathArgument: string;
    allowedExtensions: readonly string[];
    maxBytes: number;
};
export interface ActionDefinition {
    risk: Risk;
    requiredArguments: string[];
    approvalRequired: boolean;
    verification: string;
    reversible: boolean;
    capabilityTier: CapabilityTier;
    execution: ExecutionPolicy;
    directUserAuthorizationRequired?: boolean;
    validateArguments?: (arguments_: Record<string, unknown>) => string[];
}
export declare function isSafeRelativePath(value: unknown, allowRoot?: boolean): value is string;
export declare function isVisibleNonSensitiveName(name: string): boolean;
export declare const ACTION_CATALOG: Readonly<Record<string, ActionDefinition>>;
