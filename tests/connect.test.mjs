// Connectors ORION builds himself (2026-09-30): the limits are the point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { validateSpec, buildRequest, keepFields } from "../scripts/lib/connect/spec.mjs";

const tfl = JSON.parse(readFileSync(new URL("../scripts/connectors/tfl.json", import.meta.url)));
const canvas = JSON.parse(readFileSync(new URL("../scripts/connectors/canvas.json", import.meta.url)));
const CLI = new URL("../scripts/orion-connect", import.meta.url).pathname;

test("the built-in connectors are valid", () => {
  assert.deepEqual(validateSpec(tfl), []);
  assert.deepEqual(validateSpec(canvas), []);
});

test("unsafe specs are refused", () => {
  const base = { name: "x-api", title: "X", baseUrl: "https://api.example.com", auth: { type: "none" }, operations: { get: { description: "d", path: "/a" } } };
  assert.ok(validateSpec({ ...base, baseUrl: "http://api.example.com" }).some((i) => i.includes("https")));
  assert.ok(validateSpec({ ...base, operations: { get: { description: "d", path: "https://evil.com/a" } } }).some((i) => i.includes("path")));
  assert.ok(validateSpec({ ...base, operations: { post: { description: "d", path: "/a", method: "POST" } } }).some((i) => i.includes("only GET")));
  assert.ok(validateSpec({ ...base, operations: { get: { description: "d", path: "/a", query: { token: "abc", q: "api_key=abc123" } } } }).some((i) => i.includes("secret")));
  assert.ok(validateSpec({ ...base, auth: { type: "bearer" } }).some((i) => i.includes("keychain")));
});

test("requests fill parameters, drop missing optionals, and stay on the host", () => {
  const r = buildRequest(tfl, "journey", { from: "EC3N 1AF", to: "WC2R 2LS", time: "0845" });
  assert.equal(r.url, "https://api.tfl.gov.uk/Journey/JourneyResults/EC3N%201AF/to/WC2R%202LS?time=0845");
  assert.match(buildRequest(tfl, "journey", { from: "a" }).error, /missing: to/);
  assert.match(buildRequest(tfl, "nope").error, /no operation nope/);
  const escaping = buildRequest({ ...tfl, operations: { x: { description: "d", path: "/{{p}}" } } }, "x", { p: "@evil.com/x" });
  assert.equal(new URL(escaping.url).host, "api.tfl.gov.uk");
});

test("settings fill the host", () => {
  const r = buildRequest(canvas, "courses", {}, { domain: "northeastern.instructure.com" });
  assert.equal(r.host, "northeastern.instructure.com");
  assert.match(buildRequest(canvas, "courses", {}, {}).error, /domain/);
});

test("kept fields come back record by record", () => {
  const body = { matches: [{ id: "a", name: "Tower Hill", extra: 1 }, { id: "b", name: "Tower Gateway", extra: 2 }] };
  assert.deepEqual(keepFields(body, ["matches.id", "matches.name"]), { matches: [{ id: "a", name: "Tower Hill" }, { id: "b", name: "Tower Gateway" }] });
  assert.equal(keepFields(Array.from({ length: 20 }, (_, i) => ({ i })), ["i"], 5).length, 5);
});

test("the CLI creates, shows and refuses", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ORION_CONNECTORS_DIR: dir } });
  const spec = { name: "jokes", title: "Jokes", baseUrl: "https://official-joke-api.appspot.com", auth: { type: "none" },
    operations: { random: { description: "a random joke", path: "/random_joke", keep: ["setup", "punchline"] } } };
  assert.match(run("create", "jokes", "--json", JSON.stringify(spec)).stdout, /Created jokes/);
  assert.match(run("show", "jokes").stdout, /random\(\) — a random joke/);
  assert.match(run("create", "tfl", "--json", JSON.stringify({ ...spec, name: "tfl" })).stdout, /built in/);
  assert.match(run("create", "bad", "--json", JSON.stringify({ ...spec, name: "bad", baseUrl: "http://x.com" })).stdout, /Not created/);
  assert.match(run("set", "canvas", "token=abc").stdout, /no setting token|Secrets go in the Keychain/);
  assert.match(run("run", "canvas", "courses").stdout, /not set up yet/);
});
