# What else Orion could connect to

A brainstorm, not a plan. Sorted so the arguing happens before the building.

---

## First, the thing that is not a connection

Watch what Jarvis actually does in the films. Most of his best moments are not
tool calls:

> "Sir, the Mark VII is not ready for deployment."
> "I've taken the liberty of running a diagnostic while you slept."
> "You have a 7:30 with Ms. Potts. You have missed it."

**He speaks first.** Orion only ever answers. Every integration below is
incremental; being able to interrupt is categorical — it is the difference
between a very good command line and something that feels like a person in the
room. And it needs no new API at all: a trigger engine, a rule store, and the
judgement to stay quiet most of the time.

Rough shape: conditions Orion evaluates on a schedule (calendar in 10 minutes,
battery under 15% and unplugged, a file changed in a watched folder, a build
finished, nothing eaten since morning), each with a cooldown and a "not while
he's on a call" gate. The hard part is not the plumbing, it is taste — an
assistant that speaks too often gets muted, and a muted assistant is worth
nothing.

I would build this before any five things on the list below.

---

## Tier 1 — cheap, local, obviously useful

| Connection | Route | Notes |
|---|---|---|
| **Calendar + Reminders** | EventKit | One prompt each. Unlocks most proactive triggers |
| **Apple Music / Spotify** | AppleScript / Web API | Extends media control you already have |
| **Notes / Obsidian** | Files | Obsidian is just markdown on disk — he already has file tools |
| **Clipboard** | AppKit | "What did I just copy" · gate it, clipboards hold passwords |
| **Screenshot + screen read** | ScreenCaptureKit | "What does this error say" without retyping it |
| **Focus / Do Not Disturb (read)** | AppKit | Read-only: know when *not* to speak. Setting it is a system setting |
| **Bluetooth / audio route** | CoreAudio | Are headphones in? Decides speak-aloud vs. show-quietly |

## What connecting Google actually involves

Checked rather than assumed, because "connect Gmail" sounds like one click:

- **OpenClaw ships no Gmail or Calendar tool.** Its only Gmail feature is an
  inbound webhook — new mail *wakes* Orion with a subject and snippet. That is
  not "read my mail", and it needs an external `gog` CLI plus a Google Cloud
  Pub/Sub topic to work at all.
- **It does support MCP servers** (`mcp.servers` in `openclaw.json`, with
  `command`/`args`/`env` or a `url`). So a Gmail or Calendar MCP is the real
  route.
- **Which means OAuth.** A Google Cloud project, a client ID and secret, and a
  consent flow. Those are credentials, and Nick does that part — not me, and
  not a script. What I can do is the config once the credentials exist.
- **And a third-party server.** Neither Google nor Anthropic publishes an
  official Gmail MCP; the options are community-maintained. Something with
  full mailbox access, running locally, is worth choosing deliberately rather
  than taking the first search result.

**Calendar has a much better answer: EventKit.** Native macOS, one permission
prompt, no OAuth, no third party, no credentials, and it covers the calendar
Nick actually looks at — including any Google account already added to macOS
Calendar. Strictly better than an OAuth integration for the same result.

So the honest recommendation: **EventKit for calendar, and treat Gmail as a
separate decision** about whether an assistant that browses the web should also
hold a key to the mailbox.

## Tier 2 — real value, real setup

| Connection | Route | Notes |
|---|---|---|
| **Mail** | MCP connector or IMAP | Reading is fine. Sending confirms, every time |
| **Messages** | SQLite db is readable locally | Reading his own messages is legal and easy; replying is the risky half |
| **Home Assistant / HomeKit** | HA has a good REST API | The most Jarvis-shaped thing on the list. Lights, locks, doors, sensors |
| **Health** | HealthKit | Sleep and activity are the two that change what a good assistant says |
| **Phone handoff** | Pushover / ntfy / Telegram bot | Orion on the Mac is half an assistant. The other half follows you outdoors |
| **Sub-agents** | OpenClaw already has them | Jarvis delegates and reports back. "Research this while I work" |

## Tier 3 — powerful, and worth arguing about

| Connection | Why it is good | Why it is not free |
|---|---|---|
| **Banking / spend** | "You've spent £400 on food this month" is genuinely useful | Read-only aggregator at best. Never credentials, never transactions |
| **Camera / doorbell** | Presence, "who is at the door" | A camera an assistant can see is a camera something else might |
| **Location** | Home/away is a great trigger | A log of where you are is the single most sensitive file on the machine |
| **Password manager** | Would make browsing genuinely autonomous | I would not. The blast radius is every account you own |

---

## Ideas that are not on anyone else's list

**The move.** You are in London in under a month. That is not a chat topic, it
is a project: visa dates, flights, what ships vs. what is bought there, address
changes across a dozen accounts, a timezone that invalidates every reminder you
own, and a currency switch. An assistant that holds a live checklist and nags
appropriately would earn its keep in three weeks and then never again — which
is fine, because the machinery is a general project-tracker.

**University mode.** Lecture timetable, reading lists, deadlines that ladder
backwards ("this is due in 3 weeks, that means a draft by Tuesday"), and
recording lectures and summarising them. Students are the ideal user for this
and almost no one builds for them.

**Context awareness before speech.** Screen locked, camera in use, headphones
out, Focus on, music playing, mic already busy — Orion should know all of it and
choose between speaking aloud, showing quietly in the hologram, or waiting.
Cheap to build, and it is what separates "assistant" from "app that talks".

**A briefing that is actually about today.** You have the daily log now. The
inverse — a morning brief drawn from calendar, weather, unread mail, what you
were working on yesterday, what you said you would do — is a small build on
things you mostly already have.

**Watch the dev loop.** He builds things. Notice when a build fails, when tests
go red, when a long job finishes. "Your build finished, three tests failed" is
Jarvis-in-the-workshop and it is all local.

**Let him talk to Orion from his phone.** A Telegram or ntfy bridge is an
afternoon's work and turns a desk assistant into one that exists when he is out.

---

## If I had to pick five

1. **Proactive triggers** — the categorical change, no new API needed
2. **Calendar + Reminders** — feeds everything above
3. **Context awareness** — knowing when *not* to speak
4. **Phone bridge** — Orion existing away from the desk
5. **Home Assistant** — if you have any smart devices, this is the Jarvis one

## What I would keep saying no to

Credentials, password managers, anything that moves money, and sending messages
as you without confirmation. Not because the code is hard — because "Orion sent
that" and "Orion was talked into sending that" look identical afterwards, and
the web browsing you just switched on is exactly the channel that would do the
talking.
