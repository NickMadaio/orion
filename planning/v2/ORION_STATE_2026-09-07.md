# What Orion can actually do — 2026-09-07

Written after Nick said *"orion is having a lot of capability issues, permission
issues. etc. fix them"* and *"is the mobile app completly done? is orion for
desktop fixed? the answer is no."* He was right on both counts. This is the
measured state, not the intended one.

## Fixed tonight

**Web search was dead and nobody had noticed.** Asked to search, Orion answered
`web_search is disabled or no provider is available.` It was in his tool profile
all along; the failure was three layers down — the free DuckDuckGo provider was
one of 61 disabled plugins, and `plugins.allow` blocked enabling it. Enabled the
plugin, allowlisted it, selected it as `tools.web.search.provider`, restarted.
Verified with a live query returning yesterday's F1 result and a real source URL.
`web-readability` is on too, so a fetched page comes back as an article.

**He did not know he had it.** The capability existed and his operating rules
never mentioned it, so he would have kept saying he could not look things up.
Added, and synced live — see below for why that last word matters.

**Computer use exists now**, in the order Phases 53–55 specify: observation
first, then the untrusted envelope, then gated control. `screen_observe` walks
the focused window's accessibility tree; `screen_capture` is the pixel fallback,
because AX metadata is text — cheap, redactable, and it does not carry pixels of
a bank balance. `screen_click`/`screen_type`/`screen_key` are floored at APPROVAL
in every strictness mode including `sovereign`, and that floor is earned by
`reversible: false` + `risk: critical` rather than by `approvalRequired` alone —
flipping `reversible` makes `screen_click` run unasked and three named tests say
so.

**The 11.8M-token loop.** `orion-learn` counted 26 retry loops across 10 sessions
consuming 11,826,304 tokens, and every transcript has one shape: a correct
refusal that teaches nothing, answered by guessing a different command.

```
grep -r codename ~/.openclaw/workspace/memory/ | head -20  → exec denied: allowlist miss
"grep isn't allowlisted, I'll use file tools"  → find ...   → exec denied: allowlist miss
ls ~/.openclaw/workspace/memory/                            → hung, 3m21s, session error
```

`grep` IS allowlisted. The **pipe** was refused. So the second guess reasoned
from a false premise the error itself supplied. That message comes from the
vendored openclaw package and cannot be patched here — but `before_tool_call`
fires first, and now names the route before the unhelpful refusal happens.
Proven live: asked to run the bare `orion-authority explain`, he was told the
absolute path and recovered in one step instead of looping.

**Seven live skills existed in no repo.** `~/.openclaw/workspace/skills/` holds
instructions Orion FOLLOWS. One — an `accli` calendar skill — was telling him to
`npm install` and shell out to a binary that is not allowlisted, competing with
the repo's own calendar skill. All seven are tracked now, the bad one is parked
under `.disabled`, and the drift check reports skills in both directions.

## Broken, and only Nick can fix them

**Gmail is dead.** `oauth2: "invalid_grant" "Bad Request"` — the stored refresh
token, dated 2026-08-14, is expired or revoked. This is why mail does not work.

```
gog auth manage
```

**Computer use needs two macOS grants.** Observation is switched on and returns
an honest refusal today:

> `orion-computer: Accessibility is not granted. System Settings > Privacy &
> Security > Accessibility, enable the app that runs OpenClaw…`

The gateway runs as
`/Users/nickmadaio/.openclaw/tools/node-v24.15.0/bin/node`. That binary needs
**Accessibility**, and `screen_capture` additionally needs **Screen Recording**,
which only takes effect after the gateway is relaunched. Worth saying plainly:
granting Accessibility to a bare `node` binary is a broad grant — it covers any
node process launched that way, not just Orion.

**Control is built and switched OFF.** After the grants land and observation is
seen working:

```
openclaw config set plugins.entries.orion-control.config.enableComputerControlActions true --strict-json
openclaw gateway restart
```

Every click and keystroke still requires his approval; no strictness mode waives it.

**The Discord leak fix is still not installed** — `scripts/orion-remote-install`.

## Not done, stated plainly

**There is no iPhone app.** `native/OrionMobile` contains a `MobileCore` library
and a check executable. There is no app target and no `.xcodeproj`. Nothing is
installable on a phone. Every mobile-facing phase — 49, 56, 65, 66, 84 — is
written against an app that does not exist yet.

Also absent: bounded automation sessions (Phase 53's session half), click-by-
element (only x/y coordinates today), scroll and drag, and a clipboard
capability — `pbpaste` is refused and now says so instead of inviting a retry.
