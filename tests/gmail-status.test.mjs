import test from "node:test";
import assert from "node:assert/strict";
import { gmailStatus, classifyGmailError, GMAIL_EXPIRED } from "../scripts/lib/gmail-status.mjs";

const GRANT = `Get "https://gmail.googleapis.com/gmail/v1/users/me/threads": oauth2: "invalid_grant" "Token has been expired or revoked."`;
const OFFLINE = `oauth2: cannot fetch token: Post "https://oauth2.googleapis.com/token": dial tcp: lookup oauth2.googleapis.com: no such host`;

test("the plain sign-in message names the account and the command", () => {
  assert.equal(GMAIL_EXPIRED, "Gmail's sign-in expired — run `gog auth add nmadaio08@gmail.com` to reconnect.");
});

test("a real call that works is connected", async () => {
  let asked;
  const r = await gmailStatus("/root", { search: async (root, q, n) => { asked = [q, n]; return []; } });
  assert.equal(r.state, "connected"); assert.deepEqual(asked, ["in:inbox", 1]);
});

test("invalid_grant is expired, with the reconnect instruction -- even though a token 'exists'", async () => {
  const r = await gmailStatus("/root", { search: async () => { throw new Error(GRANT); } });
  assert.equal(r.state, "expired"); assert.equal(r.say, GMAIL_EXPIRED);
});

test("offline is unreachable, never an expired sign-in", async () => {
  const r = await gmailStatus("/root", { search: async () => { throw new Error(OFFLINE); } });
  assert.equal(r.state, "unreachable"); assert.doesNotMatch(r.say, /gog auth add/);
});

test("other failures are reported as not working, with the real error", async () => {
  const r = await gmailStatus("/root", { search: async () => { throw new Error("gog exited 2"); } });
  assert.equal(r.state, "error"); assert.match(r.say, /NOT working: gog exited 2/);
  assert.equal(classifyGmailError("Token has been expired or revoked"), "expired");
});
