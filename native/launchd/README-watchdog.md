# ORION watchdog: install and rollback

Nothing here is installed by the repo. Run these by hand.

## What it does
`scripts/orion-watchdog` runs one pass a minute (model-free). It probes Ollama (`:11434/api/version`), the Orion app
(process), the phone link (`launchctl print gui/UID/com.nickmadaio.orion.link`) and the gateway (`:18789/health`).

| Component | When down |
|---|---|
| Ollama | `open -g -a Ollama`, then warm both models (below) |
| Orion app | `open -a Orion` (no `-n`, so never a second instance) |
| Phone link | `launchctl kickstart` it; if the app is down, relaunching the app re-registers it |
| Gateway | alert only. Already KeepAlive; restarting it would cut a running focus session |

Backoff between relaunches: 60 s, 120 s, 240 s ... capped at 15 min. The first alert fires only if the component is still
down one pass after a relaunch; one alert per outage, one on recovery (only if a down alert went out), at least 10 min
between down alerts. Alerts use `scripts/orion-notify` (`blocked watchdog ...` / `complete watchdog ...`), so they
travel the existing Discord/phone path. State: `~/.openclaw/orion-controlled/watchdog.json`.

Warm-up after an Ollama outage, sequential: `qwen3.5:4b-q4_K_M` at `num_ctx 16384` and `qwen3.5:9b` at `num_ctx 32768`,
both `keep_alive "24h"`, `think false`, empty prompt. A failed warm stays pending and retries next pass.

## Why relaunch the app instead of a KeepAlive `ollama serve`
Ollama.app starts its own server on 11434. A second KeepAlive `ollama serve` would race it for the port and flap, and
two supervisors would fight. The app is also what the machine already runs, with its menu bar state and updates. So
the app is the one owner of the server, and the watchdog only relaunches the app. Env (`OLLAMA_MAX_LOADED_MODELS=2`)
comes from `com.nickmadaio.orion.ollama-env`, which sets it in the launchd user environment the app inherits.

## The phone link has no plist
`com.nickmadaio.orion.link` is registered by Orion.app itself through SMAppService (parent bundle
`com.nickmadaio.orion.app`), so there is nothing to template. Supervising Orion.app supervises the link.

## Install
```sh
REPO=/Users/nickmadaio/Desktop/ORION
LA=$HOME/Library/LaunchAgents
mkdir -p $HOME/.openclaw/logs
for n in watchdog ollama-env; do
  sed -e "s#__NODE__#$(command -v node)#" -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
    $REPO/native/launchd/com.nickmadaio.orion.$n.plist > $LA/com.nickmadaio.orion.$n.plist
  plutil -lint $LA/com.nickmadaio.orion.$n.plist
done
node $REPO/scripts/orion-watchdog --dry-run --json          # must show everything up
launchctl bootstrap gui/$(id -u) $LA/com.nickmadaio.orion.ollama-env.plist
launchctl bootstrap gui/$(id -u) $LA/com.nickmadaio.orion.watchdog.plist
launchctl getenv OLLAMA_MAX_LOADED_MODELS                   # 2
```
The env var only reaches Ollama on its next start; the watchdog will not restart a healthy Ollama. To apply it now, quit and
reopen Ollama yourself, at a moment you do not mind both models reloading (the watchdog then warms them).

Check: `scripts/orion-watchdog status`.

## Rollback
```sh
launchctl bootout gui/$(id -u)/com.nickmadaio.orion.watchdog
launchctl bootout gui/$(id -u)/com.nickmadaio.orion.ollama-env
rm ~/Library/LaunchAgents/com.nickmadaio.orion.{watchdog,ollama-env}.plist
launchctl unsetenv OLLAMA_MAX_LOADED_MODELS
rm -f ~/.openclaw/orion-controlled/watchdog.json
```
