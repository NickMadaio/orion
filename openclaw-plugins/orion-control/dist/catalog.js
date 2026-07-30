const SAFE_NAME = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const SENSITIVE_NAME = /^(?:credentials?|secrets?|tokens?|id_(?:rsa|dsa|ecdsa|ed25519)|authorized_keys|known_hosts)(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RELATIVE_PATH_LENGTH = 1024;
const MAX_PATH_SEGMENTS = 32;
const MAX_SEGMENT_LENGTH = 255;
export function isSafeRelativePath(value, allowRoot = false) {
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
        return false;
    }
    if (value.length > MAX_RELATIVE_PATH_LENGTH)
        return false;
    if (allowRoot && value === ".")
        return true;
    if (value.startsWith("/") || value.startsWith("~") || value.includes("\\")) {
        return false;
    }
    const segments = value.split("/");
    if (segments.length > MAX_PATH_SEGMENTS)
        return false;
    return segments.every((segment) => segment.length > 0 &&
        segment.length <= MAX_SEGMENT_LENGTH &&
        segment !== "." &&
        segment !== ".." &&
        !segment.startsWith(".") &&
        !SENSITIVE_NAME.test(segment));
}
/**
 * Hashes are derived server-side from the exact bytes the executor is about to
 * write. A caller MAY still assert them, in which case the assertion is
 * enforced as an extra optimistic-concurrency check; omitting them is the
 * normal path and carries no security weight.
 */
