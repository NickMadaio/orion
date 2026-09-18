import { mkdtemp, writeFile, readFile, mkdir, symlink, rm, open, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTION_CATALOG, type ControlledRoot } from "./catalog.js";
import { executeAction, verifyAction, type ExecutionContext } from "./executors.js";
import { runTaskGraph } from "./controller.js";
import type { TaskStep } from "./types.js";

let directory: string;
let context: ExecutionContext;
const definition = ACTION_CATALOG.file_copy;
function step(source = "source.bin", destination = "copy.bin"): TaskStep {
  return { id:"copy", action:"file_copy", arguments:{root:"desktop", relativePath:source, destinationPath:destination},
    dependsOn:[], risk:"medium", expectedEffect:"Copy without changing source", verify:"file_copy_matches_source",
    sourceRefs:["request"], reversible:true };
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "orion-file-copy-"));
  context = { roots: new Proxy({} as Record<ControlledRoot,string>, { get: () => directory }), simulatedState:new Map() };
  await writeFile(path.join(directory,"source.bin"), Buffer.from([0,255,1,2,3]));
});
afterEach(async () => { await rm(directory,{recursive:true,force:true}); });

describe("bounded file copy", () => {
  it("passes the real controller gate without treating copied input as self-authored", async () => {
    const graph = { version:"1" as const, goal:"Copy source.bin to copy.bin", assumptions:[], retryBudget:0,
      inputs:[{id:"request",kind:"instruction" as const,trust:"trusted_user" as const,content:"Copy source.bin to copy.bin"}],
      steps:[step()] };
    const artifacts:string[]=[];
    const blocked=await runTaskGraph(graph,{ledgerPath:path.join(directory,"blocked.jsonl"),desktopRoot:directory,
      enabledTiers:new Set(["simulation"])});
    expect(blocked.status).not.toBe("succeeded");
    const run=await runTaskGraph(graph,{ledgerPath:path.join(directory,"ledger.jsonl"),desktopRoot:directory,
      enabledTiers:new Set(["simulation","file_mutate"]),onArtifact:(value)=>artifacts.push(value)});
    expect(run.status).toBe("succeeded");
    expect(artifacts).toEqual([]);
  });
  it("preserves binary source, verifies bytes and records a copy-specific inverse", async () => {
    const result = await executeAction(definition, step(), context);
    expect(result.mode).toBe("copied");
    expect(await readFile(path.join(directory,"copy.bin"))).toEqual(await readFile(path.join(directory,"source.bin")));
    expect((await verifyAction(definition,step(),result,context)).observed).toBe(true);
    expect(result.undo?.operation).toBe("trash_copy");
    expect((await readdir(directory)).sort()).toEqual(["copy.bin","source.bin"]);
    await writeFile(path.join(directory,"copy.bin"), "changed");
    expect((await verifyAction(definition,step(),result,context)).observed).toBe(false);
  });
  it("refuses to overwrite even identical destinations", async () => {
    await writeFile(path.join(directory,"copy.bin"),"keep me");
    await expect(executeAction(definition,step(),context)).rejects.toThrow("already exists");
    expect(await readFile(path.join(directory,"copy.bin"),"utf8")).toBe("keep me");
  });
  it("never copies trees or follows source or destination-parent symlinks", async () => {
    await mkdir(path.join(directory,"folder"));
    await symlink(path.join(directory,"source.bin"),path.join(directory,"alias"));
    await symlink(path.join(directory,"folder"),path.join(directory,"linked"));
    for (const request of [step("folder"),step("alias"),step("source.bin","linked/new.bin")]) {
      await expect(executeAction(definition,request,context)).rejects.toThrow();
    }
  });
  it("rejects traversal and unsupported roots at the catalog boundary", () => {
    for (const args of [{root:"home",relativePath:"a",destinationPath:"b"},
      {root:"desktop",relativePath:"../secret",destinationPath:"b"},
      {root:"desktop",relativePath:"a",destinationPath:"../escape"}]) {
      expect(definition.validateArguments?.(args).length).toBeGreaterThan(0);
    }
  });
  it("bounds source size before allocation or destination creation", async () => {
    const file=await open(path.join(directory,"source.bin"),"w");
    await file.truncate(64*1024*1024+1); await file.close();
    await expect(executeAction(definition,step(),context)).rejects.toThrow("64 MiB");
    expect(await readdir(directory)).toEqual(["source.bin"]);
  });
  it("verification refuses source replacement after copy", async () => {
    const result=await executeAction(definition,step(),context);
    await writeFile(path.join(directory,"source.bin"),"new contents");
    const verified = await verifyAction(definition,step(),result,context);
    expect(verified.observed).toBe(false);
    expect(verified.evidence).toContain("source_matches=false");
  });
});
