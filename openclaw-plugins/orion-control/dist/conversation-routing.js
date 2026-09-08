/** Roles that need a provider on the other side of the network. */
const CLOUD_ROLES = new Set(["reasoning"]);
/**
 * Where each cloud role goes when there is no network.
 *
 * `local_deep` rather than `local` for reasoning: offline is exactly when a slow
 * careful answer beats a fast shallow one, because there is no retry with a
 * better model waiting at the other end.
 */
const OFFLINE_SUBSTITUTE = {
    reasoning: "local_deep",
};
export function routeConversation(personality, conditions) {
    let role = personality.modelRoleLean;
    let reason = `${personality.label} leans on the ${role} role`;
    // A declared-but-unassigned role is an honest gap, not an error. Fall back to
    // the ordinary reasoning path and SAY so, rather than failing a conversation
    // over a model nobody has installed yet.
    if (conditions.unassignedRoles.includes(role)) {
        const previous = role;
        role = "reasoning";
        reason =
            `the ${previous} role is declared but has no model assigned, so this falls back ` +
                `to reasoning — tone is unchanged, only the model is`;
    }
    if (conditions.offline && CLOUD_ROLES.has(role)) {
        const substitute = OFFLINE_SUBSTITUTE[role] ?? "local";
        reason = `offline, so ${role} is unreachable and ${substitute} answers instead`;
        role = substitute;
    }
    // Time-sensitive work does not go to the deep local model. 198s is the right
    // price for a hard problem nobody is waiting on and the wrong one for a
    // question asked out loud.
    if (conditions.urgency === "time_sensitive" && role === "local_deep") {
        role = "local";
        reason = "asked in the moment, so the fast local model answers rather than the deep one";
    }
    return { role, reason };
}
