import { type CapabilityTier } from "./catalog.js";
export interface ToolParameter {
    name: string;
    description: string;
    required?: boolean;
}
export interface ToolStep {
    id: string;
    action: string;
    /** Values may contain `{{parameter}}` placeholders. */
    arguments: Record<string, unknown>;
    dependsOn?: string[];
}
export interface ComposedTool {
    name: string;
    description: string;
    rationale: string;
    parameters: ToolParameter[];
    steps: ToolStep[];
}
export interface ToolProposal extends ComposedTool {
    id: string;
    status: "proposed" | "approved" | "rejected";
    createdAt: string;
    decidedAt?: string;
    /** Hash of the body at the moment it was approved. */
    approvedHash?: string;
    reviewNote?: string;
}
export interface Workshop {
    schema: "orion.workshop.v1";
    updatedAt: string;
    tools: ToolProposal[];
}
/** Everything that is reviewed. Status and timestamps are deliberately out. */
export declare function toolBodyHash(tool: ComposedTool): string;
export declare function defaultWorkshopPath(configured?: string): string;
export declare function readWorkshop(file: string): Promise<Workshop>;
/**
 * Everything wrong with a draft, in one list.
 *
 * Run at PROPOSE time so Orion is told immediately, and again at RUN time so a
 * tool cannot become invalid later — by a catalog action being renamed, say —
 * and keep executing on the strength of an old approval.
 */
export declare function validateComposedTool(tool: ComposedTool): string[];
/** Tiers this tool will need. Shown at review so the cost is visible up front. */
export declare function requiredTiers(tool: ComposedTool): CapabilityTier[];
export declare function proposeTool(file: string, tool: ComposedTool): Promise<{
    proposal?: ToolProposal;
    issues: string[];
}>;
export declare function decideTool(file: string, id: string, decision: "approved" | "rejected", reviewNote?: string): Promise<ToolProposal | undefined>;
/**
 * The tools Orion may actually run.
 *
 * Approved, still hashing to what was approved, and still structurally valid
 * against the current catalog.
 */
export declare function activeTools(file: string): Promise<ToolProposal[]>;
export interface ExpandedGraph {
    goal: string;
    steps: Array<{
        id: string;
        action: string;
        arguments: Record<string, unknown>;
        dependsOn: string[];
    }>;
}
/**
 * Turn an approved tool plus its arguments into an ordinary task graph.
 *
 * Substitution is textual and values are stringified, which is safe here for a
 * reason worth stating: the result is not a command line, it is arguments to a
 * catalog action, and every one of those actions validates its own arguments
 * afterwards. A parameter carrying `../../..` is refused by the same path check
 * that refuses it when Orion writes it by hand.
 */
export declare function expandTool(tool: ComposedTool, parameters: Record<string, unknown>): {
    graph?: ExpandedGraph;
    issues: string[];
};
