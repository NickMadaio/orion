import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addSupplement, readHealthLog, removeSupplement, updateSupplement } from "./health.js";
import { ACTION_CATALOG } from "./catalog.js";
async function logWith(names) {
    const dir = await mkdtemp(join(tmpdir(), "supp-"));
    const file = join(dir, "health-log.json");
    await writeFile(file, JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [], days: {} }));
    for (const name of names)
        await addSupplement(file, name);
    return file;
}
describe("supplement remove and update (2026-09-30)", () => {
    it("combining is remove the singles and add the combined item", async () => {
        const file = await logWith(["Creatine", "magnesium", "zinc", "calcium", "vitamin d3", "vitamin k2"]);
        await addSupplement(file, "magnesium, zinc & calcium");
        await addSupplement(file, "vitamin D3 & K2");
        for (const single of ["magnesium", "zinc", "calcium", "vitamin d3", "vitamin k2"]) {
            expect((await removeSupplement(file, single)).removed?.name).toBe(single);
        }
        const names = (await readHealthLog(file)).supplements.map((entry) => entry.name);
        expect(names).toEqual(["Creatine", "magnesium, zinc & calcium", "vitamin D3 & K2"]);
    });
    it("exact names win over partial matches", async () => {
        const file = await logWith(["magnesium", "magnesium, zinc & calcium"]);
        expect((await removeSupplement(file, "Magnesium")).removed?.name).toBe("magnesium");
    });
    it("an ambiguous name removes nothing and says which", async () => {
        const file = await logWith(["vitamin d3", "vitamin d drops"]);
        const result = await removeSupplement(file, "vitamin d");
        expect(result.removed).toBeUndefined();
        expect(result.ambiguous).toEqual(["vitamin d3", "vitamin d drops"]);
        expect((await readHealthLog(file)).supplements).toHaveLength(2);
    });
    it("update renames and sets the dose, keeping the id", async () => {
        const file = await logWith(["Ashwaganda"]);
        const before = (await readHealthLog(file)).supplements[0];
        const result = await updateSupplement(file, "ashwaganda", { newName: "Ashwagandha", dose: "600mg" });
        expect(result.updated).toMatchObject({ id: before.id, name: "Ashwagandha", dose: "600mg" });
    });
    it("a rename onto an existing name is refused", async () => {
        const file = await logWith(["zinc", "magnesium"]);
        expect((await updateSupplement(file, "zinc", { newName: "Magnesium" })).clash).toBe("Magnesium");
    });
    it("both actions are in the catalog with validation", () => {
        expect(ACTION_CATALOG.supplement_remove?.execution).toEqual({ kind: "health_log", operation: "supplement_remove" });
        expect(ACTION_CATALOG.supplement_update?.validateArguments?.({ name: "zinc" })).toEqual(["give newName, dose or timeOfDay"]);
    });
});
