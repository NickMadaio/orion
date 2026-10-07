#!/usr/bin/env node
// The calendar ORION uses during a schedule evaluation (2026-10-01): one JSON
// request on stdin, the day kept in $ORION_SANDBOX_CALENDAR as
// { now, events: [...] }. Only the actions the planner uses. Real calendar
// writes during an evaluation would rearrange Nick's actual day.
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const file = process.env.ORION_SANDBOX_CALENDAR;
const state = (() => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return { events: [] }; } })();
const events = state.events ?? [];
const request = JSON.parse(readFileSync(0, "utf8").trim().split("\n")[0]);
const p = request.payload ?? {};
const save = (list, reminders = state.reminders ?? []) => { writeFileSync(`${file}.tmp`, JSON.stringify({ ...state, events: list, reminders }, null, 2)); renameSync(`${file}.tmp`, file); };
const reminders = state.reminders ?? [];
const reply = (result) => process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
const refuse = (error) => process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error })}\n`);
const find = (id) => events.find((e) => e.identifier === id);

switch (request.action) {
  case "list_upcoming_calendar_events": reply({ events_json: JSON.stringify(events) }); break;
  case "list_deadlines": reply({ events_json: "[]" }); break;
  case "list_incomplete_reminders": reply({ reminders_json: JSON.stringify(state.reminders ?? []) }); break;
  case "create_calendar_event": {
    const identifier = `sb-${events.length}-${Math.random().toString(36).slice(2, 8)}`;
    save([...events, { identifier, title: p.title, start: p.start, end: p.end, ...(p.orionKind ? { orion: p.orionKind } : {}) }]);
    reply({ identifier }); break;
  }
  case "delete_calendar_event":
    if (!find(p.identifier)) { refuse("no such event"); break; }
    save(events.filter((e) => e.identifier !== p.identifier)); reply({ deleted: true }); break;
  case "move_calendar_event":
    if (!find(p.identifier)) { refuse("no such event"); break; }
    save(events.map((e) => (e.identifier === p.identifier ? { ...e, start: p.start, end: p.end } : e))); reply({ moved: true }); break;
  case "create_reminder": {
    const identifier = `rem-${reminders.length}-${Math.random().toString(36).slice(2, 8)}`;
    save(events, [...reminders, { identifier, title: p.title, list: p.list, ...(p.due_at ? { due: p.due_at } : {}), ...(p.notes ? { notes: p.notes } : {}), ...(p.priority ? { priority: p.priority } : {}) }]);
    reply({ identifier }); break;
  }
  case "update_reminder":
    if (!reminders.some((r) => r.identifier === p.identifier)) { refuse("no such reminder"); break; }
    save(events, reminders.map((r) => (r.identifier === p.identifier ? { ...r, ...p } : r))); reply({ updated: true }); break;
  default: refuse(`unsupported in the evaluation sandbox: ${request.action}`);
}
