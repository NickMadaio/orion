/*
 The manifest has to agree with the code.

 `openclaw.plugin.json` declares `contracts.tools`. The plugin registers tools in
 `index.ts`. Nothing checked that those two lists were the same, and they were
 not: `orion_tool_propose`, `orion_tool_list` and `orion_tool_run` were
 registered in code and missing from the manifest, so every gateway start logged

   [plugins] plugin must declare contracts.tools for: orion_tool_propose
   (also orion_tool_list, orion_tool_run, plugin=orion-control)

 31 times in one day. The existing suite did not catch it because
 "declares the controlled tool surface" reads the tools out of the CODE and
 compares them to a list in the same language — it can only ever agree with
 itself. This file reads the JSON on disk, which is the artefact the gateway
 actually loads.

 The tools were also unreachable at runtime, but that was a SECOND and separate
 defect: `tools.alsoAllow` in openclaw.json is an explicit allowlist and did not
 name them. A manifest test cannot see a user's config, so that one is verified
 against the live gateway rather than here.
*/

import { readFileSync } from "node:fs";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it } from "vitest";

import entry, { ConfigSchema } from "./index.js";

type Manifest = {
  contracts?: { tools?: string[] };
  toolMetadata?: Record<string, { optional?: boolean }>;
  configSchema?: { properties?: Record<string, unknown> };
};

const manifest = JSON.parse(
  readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
) as Manifest;

const registeredNames = (getToolPluginMetadata(entry)?.tools ?? []).map((tool) => tool.name);

describe("openclaw.plugin.json", () => {
  it("declares every tool the plugin registers", () => {
    const declared = [...(manifest.contracts?.tools ?? [])].sort();
    expect(declared).toEqual([...registeredNames].sort());
  });

  it("declares no tool the plugin does not register", () => {
    // The other direction matters too: a stale name here promises the gateway
    // a tool that will never appear.
    for (const name of manifest.contracts?.tools ?? []) {
      expect(registeredNames, `manifest declares unknown tool ${name}`).toContain(name);
    }
  });

  it("carries toolMetadata for each declared tool", () => {
    for (const name of manifest.contracts?.tools ?? []) {
      expect(manifest.toolMetadata?.[name], `no toolMetadata for ${name}`).toBeDefined();
      expect(manifest.toolMetadata?.[name]?.optional, `${name} should be optional`).toBe(true);
    }
  });

  it("names the three workshop tools specifically", () => {
    // Spelled out because these are the ones that were missing, and a generic
    // set comparison would go quiet again if both sides lost them together.
    expect(manifest.contracts?.tools).toEqual(
      expect.arrayContaining(["orion_tool_propose", "orion_tool_list", "orion_tool_run"]),
    );
  });

  it("declares the config keys the workshop tools depend on", () => {
    // `workshopPath` is set in Nick's live config and was accepted by the code
    // but undeclared here.
    expect(manifest.configSchema?.properties?.workshopPath).toBeDefined();
  });

  it("keeps the manifest config schema exactly aligned with the runtime schema", () => {
    expect(Object.keys(manifest.configSchema?.properties ?? {}).sort()).toEqual(
      Object.keys(ConfigSchema.properties).sort(),
    );
  });
});
