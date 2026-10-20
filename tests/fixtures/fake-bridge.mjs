#!/usr/bin/env node
// A stand-in for orion-mac-bridge: one JSON request on stdin, a calendar kept in
// $FAKE_CALENDAR (a JSON array of events). Only the actions the planner uses.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.env.FAKE_CALENDAR;
const events = (() => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return []; } })();
const request = JSON.parse(readFileSync(0, "utf8").trim().split("\n")[0]);
const p = request.payload ?? {};
const save = (list) => writeFileSync(file, JSON.stringify(list, null, 2));
const reply = (result) => process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
const find = (id) => events.find((e) => e.identifier === id);

// $FAKE_DELAY_MS: every calendar write takes this long (a test kills the planner partway through a write).
if (process.env.FAKE_DELAY_MS && /^(create|delete|move)_calendar_event$/.test(request.action)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_DELAY_MS));

switch (request.action) {
  case "list_upcoming_calendar_events": reply({ events_json: JSON.stringify(events) }); break;
  case "list_deadlines": reply({ events_json: "[]" }); break;
  case "list_incomplete_reminders": {
    // $FAKE_REMINDERS: [{ identifier, title, list, due?, completed? }]; payload.list filters by list name.
    const all = (() => { try { return JSON.parse(readFileSync(process.env.FAKE_REMINDERS, "utf8")); } catch { return []; } })();
    const wanted = (p.list ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    reply({ reminders_json: JSON.stringify(all.filter((r) => !r.completed && (!wanted.length || wanted.includes(String(r.list).toLowerCase())))) });
    break;
  }
  case "create_reminder": case "update_reminder": {
    // $FAKE_REMINDERS is rewritten so a test can read what changed.
    const file = process.env.FAKE_REMINDERS;
    const all = (() => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return []; } })();
    const due = p.due_at === "" ? undefined : p.due_at;
    if (request.action === "create_reminder") {
      const identifier = `rem-${all.length}`;
      writeFileSync(file, JSON.stringify([...all, { identifier, title: p.title, list: p.list ?? "Orion", ...(due ? { due } : {}), ...(p.notes ? { notes: p.notes } : {}), ...(p.priority ? { priority: p.priority } : {}) }]));
      reply({ status: "created", identifier }); break;
    }
    if (!all.some((r) => r.identifier === p.identifier)) { process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: "no such reminder" })}\n`); break; }
    writeFileSync(file, JSON.stringify(all.map((r) => (r.identifier !== p.identifier ? r : { ...r,
      ...(p.title ? { title: p.title } : {}), ...(p.notes !== undefined ? { notes: p.notes } : {}), ...(p.priority ? { priority: p.priority } : {}),
      ...(p.due_at !== undefined ? { due } : {}) }))));
    reply({ status: "updated", identifier: p.identifier }); break;
  }
  case "complete_reminder": {
    const file = process.env.FAKE_REMINDERS;
    const all = (() => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return []; } })();
    if (!all.some((r) => r.identifier === p.identifier)) { process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: "no such reminder" })}\n`); break; }
    // payload.completed "false" reopens it (the real bridge's own switch), as the undo of "Done early" does.
    const open = p.completed === "false";
    writeFileSync(file, JSON.stringify(all.map((r) => (r.identifier === p.identifier ? { ...r, completed: !open } : r))));
    reply({ status: open ? "reopened" : "completed", identifier: p.identifier }); break;
  }
  case "create_calendar_event": {
    const identifier = `ev-${events.length}-${Math.random().toString(36).slice(2, 8)}`;
    // [orion:kind] markers: orionTags = "kind,tag,..." (what the real bridge returns for [orion:kind][tag]...), read back by live-day.
    const tags = p.orionKind ? [p.orionKind, ...String(p.orionTags ?? "").split(",").filter(Boolean)].join(",") : null;
    save([...events, { identifier, title: p.title, start: p.start, end: p.end, ...(p.calendar ? { calendar: p.calendar } : {}), ...(p.orionKind ? { orion: p.orionKind, orionTags: tags } : {}) }]);
    reply({ identifier }); break;
  }
  case "delete_calendar_event":
    // $FAKE_READONLY: titles containing it live on a read-only calendar.
    if (process.env.FAKE_READONLY && String(find(p.identifier)?.title ?? "").includes(process.env.FAKE_READONLY)) {
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: "read-only calendar: Northeastern" })}\n`); break;
    }
    if (!find(p.identifier)) { process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: "no such event" })}\n`); break; }
    save(events.filter((e) => e.identifier !== p.identifier)); reply({ deleted: true }); break;
  case "move_calendar_event":
    save(events.map((e) => (e.identifier === p.identifier ? { ...e, start: p.start, end: p.end } : e))); reply({ moved: true }); break;
  default: process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: `unsupported ${request.action}` })}\n`);
}
