# Things only you can do

What is blocked on you, not on code. Older items are in the archive (see the last line).

## Now

1. Rebuild both apps from main (fa3f3c3 or later) so ORION can ask your phone for a fresh location. The Mac app is installed (build 1218, 08:00), but your phone's location has been stuck since 10-30 because the installed phone app is older than 10-16. Plug the phone in with a USB-C data cable (a MagSafe charger can't transfer data), unlock it, tap Trust if asked, then tell Claude "install the phone app".
2. After the install, set the phone up:
   - ORION > Control > Signals on.
   - iOS Settings > ORION > Location: Always, and Background App Refresh on.
   - Don't swipe ORION away.
3. On the phone, open ORION > Focus lists and pick apps for each group: Social, Video, Games, Messaging and Browsers. iOS only lets you pick these yourself. A group with no apps blocks nothing.
4. Tell ORION your sleep plan, something like "im gonna start waking up earlier and going to bed earlier". He asks the rest. No alarm rings until you set a plan.
5. Keep your normal alarm for the first morning. ORION's alarms haven't rung for real yet.

## Whenever

- Razer third button (the sensitivity switch): over Bluetooth it sends nothing to the Mac, checked 11-03. Once, with a USB-C to USB-A adapter and the Razer dongle, or on any Windows PC: open Razer Synapse, set that button to "mouse button 6" or F13, and save it to the mouse's onboard memory. Then ORION can map it.
- Anthropic credits: ORION now runs on local models, so this isn't urgent. If you want the cloud model as a fallback, check the balance at console.anthropic.com.
- Back up the Sparkle signing key. It's the only key that can sign updates, and if the Mac dies no installed copy can ever update. Run `native/Orion/.build/artifacts/sparkle/Sparkle/bin/generate_keys -x ~/Desktop/orion-sparkle-key.txt`, put the file in a password manager, delete the local copy.
- Break ambience: drop real rain, waves and wind loops (30 to 90 seconds, seamless) into `native/Orion/Resources/Ambience/` as `rain.m4a`, `waves.m4a`, `wind.m4a`. Until then the break is silent.
- Self-modification: seven actions (self_modify, self_plugin_modify and so on) change ORION's own code without asking you first. Decide whether that's the posture you want. Details in `docs/planning/v2/PHASE_GATES.json`.
- More mail accounts (alerts from a second Gmail and Yahoo). Each step is yours because it signs in as you:
  - Gmail (the first one too, its sign-in expired): `gog auth add nmadaio08@gmail.com`. A second Gmail: `gog auth add <address>`, then `scripts/orion-mail-accounts add-gmail <address>`.
  - Yahoo: Yahoo Account Security, "Generate app password", name it ORION. Then `security add-generic-password -s 'orion-mail-imap:<you>@yahoo.com' -a '<you>@yahoo.com' -w` (it asks for the app password; type it there, never in the command). Then `scripts/orion-mail-accounts add-imap <you>@yahoo.com`.
  - Check all: `scripts/orion-mail-accounts status`.
- Google Calendar and Gmail: needs a Google Cloud project with an OAuth client (Desktop app, Testing mode, you as test user). Tell Claude the client ID and keep the secret in your Keychain. Only worth doing if you want ORION in your mail.
- HealthKit: now that the developer account exists, add the HealthKit capability in Xcode so ORION can read sleep and heart data. Ask Claude to walk you through it.

Older items are in `/Users/nickmadaio/Desktop/ORION-archive/2026-11-02/NICK-TODO-before-cleanup.md` and in git history.
