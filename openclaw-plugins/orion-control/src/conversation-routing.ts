/*
 Which model answers, and why. One voice; several models behind it.

 This is the piece that makes "different kinds of Orion chat" mean something
 mechanical rather than a change of tone. A personality already declares which
 ROLE it leans on -- never a model id, so leaning can never introduce a model, a
 provider or a credential that was not already configured. This file turns that
 lean, plus the conditions of the moment, into the role that actually answers.

 THE SHAPE IT IS COPYING

 Jarvis is one identity with many subsystems, and Tony never picks which one
 handles a sentence. Claude Code is a main loop that hands work to subagents on
 different models and returns one answer. Both work because the routing is
 INVISIBLE and the identity is CONSTANT. So: Orion does not become a different
 assistant in Research mode. He is the same assistant, thinking with a different
 model, remembering differently, and reaching for sources differently.

 THE RULE THAT DOES NOT MOVE

   Unrestricted speech; restricted capabilities.

 A personality changes tone, memory, planning style and which model runs. It
 cannot change one capability, tier, root or approval. That is enforced in
 `personalities.ts` by there being nowhere to express it -- see the compile-time
 proof in its test file. This file inherits that: it returns a ROLE NAME and a
 reason, and nothing else. It cannot widen anything because it has nothing to
 widen with.
*/
import type { PersonalityProfile } from "./personalities.js";

/** Every role in `model-roles.seed.json`. Adding a model means adding a role. */
export type ModelRole =
  | "reasoning"
  | "fast"
  | "local"
  | "local_deep"
  | "coder"
  | "unrestricted";

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

/** Roles that need a provider on the other side of the network. */
const CLOUD_ROLES: ReadonlySet<ModelRole> = new Set<ModelRole>(["reasoning"]);

/**
 * Where each cloud role goes when there is no network.
 *
 * `local_deep` rather than `local` for reasoning: offline is exactly when a slow
 * careful answer beats a fast shallow one, because there is no retry with a
 * better model waiting at the other end.
 */
const OFFLINE_SUBSTITUTE: Readonly<Record<string, ModelRole>> = {
  reasoning: "local_deep",
};

export function routeConversation(
  personality: PersonalityProfile,
  conditions: ConversationConditions,
): RoutingDecision {
  let role = personality.modelRoleLean as ModelRole;
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
