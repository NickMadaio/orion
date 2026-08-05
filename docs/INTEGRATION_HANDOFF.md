# Orion integrations — next handoff

This is a deliberately small staging plan. It lets Orion gain value without
silently acquiring broad account access.

## Ready now

- Apple Notes is Orion's default destination for a captured thought.
- macOS notifications, reminders, Apple Calendar, media controls, weather, and
  Google Workspace authorization are already available locally.

## Discord notifications

Use one private channel as Orion's one-way notification inbox. Start with only:

- morning briefing;
- due reminders;
- a short alert when a user-requested task finishes.

Do not send email contents, calendar descriptions, bank data, or secrets to
Discord by default. Treat the webhook URL as a secret. The required placeholder
is `ORION_DISCORD_WEBHOOK_URL`; remote notifications remain off until the user
sets `ORION_DISCORD_NOTIFICATIONS=true`.

## Finance dashboard

Begin in Plaid Sandbox with fictional data. The first production scope should
be read-only and limited to:

- account names and masked identifiers;
- available and current balances;
- recent transactions and spending categories.

Never ask for or store a bank password. A future production link must run in
Plaid Link, with the user present. Transfers, payments, and trading are out of
scope.

## Dashboard direction

The dashboard is the deliberate, visual counterpart to the hologram:

1. Today: schedule, three priorities, and reminders.
2. Inbox: email and task follow-ups, summarized rather than copied in full.
3. Focus: active task, timer, and interruption controls.
4. Later cards: health/wearable data and read-only financial summaries.

Build the dashboard after reviewing the user's reference images and written
summary. Those references should drive layout, density, and visual language;
the first version should not guess at the final design.
