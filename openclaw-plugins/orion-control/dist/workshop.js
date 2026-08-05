import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ACTION_CATALOG } from "./catalog.js";
const EMPTY = {
    schema: "orion.workshop.v1",
    updatedAt: new Date(0).toISOString(),
    tools: [],
};
/** Everything that is reviewed. Status and timestamps are deliberately out. */
export function toolBodyHash(tool) {
    return createHash("sha256")
        .update(JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        steps: tool.steps,
    }))
        .digest("hex");
}
export function defaultWorkshopPath(configured) {
    return configured
        ? path.resolve(configured)
        : path.resolve(".orion-control", "workshop.json");
}
export async function readWorkshop(file) {
    try {
        const parsed = JSON.parse(await readFile(file, "utf8"));
        if (parsed?.schema !== "orion.workshop.v1" || !Array.isArray(parsed.tools)) {
            return { ...EMPTY };
        }
        return parsed;
    }
    catch {
        return { ...EMPTY };
    }
}
async function writeWorkshop(file, workshop) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    workshop.updatedAt = new Date().toISOString();
    await writeFile(file, `${JSON.stringify(workshop, null, 2)}\n`, { mode: 0o600 });
}
const TOOL_NAME = /^[a-z][a-z0-9_]{2,47}$/;
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
/**
 * Everything wrong with a draft, in one list.
 *
 * Run at PROPOSE time so Orion is told immediately, and again at RUN time so a
 * tool cannot become invalid later — by a catalog action being renamed, say —
 * and keep executing on the strength of an old approval.
 */
export function validateComposedTool(tool) {
    const issues = [];
    if (typeof tool.name !== "string" || !TOOL_NAME.test(tool.name)) {
        issues.push("name must be lowercase letters, digits and underscores, 3-48 characters");
    }
    if (tool.name in ACTION_CATALOG) {
        issues.push(`'${tool.name}' is already a catalog action`);
    }
    if (typeof tool.description !== "string" || tool.description.trim().length < 10) {
        issues.push("description must say what the tool does");
    }
    if (typeof tool.rationale !== "string" || tool.rationale.trim().length < 10) {
        issues.push("rationale must say why this is worth having as a tool");
    }
    const parameters = Array.isArray(tool.parameters) ? tool.parameters : [];
    const parameterNames = new Set();
    for (const parameter of parameters) {
        if (typeof parameter?.name !== "string" || !/^[a-zA-Z0-9_]+$/.test(parameter.name)) {
            issues.push("every parameter needs a simple name");
            continue;
        }
        parameterNames.add(parameter.name);
    }
    const steps = Array.isArray(tool.steps) ? tool.steps : [];
    if (steps.length === 0)
        issues.push("a tool needs at least one step");
    if (steps.length > 16)
        issues.push("a tool may declare at most 16 steps");
    const stepIds = new Set();
    for (const step of steps) {
        if (typeof step?.id !== "string" || step.id.length === 0) {
            issues.push("every step needs an id");
            continue;
        }
        if (stepIds.has(step.id))
            issues.push(`duplicate step id '${step.id}'`);
        stepIds.add(step.id);
        // The load-bearing check. A composed tool is a recipe over vetted actions;
        // an unknown action name is the one way it could mean anything else.
        if (typeof step.action !== "string" || !(step.action in ACTION_CATALOG)) {
            issues.push(`step '${step.id}' names '${step.action}', which is not a catalog action`);
            continue;
        }
        for (const value of Object.values(step.arguments ?? {})) {
            if (typeof value !== "string")
                continue;
            for (const [, name] of value.matchAll(PLACEHOLDER)) {
                if (!parameterNames.has(name)) {
                    issues.push(`step '${step.id}' uses {{${name}}}, which is not a parameter`);
                }
            }
        }
    }
    for (const step of steps) {
        for (const dependency of step.dependsOn ?? []) {
            if (!stepIds.has(dependency)) {
                issues.push(`step '${step.id}' depends on '${dependency}', which does not exist`);
            }
        }
    }
    return issues;
}
/** Tiers this tool will need. Shown at review so the cost is visible up front. */
export function requiredTiers(tool) {
    const tiers = new Set();
    for (const step of tool.steps ?? []) {
        const definition = ACTION_CATALOG[step.action];
        if (definition)
            tiers.add(definition.capabilityTier);
    }
    return [...tiers].sort();
}
export async function proposeTool(file, tool) {
    const issues = validateComposedTool(tool);
    if (issues.length > 0)
        return { issues };
    const workshop = await readWorkshop(file);
    const proposal = {
        ...tool,
        id: `${tool.name}-${toolBodyHash(tool).slice(0, 10)}`,
        status: "proposed",
        createdAt: new Date().toISOString(),
    };
    // Re-proposing the same name replaces an undecided draft rather than piling
    // up near-identical entries for Nick to read through.
    workshop.tools = [
        ...workshop.tools.filter((entry) => !(entry.name === tool.name && entry.status === "proposed")),
        proposal,
    ];
    await writeWorkshop(file, workshop);
    return { proposal, issues: [] };
}
export async function decideTool(file, id, decision, reviewNote) {
    const workshop = await readWorkshop(file);
    const proposal = workshop.tools.find((entry) => entry.id === id);
    if (!proposal)
        return undefined;
    proposal.status = decision;
    proposal.decidedAt = new Date().toISOString();
    if (reviewNote)
        proposal.reviewNote = reviewNote;
    // Bind the approval to what was actually read. If the body is edited later
    // the hash stops matching and `activeTools` drops it.
    proposal.approvedHash =
        decision === "approved" ? toolBodyHash(proposal) : undefined;
    await writeWorkshop(file, workshop);
    return proposal;
}
/**
 * The tools Orion may actually run.
 *
 * Approved, still hashing to what was approved, and still structurally valid
 * against the current catalog.
 */
export async function activeTools(file) {
    const workshop = await readWorkshop(file);
    return workshop.tools.filter((tool) => tool.status === "approved" &&
        tool.approvedHash === toolBodyHash(tool) &&
        validateComposedTool(tool).length === 0);
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
export function expandTool(tool, parameters) {
    const issues = [];
    for (const parameter of tool.parameters) {
        const supplied = parameters[parameter.name];
        if (parameter.required !== false && (supplied === undefined || supplied === "")) {
            issues.push(`missing required parameter '${parameter.name}'`);
        }
    }
    if (issues.length > 0)
        return { issues };
    const substitute = (value) => {
        if (typeof value !== "string")
            return value;
        let unresolved = false;
        const replaced = value.replace(PLACEHOLDER, (_match, name) => {
            const supplied = parameters[name];
            if (supplied === undefined) {
                unresolved = true;
                return "";
            }
            return String(supplied);
        });
        if (unresolved)
            issues.push(`no value supplied for {{...}} in '${value}'`);
        return replaced;
    };
    const steps = tool.steps.map((step) => ({
        id: step.id,
        action: step.action,
        arguments: Object.fromEntries(Object.entries(step.arguments ?? {}).map(([key, value]) => [
            key,
            substitute(value),
        ])),
        dependsOn: step.dependsOn ?? [],
    }));
    if (issues.length > 0)
        return { issues };
    return { graph: { goal: `${tool.name}: ${tool.description}`, steps }, issues: [] };
}
