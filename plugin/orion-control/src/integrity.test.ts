import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashTree, integrityProblem } from "./integrity.js";

// Phase 48: the installed plugin refuses to act if it is not the copy that was installed.
describe("installed-copy integrity", () => {
  async function installed() {
    const root = await mkdtemp(path.join(os.tmpdir(), "orion-integrity-"));
    const dist = path.join(root, "dist");
    await mkdir(dist);
    await writeFile(path.join(dist, "index.js"), "export const ok = true;\n");
    await writeFile(path.join(dist, "validator.js"), "export const strict = true;\n");
    const gate = path.join(root, "orion-control.json");
    await writeFile(gate, JSON.stringify({ name: "orion-control", root: dist, files: hashTree(dist) }));
    return { root, dist, gate };
  }

  it("is quiet when the copy is exactly what was installed", async () => {
    const { root, dist, gate } = await installed();
    expect(integrityProblem(dist, gate)).toBeNull();
    await rm(root, { recursive: true, force: true });
  });

  it("names a changed, removed or added file", async () => {
    const { root, dist, gate } = await installed();
    await writeFile(path.join(dist, "validator.js"), "export const strict = false;\n");
    expect(integrityProblem(dist, gate)).toContain("changed: validator.js");
    await rm(path.join(dist, "index.js"));
    expect(integrityProblem(dist, gate)).toContain("missing: index.js");
    await writeFile(path.join(dist, "extra.js"), "");
    expect(integrityProblem(dist, gate)).toContain("added: extra.js");
    await rm(root, { recursive: true, force: true });
  });

  it("does not judge a copy the manifest is not about, or when there is no manifest", async () => {
    const { root, dist, gate } = await installed();
    const other = path.join(root, "repo-dist");
    await mkdir(other);
    await writeFile(path.join(other, "index.js"), "different");
    expect(integrityProblem(other, gate)).toBeNull();
    expect(integrityProblem(dist, path.join(root, "absent.json"))).toBeNull();
    await rm(root, { recursive: true, force: true });
  });

  it("fails closed for the installed copy when no manifest exists, and hashes node_modules", async () => {
    const { root, dist, gate } = await installed();
    expect(integrityProblem(dist, path.join(root, "absent.json"), dist)).toContain("no integrity manifest");
    await mkdir(path.join(dist, "node_modules/typebox"), { recursive: true });
    await writeFile(path.join(dist, "node_modules/typebox/index.js"), "tampered");
    expect(integrityProblem(dist, gate)).toContain("added: node_modules/typebox/index.js");
    await rm(root, { recursive: true, force: true });
  });
});
