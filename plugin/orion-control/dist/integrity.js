/*
 The installed plugin checks itself before it acts (Phase 48: "prevents
 unauthorized replacement or tampering").

 orion-deploy and orion-repair -- the two sanctioned writers of the installed
 copy -- record a SHA-256 manifest of the whole extension (dist, package.json,
 the manifest, node_modules) in ~/.openclaw/orion-gate/integrity,
 a directory no action in this plugin can write. At first use the plugin hashes
 its own directory and compares. If anything changed, the tools that ACT refuse,
 naming the file; the ones that only report keep working, so ORION can still
 say what is wrong. Mirrors scripts/lib/orion-integrity.mjs, which the installers
 use; the shape of the manifest is the contract between them.

 Applies only when the manifest names THIS directory, so the repo's own dist
 and test runs are not the installed copy and are never judged as one. The
 installed copy with no manifest at all fails closed.

 Honest limit: a check inside the code it checks cannot catch a replacement of
 itself. The launchd verifier does that for the bridge; for the plugin it needs
 the gateway to verify before loading, or code signing (both open, Phase 48).
*/
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// node_modules IS hashed: package.json and its dependencies decide what the
// gateway loads, so leaving them out left a way round the whole check
// (review, 2026-09-26, H5).
const SKIP = new Set(["__pycache__", ".DS_Store"]);
const INSTALLED_ROOT = path.join(os.homedir(), ".openclaw", "extensions", "orion-control");
export function hashTree(root) {
    const files = {};
    const walk = (dir) => {
        for (const entry of readdirSync(dir).sort()) {
            if (SKIP.has(entry))
                continue;
            const full = path.join(dir, entry);
            const stat = lstatSync(full);
            if (stat.isSymbolicLink())
                files[path.relative(root, full)] = "symlink";
            else if (stat.isDirectory())
                walk(full);
            else
                files[path.relative(root, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
        }
    };
    walk(root);
    return files;
}
/** A sentence naming what changed, or null when the copy is as installed (or unjudged). */
export function integrityProblem(directory = path.dirname(path.dirname(fileURLToPath(import.meta.url))), gate = path.join(os.homedir(), ".openclaw", "orion-gate", "integrity", "orion-control.json"), installedRoot = INSTALLED_ROOT) {
    if (!existsSync(gate)) {
        return path.resolve(directory) === path.resolve(installedRoot)
            ? "no integrity manifest has been recorded for the installed copy"
            : null;
    }
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(gate, "utf8"));
    }
    catch {
        return "its integrity manifest is unreadable";
    }
    if (path.resolve(manifest.root ?? "") !== path.resolve(directory))
        return null;
    const expected = manifest.files ?? {};
    const actual = hashTree(directory);
    const changed = Object.keys(expected).filter((file) => file in actual && actual[file] !== expected[file]);
    const missing = Object.keys(expected).filter((file) => !(file in actual));
    const added = Object.keys(actual).filter((file) => !(file in expected));
    if (!changed.length && !missing.length && !added.length)
        return null;
    return [changed.length ? `changed: ${changed.slice(0, 3).join(", ")}` : "",
        missing.length ? `missing: ${missing.slice(0, 3).join(", ")}` : "",
        added.length ? `added: ${added.slice(0, 3).join(", ")}` : ""].filter(Boolean).join("; ");
}
let cached;
/** Checked once per process: the gateway reloads the plugin after every deploy. */
export function installedIntegrityProblem() {
    if (cached === undefined)
        cached = integrityProblem();
    return cached;
}
