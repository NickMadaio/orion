import type { CapabilityTier } from "./catalog.js";
export declare const PERMISSION_PROFILES: readonly ["restricted_read_only", "approved_root_edit", "broad_local_filesystem", "consequential_local", "external_connected"];
export type PermissionProfile = (typeof PERMISSION_PROFILES)[number];
export declare const PROFILE_MATRIX: {
    readonly restricted_read_only: {
        readonly enabled: "Simulation and configured visible non-sensitive read/list/metadata actions.";
        readonly separatelyGated: "All writes, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control.";
    };
    readonly approved_root_edit: {
        readonly enabled: "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards.";
        readonly separatelyGated: "Delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control.";
    };
    readonly broad_local_filesystem: {
        readonly enabled: "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority.";
        readonly separatelyGated: "Each new root, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control.";
    };
    readonly consequential_local: {
        readonly enabled: "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed.";
        readonly separatelyGated: "Every consequential action, OS permission, external/account action, credential, communication, browser/web/network, and elevated macOS control.";
    };
    readonly external_connected: {
        readonly enabled: "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.";
        readonly separatelyGated: "Credentials, account connections, every delivery/communication, browser/web/network use, destructive actions, OS permissions, and elevated macOS control.";
    };
};
export interface PermissionState {
    profile: PermissionProfile;
    version: number;
    updatedAt: string;
}
export interface PermissionChangeRequest {
    requestedProfile: PermissionProfile;
    expectedVersion: number;
    context: string;
    request: {
        kind: "instruction" | "observation";
        trust: "trusted_user" | "trusted_policy" | "untrusted_external";
        content: string;
    };
    approvalHash?: string;
}
export declare function profileAllowedTiers(profile: PermissionProfile): ReadonlySet<CapabilityTier>;
export declare function readPermissionState(statePath: string): Promise<PermissionState>;
export declare function changePermissionProfile(request: PermissionChangeRequest, options: {
    statePath: string;
    auditPath: string;
    now?: () => Date;
}): Promise<{
    status: "rejected";
    reason: string;
    current: PermissionState;
    delta: {
        direction: "raise" | "lower" | "same";
        from: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        to: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        added: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        removed: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        remainsSeparatelyGated: "All writes, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Each new root, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Every consequential action, OS permission, external/account action, credential, communication, browser/web/network, and elevated macOS control." | "Credentials, account connections, every delivery/communication, browser/web/network use, destructive actions, OS permissions, and elevated macOS control.";
    };
    canonicalHash?: undefined;
    previous?: undefined;
} | {
    status: "stale";
    reason: string;
    current: PermissionState;
    delta: {
        direction: "raise" | "lower" | "same";
        from: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        to: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        added: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        removed: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        remainsSeparatelyGated: "All writes, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Each new root, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Every consequential action, OS permission, external/account action, credential, communication, browser/web/network, and elevated macOS control." | "Credentials, account connections, every delivery/communication, browser/web/network use, destructive actions, OS permissions, and elevated macOS control.";
    };
    canonicalHash?: undefined;
    previous?: undefined;
} | {
    status: "needs_approval";
    current: PermissionState;
    delta: {
        direction: "raise" | "lower" | "same";
        from: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        to: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        added: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        removed: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        remainsSeparatelyGated: "All writes, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Each new root, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Every consequential action, OS permission, external/account action, credential, communication, browser/web/network, and elevated macOS control." | "Credentials, account connections, every delivery/communication, browser/web/network use, destructive actions, OS permissions, and elevated macOS control.";
    };
    canonicalHash: string;
    reason?: undefined;
    previous?: undefined;
} | {
    status: "unchanged";
    current: PermissionState;
    delta: {
        direction: "raise" | "lower" | "same";
        from: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        to: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        added: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        removed: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        remainsSeparatelyGated: "All writes, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Each new root, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Every consequential action, OS permission, external/account action, credential, communication, browser/web/network, and elevated macOS control." | "Credentials, account connections, every delivery/communication, browser/web/network use, destructive actions, OS permissions, and elevated macOS control.";
    };
    canonicalHash: string;
    reason?: undefined;
    previous?: undefined;
} | {
    status: "changed";
    current: PermissionState;
    previous: PermissionState;
    delta: {
        direction: "raise" | "lower" | "same";
        from: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        to: "restricted_read_only" | "approved_root_edit" | "broad_local_filesystem" | "consequential_local" | "external_connected";
        added: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        removed: ("Simulation and configured visible non-sensitive read/list/metadata actions." | "Direct-user-authorized create/update within configured approved roots, plus opening or gracefully quitting an explicitly named installed app, with target and audit guards." | "Only catalog actions for separately configured local roots; selecting this profile does not create new roots or broad home-directory authority." | "Only installed consequential-local catalog actions with their own canonical confirmation; none are currently installed." | "Only explicitly connected and separately approved external catalog actions; none are granted by the profile itself.")[];
        remainsSeparatelyGated: "All writes, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Each new root, delete, move/rename, bulk operations, permissions, external/account actions, credentials, communications, browser/web/network, and elevated macOS control." | "Every consequential action, OS permission, external/account action, credential, communication, browser/web/network, and elevated macOS control." | "Credentials, account connections, every delivery/communication, browser/web/network use, destructive actions, OS permissions, and elevated macOS control.";
    };
    canonicalHash: string;
    reason?: undefined;
}>;
