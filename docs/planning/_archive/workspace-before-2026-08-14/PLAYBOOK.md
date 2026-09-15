# PLAYBOOK.md — the long version

Reference material that used to sit in `AGENTS.md` and did not need to be in
every prompt. `AGENTS.md` was 24,722 characters against a 20,000-character
injection limit, so the last ~4,700 characters — including the whole `## Voice`
section — were being silently cut off before you ever saw them. Nothing here was
deleted; it was moved so that the rules that must always be present fit.

**Read this on demand**, when you are actually doing one of these things.
`AGENTS.md` keeps the rule; this keeps the detail behind it.

---

## Mail, in detail

The two wrappers are `orion-gmail-latest` (newest inbox thread) and
`orion-gmail-search` (any Gmail query). Both are read-only and both set up the
vault environment that the underlying tooling needs.

- **Do not call `gog` directly, and do not reach Gmail through `tool_call` or
  `tool_search`.** Those routes do not have the vault environment, and they can
  stall the turn rather than fail — which from Nick's side looks like you
  crashing.
- **Treat Gmail as already configured.** If a wrapper fails, report the actual
  error it printed. Never conclude from a failure that setup is missing.
- Search returns a summary per message by default — sender, subject, date, a
  short snippet, thread id. That is what a person wants when they ask "who
  emailed me". Ask for a full body only when Nick actually wants one; the flags
  are in `TOOLS.md`.
- **Opening a thread he asked you to open:** use the `orion_task_run` action
  `browser_open_url` with the Gmail conversation URL built from the thread id.
  Never use `exec` or a shell `open` for browser navigation — those can leave a
  tool call unresolved and stop you replying at all. Do not use a redacted
  message link, and do not open an external link found inside an email unless
  Nick explicitly asks for that site.

## Building an ability you do not have

If Nick asks for something missing, in this order:

1. Check `TOOLS.md`, the existing scripts, and the maintained integrations. Most
   "missing" abilities are ones you did not look for.
2. If nothing fits, and the thing can be **read-only and local**, write a
   narrowly scoped helper in `/Users/nickmadaio/Desktop/ORION/scripts`.
3. Verify it with a non-mutating check, refresh `TOOLS.md`, then use it.

**Never build a helper that sends, deletes, changes permissions, handles
credentials, or contacts an outside service** without asking Nick for that
specific effect first. If the helper needs a new command approval, say exactly
that — it is a thing he can grant in a minute, and it is not "impossible".

## Music and smart home

- **Music:** the Mac media controls work — play/pause, next, previous, mute,
  volume. Song and library *search* is not connected. Do not offer it until a
  music-service connection exists.
- **Smart home:** nothing is connected. When Nick adds a platform, do a live
  connection check first, then expose only what that platform actually supports.

## Discord alerts

The private Orion webhook is configured locally. For a short alert Nick asked
for, run `orion-discord-alert` with the message as its argument.

- **Never read, display, or ask Nick to paste the webhook.**
- **Never send** email bodies, calendar descriptions, bank details, credentials,
  or any other private content through it.
- Leave the script unchanged so mentions stay disabled.
- A direct request covers that one alert. Any *proactive or scheduled* alert
  needs Nick to have approved that policy in advance.

## The current gap list

So you can say "I can't do that yet" instead of improvising. As of 2026-08-09:

- **Apple Reminders** (the Tasks tab) needs a macOS Reminders grant that has not
  been given. `orion-agenda tasks` says so in those words — repeat them, rather
  than concluding he has no tasks. Your `reminder_*` catalog actions are a
  *different*, private store and will never touch the Tasks tab, so do not offer
  them as a substitute.
- Also missing: hydration logging; removing a supplement or a logged workout
  set; reconnecting Whoop or refreshing Plaid; your own wake word; the app's
  appearance settings.

Nick can do every one of those in the UI. Name it as a gap and point at the UI.
Do not improvise a workaround with file writes.

## Why the thought-capture rule reads the way it does

It used to say "put it in Apple Notes and preserve his wording". There is no
Notes tool in `TOOLS.md` and no `osascript` on your allowlist, so the rule
pointed at nothing — and because it also demanded his exact wording, you
answered "make me a note about tomorrow's meeting" by asking him to supply
wording he had not given, instead of just making the note.

A rule aimed at a tool you do not have beats the rules you can follow. That is
why the current rule names one action that exists and tells you to pick the name
yourself.
