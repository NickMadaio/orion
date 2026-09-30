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

switch (request.action) {
  case "list_upcoming_calendar_events": reply({ events_json: JSON.stringify(events) }); break;
  case "list_deadlines": reply({ events_json: "[]" }); break;
  case "create_calendar_event": {
    const identifier = `ev-${events.length}-${Math.random().toString(36).slice(2, 8)}`;
    save([...events, { identifier, title: p.title, start: p.start, end: p.end, ...(p.orionKind ? { orion: p.orionKind } : {}) }]);
    reply({ identifier }); break;
  }
  case "delete_calendar_event":
    if (!find(p.identifier)) { process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: "no such event" })}\n`); break; }
    save(events.filter((e) => e.identifier !== p.identifier)); reply({ deleted: true }); break;
  case "move_calendar_event":
    save(events.map((e) => (e.identifier === p.identifier ? { ...e, start: p.start, end: p.end } : e))); reply({ moved: true }); break;
  default: process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: `unsupported ${request.action}` })}\n`);
}
