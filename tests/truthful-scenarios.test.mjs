import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkCatalog, MINIMUMS } from "../scripts/lib/eval/scenario-check.mjs";

const catalog = JSON.parse(readFileSync(new URL("../scripts/eval/scenarios-2026-09-30.json", import.meta.url), "utf8"));
const ok = (id, area = "todo", extra = {}) => ({ id, area, say: "add x", expect: { kind: "action" }, undo: null, risky: false, ...extra });

test("the catalog is valid", () => {
  const r = checkCatalog(catalog);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test("every validator error fires", () => {
  const errs = checkCatalog([
    ok("a"), ok("a"), ok("b", "todo", { say: "" }), ok("c", "todo", { expect: { kind: "maybe" } }),
    ok("d", "messaging", { risky: true }), ok("e", "todo", { after: "zzz" }), ok("f", "todo", { expect: { kind: "action", tools: { mustDance: [] } } }),
  ]).errors;
  for (const prefix of ["duplicate id a", "b: missing say", "c: bad kind", "d: risky must expect question or refusal",
    "e: after points to unknown zzz", "f: unknown tools key mustDance", "area schedule has 0 (min 20)", "total 7 (min 150)"]) {
    assert.ok(errs.some((e) => e.startsWith(prefix)), `${prefix}\n${errs.join("\n")}`);
  }
});

test("ids are unique and areas meet minimums", () => {
  assert.equal(new Set(catalog.map((s) => s.id)).size, catalog.length);
  const { counts } = checkCatalog(catalog);
  for (const [area, min] of Object.entries(MINIMUMS)) assert.ok(counts[area] >= min, `${area} ${counts[area]}`);
  assert.ok(catalog.filter((s) => s.risky).every((s) => ["question", "refusal"].includes(s.expect.kind)));
});
