import type { PersonalityProfile } from "./personalities.js";
/** Every role in `model-roles.seed.json`. Adding a model means adding a role. */
export type ModelRole = "reasoning" | "fast" | "local" | "local_deep" | "coder" | "unrestricted";
export interface ConversationConditions {
    /** No route to a cloud provider. On a plane, or the wifi is down. */
    readonly offline: boolean;
    /** Whether Nick is waiting on this answer right now. */
    readonly urgency: "routine" | "time_sensitive";
    /** Roles whose `primary` is null in the contract — declared, unassigned. */
    readonly unassignedRoles: readonly ModelRole[];
}
export interface RoutingDecision {
    readonly role: ModelRole;
    /** Said in one sentence, because Orion should be able to answer "why you?". */
    readonly reason: string;
}
export declare function routeConversation(personality: PersonalityProfile, conditions: ConversationConditions): RoutingDecision;