function validateOptionalHashes(arguments_, operation, expectedHashArgument, resultHashArgument) {
    const issues = [];
    const expectedHash = arguments_[expectedHashArgument];
    const resultHash = arguments_[resultHashArgument];
    if (expectedHash !== undefined) {
        const valid = operation === "create"
            ? expectedHash === "absent"
            : typeof expectedHash === "string" && SHA256.test(expectedHash);
        if (!valid) {
            issues.push(operation === "create"
                ? `${expectedHashArgument} may be omitted, or must be exactly absent for create`
                : `${expectedHashArgument} may be omitted, or must be a lowercase SHA-256 hash`);
        }
    }
    if (resultHash !== undefined &&
        (typeof resultHash !== "string" || !SHA256.test(resultHash))) {
        issues.push(`${resultHashArgument} may be omitted, or must be a lowercase SHA-256 hash`);
    }
    return issues;
}
export function isVisibleNonSensitiveName(name) {
    return (name.length > 0 &&
        name !== "." &&
        name !== ".." &&
        !name.startsWith(".") &&
        !SENSITIVE_NAME.test(name));
}
function validateCreateOnlyText(policy, arguments_) {
    const issues = [];
    const name = arguments_[policy.nameArgument];
    const content = arguments_[policy.contentArgument];
    const extension = policy.fixedExtension
        ? policy.fixedExtension
        : policy.extensionArgument
            ? arguments_[policy.extensionArgument]
            : undefined;
    if (typeof name !== "string" || !SAFE_NAME.test(name)) {
        issues.push(`${policy.nameArgument} must be 1-64 lowercase letters, digits, underscores, or hyphens`);
    }
    if (typeof extension !== "string" ||
        !policy.allowedExtensions.includes(extension)) {
        issues.push(`${policy.extensionArgument ?? "extension"} must be one of: ${policy.allowedExtensions.join(", ")}`);
    }
    if (typeof content !== "string" ||
        content.length === 0 ||
        Buffer.byteLength(content, "utf8") > policy.maxBytes ||
        content.includes("\0")) {
        issues.push(`${policy.contentArgument} must be 1-${policy.maxBytes} UTF-8 bytes and contain no NUL byte`);
    }
    return issues;
}
function createOnlyText(definition) {
    return {
        ...definition,
        validateArguments: (arguments_) => validateCreateOnlyText(definition.execution, arguments_),
    };
}
function desktopTextMutation(operation) {
    const execution = {
        kind: "mutate_text",
        operation,
        root: "desktop",
        relativePathArgument: "relativePath",
        contentArgument: "content",
        expectedHashArgument: "expectedHash",
        resultHashArgument: "resultHash",
        allowedExtensions: ["txt", "md"],
        maxContentBytes: 4096,
        maxResultBytes: 65536,
    };
    return {
        risk: "medium",
        // expectedHash / resultHash are derived server-side from the exact bytes
        // written, so callers supply intent + target + content only.
        requiredArguments: ["relativePath", "content"],
        approvalRequired: true,
        // The canonical approval hash is computable by the caller, so on its own it
        // is not an authorization gate. The real user turn must also name the
        // operation and the exact target.
        directUserAuthorizationRequired: true,
        verification: "desktop_text_result_hash_matches",
        reversible: operation === "create",
        capabilityTier: "desktop_modify",
        execution,
        validateArguments(arguments_) {
            const issues = [];
            const relativePath = arguments_.relativePath;
            const content = arguments_.content;
            if (!isSafeRelativePath(relativePath)) {
                issues.push("relativePath must stay within Desktop and contain no hidden or sensitive path segment");
            }
            else {
                const extension = relativePath.split(".").at(-1)?.toLowerCase();
                if (!execution.allowedExtensions.includes(extension ?? "")) {
                    issues.push("relativePath extension must be one of: txt, md");
                }
            }
            if (typeof content !== "string" ||
                content.includes("\0") ||
                Buffer.byteLength(content, "utf8") > execution.maxContentBytes) {
                issues.push(`content must be 0-${execution.maxContentBytes} UTF-8 bytes and contain no NUL byte`);
            }
            issues.push(...validateOptionalHashes(arguments_, operation, "expectedHash", "resultHash"));
            return issues;
        },
    };
}
function validateEncodedContent(content, encoding, maxBytes) {
    if (typeof content !== "string")
        return ["content must be a string"];
    if (encoding === undefined || encoding === "utf8") {
        return Buffer.byteLength(content, "utf8") <= maxBytes
            ? []
            : [`content must not exceed ${maxBytes} bytes`];
    }
    if (encoding !== "base64")
        return ["encoding must be utf8 or base64"];
    if (content.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
        return ["content must be canonical base64"];
    }
    return Buffer.from(content, "base64").byteLength <= maxBytes
        ? []
        : [`decoded content must not exceed ${maxBytes} bytes`];
}
function directFolderCreate(root, capabilityTier) {
    return {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        directUserAuthorizationRequired: true,
        verification: "scoped_directory_exists",
        reversible: true,
        capabilityTier,
        execution: {
            kind: "create_directory",
            root,
            relativePathArgument: "relativePath",
        },
        validateArguments(arguments_) {
            return isSafeRelativePath(arguments_.relativePath)
                ? []
                : [
                    "relativePath must stay within the configured root and contain no hidden or sensitive path segment",
                ];
        },
    };
}
function directFileWrite(root, capabilityTier) {
    const execution = {
        kind: "mutate_file",
        root,
        relativePathArgument: "relativePath",
        operationArgument: "operation",
        encodingArgument: "encoding",
        contentArgument: "content",
        contentSourceArgument: "contentSource",
        expectedHashArgument: "expectedHash",
        resultHashArgument: "resultHash",
        maxContentBytes: 1048576,
        maxResultBytes: 8388608,
    };
    return {
        risk: "medium",
        // encoding defaults to utf8, contentSource defaults to inline_user_request,
        // and both hashes are derived server-side from the exact bytes written.
        requiredArguments: ["relativePath", "operation", "content"],
        approvalRequired: false,
        directUserAuthorizationRequired: true,
        verification: "scoped_file_result_hash_matches",
        reversible: false,
        capabilityTier,
        execution,
        validateArguments(arguments_) {
            const issues = [];
            if (!isSafeRelativePath(arguments_.relativePath)) {
                issues.push("relativePath must stay within the configured root and contain no hidden or sensitive path segment");
            }
            const operation = arguments_.operation;
            if (!["create", "append", "replace"].includes(String(operation))) {
                issues.push("operation must be create, append, or replace");
            }
            if (arguments_.contentSource !== undefined &&
                arguments_.contentSource !== "inline_user_request") {
                issues.push("contentSource may be omitted, or must be inline_user_request");
            }
            issues.push(...validateEncodedContent(arguments_.content, arguments_.encoding, execution.maxContentBytes));
            issues.push(...validateOptionalHashes(arguments_, operation === "create" || operation === "append" || operation === "replace"
                ? operation
                : undefined, "expectedHash", "resultHash"));
            return issues;
        },
    };
}
export const ACTION_CATALOG = {
    folder_create: {
        risk: "low",
        requiredArguments: ["path"],
        approvalRequired: false,
        verification: "folder_exists",
        reversible: true,
        capabilityTier: "simulation",
        execution: { kind: "simulate" },
    },
    app_open: {
        risk: "low",
        requiredArguments: ["application"],
        approvalRequired: false,
        verification: "application_is_open",
        reversible: true,
        capabilityTier: "app_control",
        execution: {
            kind: "app_control",
            operation: "open",
            applicationArgument: "application",
        },
        directUserAuthorizationRequired: true,
        validateArguments: (arguments_) => typeof arguments_.application === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9 .&'()+_-]{0,79}$/.test(arguments_.application)
            ? []
            : ["application must be a plain installed app name"],
    },
    app_quit: {
        risk: "low",
        requiredArguments: ["application"],
        approvalRequired: false,
        verification: "application_is_closed",
        reversible: true,
        capabilityTier: "app_control",
        execution: {
            kind: "app_control",
            operation: "quit",
            applicationArgument: "application",
        },
        directUserAuthorizationRequired: true,
        validateArguments: (arguments_) => typeof arguments_.application === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9 .&'()+_-]{0,79}$/.test(arguments_.application)
            ? []
            : ["application must be a plain installed app name"],
    },
    timer_set: {
        risk: "low",
        requiredArguments: ["minutes"],
        approvalRequired: false,
        verification: "timer_exists",
        reversible: true,
        capabilityTier: "simulation",
        execution: { kind: "simulate" },
    },
    reminder_create: {
        risk: "low",
        requiredArguments: ["title", "due"],
        approvalRequired: false,
        verification: "reminder_exists",
        reversible: true,
        capabilityTier: "simulation",
        execution: { kind: "simulate" },
    },
    email_send: {
        risk: "high",
        requiredArguments: ["to", "subject", "body"],
        approvalRequired: true,
        verification: "message_in_sent_mail",
        reversible: false,
        capabilityTier: "simulation",
        execution: { kind: "simulate" },
    },
    file_delete: {
        risk: "high",
        requiredArguments: ["path"],
        approvalRequired: true,
        verification: "path_absent",
        reversible: false,
        capabilityTier: "simulation",
        execution: { kind: "simulate" },
    },
    test_marker_create: createOnlyText({
        risk: "low",
        requiredArguments: ["marker", "content"],
        approvalRequired: false,
        verification: "test_marker_content_matches",
        reversible: true,
        capabilityTier: "test_workspace",
        execution: {
            kind: "create_only_text",
            root: "test_workspace",
            subdirectory: "markers",
            nameArgument: "marker",
            contentArgument: "content",
            fixedExtension: "txt",
            allowedExtensions: ["txt"],
            maxBytes: 512,
        },
    }),
    scratch_text_create: createOnlyText({
        risk: "low",
        requiredArguments: ["name", "extension", "content"],
        approvalRequired: false,
        verification: "scratch_text_content_matches",
        reversible: true,
        capabilityTier: "scratch_workspace",
        execution: {
            kind: "create_only_text",
            root: "scratch_workspace",
            subdirectory: "artifacts",
            nameArgument: "name",
            extensionArgument: "extension",
            contentArgument: "content",
            allowedExtensions: ["txt", "md"],
            maxBytes: 4096,
        },
    }),
    desktop_list: {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        verification: "desktop_listing_matches",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: {
            kind: "list_directory",
            root: "desktop",
            relativePathArgument: "relativePath",
            maxEntries: 100,
        },
        validateArguments(arguments_) {
            return isSafeRelativePath(arguments_.relativePath, true)
                ? []
                : ["relativePath must stay within Desktop and contain no hidden or sensitive path segment"];
        },
    },
    desktop_metadata: {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        verification: "desktop_metadata_matches",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: {
            kind: "path_metadata",
            root: "desktop",
            relativePathArgument: "relativePath",
        },
        validateArguments(arguments_) {
            return isSafeRelativePath(arguments_.relativePath)
                ? []
                : ["relativePath must stay within Desktop and contain no hidden or sensitive path segment"];
        },
    },
    desktop_text_read: {
        risk: "low",
        requiredArguments: ["relativePath"],
        approvalRequired: false,
        verification: "desktop_text_content_matches",
        reversible: true,
        capabilityTier: "desktop_read",
        execution: {
            kind: "read_text",
            root: "desktop",
            relativePathArgument: "relativePath",
            allowedExtensions: ["txt", "md", "json"],
            maxBytes: 16384,
        },
        validateArguments(arguments_) {
            const relativePath = arguments_.relativePath;
            if (!isSafeRelativePath(relativePath)) {
                return ["relativePath must stay within Desktop and contain no hidden or sensitive path segment"];
            }
            const extension = relativePath.split(".").at(-1)?.toLowerCase();
            return ["txt", "md", "json"].includes(extension ?? "")
                ? []
                : ["relativePath extension must be one of: txt, md, json"];
        },
    },
    desktop_test_text_create: createOnlyText({
        risk: "low",
        requiredArguments: ["name", "extension", "content"],
        approvalRequired: false,
        verification: "desktop_test_text_content_matches",
        reversible: true,
        capabilityTier: "desktop_test_workspace",
        execution: {
            kind: "create_only_text",
            root: "desktop",
            subdirectory: "Orion Controlled Test Workspace/artifacts",
            nameArgument: "name",
            extensionArgument: "extension",
            contentArgument: "content",
            allowedExtensions: ["txt", "md"],
            maxBytes: 4096,
        },
    }),
    desktop_text_create_confirmed: desktopTextMutation("create"),
    desktop_text_append_confirmed: desktopTextMutation("append"),
    desktop_text_replace_confirmed: desktopTextMutation("replace"),
    desktop_folder_create_explicit: directFolderCreate("desktop", "desktop_direct_write"),
    desktop_file_write_explicit: directFileWrite("desktop", "desktop_direct_write"),
    scratch_folder_create_explicit: directFolderCreate("scratch_workspace", "scratch_direct_write"),
    scratch_file_write_explicit: directFileWrite("scratch_workspace", "scratch_direct_write"),
};
