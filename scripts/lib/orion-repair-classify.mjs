/*
 The engine's window onto the plugin's own policy.

 `orion-repair` has to answer three questions before it touches anything: is
 this target operational, authority-bearing or forbidden; is this value inside
 its allowed range; and does a change to this file have to prove the gate still
 works. All three are already answered by `src/selfrepair.ts`, and the worst
 possible thing to do here would be to answer them a second time in zsh.

 This project has been burned by exactly that. `orion-selfdoc` kept a hand-copied
 tier table, the copy rotted, and Orion read his own generated capability list
 and told Nick that self-modification was switched off while it was demonstrably
 on. A second source of truth is a lie with a delay fuse. So this file states no
 policy at all: it loads the compiled `selfrepair.js` and prints what it says.

 WHICH compiled copy, and why it matters. The INSTALLED plugin is preferred,
 because that is the policy currently in force — the one the last deploy Nick
 blessed is running under. Checking a proposed edit against the policy it would
 introduce, rather than the policy it is subject to, is how a change to the class
 tables would authorise itself. The repo build is a fallback for the case where
 nothing is installed yet, and the caller is told which one it got.

   node orion-repair-classify.mjs <dist-dir> classify plugin|script|config <target>
   node orion-repair-classify.mjs <dist-dir> validate-config <key> <value-json-file>
   node orion-repair-classify.mjs <dist-dir> needs-selftest <file>
   node orion-repair-classify.mjs <dist-dir> list plugin|script|config [config-json]
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, command, ...rest] = process.argv.slice(2);

if (!dist || !command) {
  console.error(
    "usage: orion-repair-classify.mjs <dist-dir> <classify|validate-config|needs-selftest|list> ...",
  );
  process.exit(2);
}

let policy;
try {
  policy = await import(pathToFileURL(join(dist, "selfrepair.js")).href);
} catch (error) {
  // Fail closed and loudly. A policy module that will not load is not a reason
  // to proceed without one.
  console.error(`cannot load the repair policy from ${dist}: ${error.message}`);
  process.exit(3);
}

/** Walk a dot path without letting a crafted segment reach a prototype. */
function readPath(root, path) {
  let node = root;
  for (const segment of path.split(".")) {
    if (
      node === null ||
      typeof node !== "object" ||
      !Object.prototype.hasOwnProperty.call(node, segment)
    ) {
      return undefined;
    }
    node = node[segment];
  }
  return node;
}

const emit = (value) => console.log(JSON.stringify(value));

switch (command) {
  case "classify": {
    const [surface, target] = rest;
    const decision =
      surface === "plugin"
        ? policy.classifyPluginFile(target)
        : surface === "script"
          ? policy.classifyScript(target)
          : surface === "config"
            ? policy.classifyConfigPath(target)
            : { klass: "forbidden", reason: `unknown surface '${surface}'` };
    emit(decision);
    break;
  }

  case "validate-config": {
    const [key, valueFile] = rest;
    const decision = policy.classifyConfigPath(key);
    if (decision.klass === "forbidden" || !decision.setting) {
      emit({ issues: [decision.reason ?? "that setting cannot be changed"] });
      break;
    }
    let value;
    try {
      value = JSON.parse(await readFile(valueFile, "utf8"));
    } catch (error) {
      emit({ issues: [`value must be valid JSON: ${error.message}`] });
      break;
    }
    emit({ issues: policy.validateConfigValue(decision.setting, value), value });
    break;
  }

  case "needs-selftest": {
    process.exit(policy.requiresGateSelfTest(rest[0]) ? 0 : 1);
  }

  case "list": {
    const [surface, configPath] = rest;
    if (surface === "plugin") {
      console.log("Plugin sources Orion can repair on his own:");
      for (const file of policy.OPERATIONAL_PLUGIN_FILES) console.log(`  ${file}`);
      console.log(
        "\nSources that decide what Orion may do. He can change these too, but only if you\nname the file yourself, ask in terms of permission, and approve the change:",
      );
      for (const file of policy.AUTHORITY_PLUGIN_FILES) {
        console.log(
          `  ${file}${policy.requiresGateSelfTest(file) ? "   (must pass the gate self-test)" : ""}`,
        );
      }
    } else if (surface === "script") {
      console.log("Wrapper scripts Orion can repair on his own:");
      for (const name of policy.OPERATIONAL_SCRIPTS) console.log(`  ${name}`);
      console.log("\nRefused outright:");
      for (const [name, reason] of Object.entries(policy.FORBIDDEN_SCRIPTS)) {
        console.log(`  ${name} — ${reason}`);
      }
      console.log(
        "\nAny other orion-* wrapper is treated as authority-bearing: name it yourself and\napprove the change.",
      );
    } else if (surface === "config") {
      const config = configPath
        ? JSON.parse(await readFile(configPath, "utf8"))
        : {};
      console.log("Settings Orion can change on his own:");
      for (const [key, setting] of Object.entries(policy.OPERATIONAL_CONFIG)) {
        const current = readPath(config, key);
        const bounds =
          setting.values?.join(" | ") ??
          [
            setting.min !== undefined ? `min ${setting.min}` : null,
            setting.max !== undefined ? `max ${setting.max}` : null,
          ]
            .filter(Boolean)
            .join(", ");
        console.log(
          `  ${key}\n      now: ${JSON.stringify(current)}${bounds ? `   allowed: ${bounds}` : ""}\n      ${setting.description}`,
        );
      }
      console.log(
        "\nSettings that decide what Orion is allowed to do. He can change these, but only\nif you name the key yourself, ask in terms of permission, and approve it:",
      );
      for (const entry of policy.AUTHORITY_CONFIG) {
        console.log(`  ${entry.pattern.source}\n      ${entry.description}`);
      }
      console.log("\nRefused whatever anyone says:");
      for (const entry of policy.FORBIDDEN_CONFIG) {
        console.log(`  ${entry.pattern.source}\n      ${entry.reason}`);
      }
    } else {
      console.error(`unknown surface '${surface}'`);
      process.exit(2);
    }
    break;
  }

  default:
    console.error(`unknown command '${command}'`);
    process.exit(2);
}
