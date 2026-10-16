#!/usr/bin/env node
// A stand-in for the ORION app's session socket: answers every request with the JSON in
// $FAKE_SESSION_REPLY (re-read per request, so a test can end the "session" by rewriting it).
// usage: node fake-session-server.mjs <socket-path>   (prints "ready" when listening)
import { createServer } from "node:net";
import { readFileSync, rmSync } from "node:fs";
const path = process.argv[2];
rmSync(path, { force: true });
createServer((c) => {
  c.on("data", () => {
    let reply = { status: "none" };
    try { reply = JSON.parse(readFileSync(process.env.FAKE_SESSION_REPLY, "utf8")); } catch {}
    c.end(`${JSON.stringify(reply)}\n`);
  });
}).listen(path, () => console.log("ready"));
