import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStrictness, targetOutsideResources } from "./strictness.js";
import { validateTaskGraph } from "./validator.js";
// Phase 50: "every delegation defines ... resources". "sovereign, but only under ~/Projects".
describe("a delegation scoped to folders", () => {
    const roots = { desktop: "/Users/n/Desktop", scratch_workspace: "/Users/n/.orion/scratch" };
    it("places file targets inside or outside the scope", () => {
        expect(targetOutsideResources({ root: "desktop", relativePath: "Projects/a.txt" }, ["/Users/n/Desktop/Projects"], roots)).toBeNull();
        expect(targetOutsideResources({ root: "desktop", relativePath: "Taxes/a.txt" }, ["/Users/n/Desktop/Projects"], roots))
            .toBe("/Users/n/Desktop/Taxes/a.txt");
        expect(targetOutsideResources({ path: "/Users/n/Desktop/Projects-old/x" }, ["/Users/n/Desktop/Projects"], roots))
            .toBe("/Users/n/Desktop/Projects-old/x");
        expect(targetOutsideResources({ root: "desktop", relativePath: "Projects/../Taxes" }, ["/Users/n/Desktop/Projects"], roots))
            .not.toBeNull();
        expect(targetOutsideResources({ root: "somewhere", relativePath: "a" }, ["/Users/n/Desktop"], roots)).not.toBeNull();
        // No scope, or nothing file-shaped: nothing to judge.
        expect(targetOutsideResources({ root: "desktop", relativePath: "Taxes/a.txt" }, [], roots)).toBeNull();
        expect(targetOutsideResources({ level: 40 }, ["/Users/n/Desktop/Projects"], roots)).toBeNull();
    });
    it("reads resources from the delegation file, dropping anything that is not an absolute clean path", async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "orion-resources-"));
        const file = path.join(directory, "strictness.json");
        await writeFile(file, JSON.stringify({ mode: "open", version: 1, resources: ["/Users/n/Projects", "relative/x", "/a/../b", 7] }));
        expect(resolveStrictness(file).state.resources).toEqual(["/Users/n/Projects"]);
    });
    it("makes a file action outside the scope need approval, and leaves one inside alone", () => {
        const graph = (relativePath) => ({
            version: "1", goal: "move a file", inputs: [{ id: "u", kind: "instruction", trust: "trusted_user", content: `move ${relativePath}` }],
            assumptions: [], retryBudget: 0,
            steps: [{ id: "s", action: "file_move", arguments: { root: "desktop", relativePath, destinationPath: `${relativePath}.moved` },
                    dependsOn: [], risk: "medium", expectedEffect: "moved", verify: "moved", sourceRefs: ["u"], reversible: true }],
        });
        const options = { enabledTiers: new Set(["simulation", "file_mutate"]),
            strictness: { mode: "open", resources: ["/Users/n/Desktop/Projects"], roots } };
        const inside = validateTaskGraph(graph("Projects/a.txt"), options);
        const outside = validateTaskGraph(graph("Taxes/a.txt"), options);
        expect(inside.issues.map((issue) => issue.code)).not.toContain("approval_required");
        expect(outside.issues.find((issue) => issue.code === "approval_required")?.message).toContain("outside the folders the current delegation covers");
    });
});
