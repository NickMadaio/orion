// One fixture of mixed to-dos, the same order through every surface's data path (wave 19).
// Swift twins: MobileCore TodoOrderingTests / TodoOrderSurfaces and the Mac's TodoOrderSurfacesTests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { orderTodos, priorityLevel } from "../scripts/lib/life/todo-order.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/todo-order.json"), "utf8"));
const now = new Date(fixture.now);
const shuffled = [...fixture.todos].reverse();

test("helper: the fixture comes out in the shared order, from any starting order", () => {
  const rows = (list) => list.map((t) => ({ id: t.id, title: t.id, priority: t.word, due: t.due, done: t.done }));
  assert.deepEqual(orderTodos(rows(shuffled), now).map((t) => t.id), fixture.expected);
  assert.deepEqual(orderTodos(rows(fixture.todos), now).map((t) => t.id), fixture.expected);
});

test("helper: every spelling of priority lands in the same band and a missing one is last", () => {
  for (const high of ["high", "High", "!!!", "p1", 1, 2, 4]) assert.equal(priorityLevel(high), 3, String(high));
  for (const med of ["medium", "!!", "p2", 5]) assert.equal(priorityLevel(med), 2, String(med));
  for (const low of ["low", "!", "p3", 6, 9]) assert.equal(priorityLevel(low), 1, String(low));
  for (const none of [undefined, null, "", 0, "banana"]) assert.equal(priorityLevel(none), 0, String(none));
});

test("helper: manual order breaks a tie between equal priority and due, before title", () => {
  const list = [{ title: "a", priority: "high", notes: "Order: 2" }, { title: "b", priority: "high", notes: "Order: 1" }, { title: "c", priority: "high" }];
  assert.deepEqual(orderTodos(list, now).map((t) => t.title), ["b", "a", "c"]);
});

test("helper: a date-only due is due at the end of its day, so today's is not overdue yet", () => {
  const today = new Date(2026, 10, 4, 0, 0, 0).toISOString();
  assert.equal(orderTodos([{ title: "x", due: today, priority: "none" }, { title: "y", due: new Date(2026, 10, 3, 0, 0, 0).toISOString(), priority: "low" }],
    new Date(2026, 10, 4, 10)).map((t) => t.title)[0], "y");
});

// The bridge stub hands the fixture back in a scrambled order, in the shape Bridge.swift sends.
const STUB = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8").trim().split("\\n")[0]);
const items = JSON.parse(readFileSync(process.env.STUB_TODOS, "utf8"));
process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { reminders_json: JSON.stringify(items) } }) + "\\n");
`;

function run(t, script, ...args) {
  const dir = mkdtempSync(join(tmpdir(), "orion-todo-order-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "bridge.mjs"), STUB, { mode: 0o755 });
  const items = shuffled.map((r) => ({ title: r.id, identifier: r.id, list: "Orion", ...(r.due ? { due: r.due } : {}), ...(r.word ? { priority: r.word } : {}) }))
    .filter((r) => !fixture.todos.find((x) => x.id === r.title).done);
  writeFileSync(join(dir, "todos.json"), JSON.stringify(items));
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], { encoding: "utf8",
    env: { ...process.env, HOME: dir, ORION_BRIDGE_BIN: join(dir, "bridge.mjs"), STUB_TODOS: join(dir, "todos.json"), ORION_RESCHEDULE_NOW: fixture.now, ORION_NOW: fixture.now } });
  return `${r.stdout}${r.stderr}`;
}
const open = fixture.expected.filter((id) => id !== "done-high");
const titlesIn = (out) => [...out.matchAll(/^\s*(?:- )?(\S+)/gm)].map((m) => m[1]).filter((id) => open.includes(id));

test("chat: orion-tasks list prints his to-dos in the shared order", (t) => {
  assert.deepEqual(titlesIn(run(t, "orion-tasks", "list")), open);
});

test("chat: orion-agenda tasks prints his to-dos in the shared order", (t) => {
  assert.deepEqual(titlesIn(run(t, "orion-agenda", "tasks")), open);
});
