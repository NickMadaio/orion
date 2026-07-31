#!/bin/zsh
# Rebuild with the Deepgram converter fix, switch the ear back to Deepgram,
# and bring the voice daemon back up (it now ignores SIGHUP).
cd "$(dirname "$0")/ORION" || exit 1
chmod +x scripts/orion-* scripts/*.py 2>/dev/null
log="$HOME/.openclaw/logs/orion-app.log"
sock="$HOME/.openclaw/orion-tts.sock"

print "Rebuilding Orion…"
pkill -x Orion 2>/dev/null; sleep 1
(cd native/Orion && ./make_app_bundle.sh) 2>&1 | grep -E '^Signed:|error:' | sed 's/^/  /'
rm -rf /Applications/Orion.app
cp -R native/Orion/.build/Orion.app /Applications/ 2>/dev/null

print "Ear back to Deepgram (Apple stays as the automatic fallback)…"
defaults write com.nickmadaio.orion.app OrionSTTProvider -string deepgram

print "Restarting the voice daemon…"
pkill -f orion_tts_daemon.py 2>/dev/null; sleep 1; rm -f "$sock"
py="$(./scripts/orion-python 2>/dev/null)"; [[ -z "$py" ]] && py=python3
mkdir -p "$HOME/.openclaw/logs"
ORION_TTS_CLOUD_VOICE=1 ORION_ENV_FILE="$PWD/.env" nohup "$py" \
  scripts/orion_tts_daemon.py >>"$HOME/.openclaw/logs/orion-tts.out.log" \
  2>>"$HOME/.openclaw/logs/orion-tts.err.log" </dev/null &
disown
for _ in {1..80}; do [[ -S "$sock" ]] && break; sleep 0.25; done
[[ -S "$sock" ]] && print "  voice up" || print "  voice did NOT start"

: > "$log"
open /Applications/Orion.app
sleep 4

cat <<'MSG'

════════════════════════════════════════════════════
  HOLD Right Option and say:

      "Orion, what time is it"

  Release. Orion should hear you AND speak back.
  Then press return here.
════════════════════════════════════════════════════
MSG
read -r _

print ""
print "Hearing:"
grep -E '\[deepgram\] heard|\[apple\] heard|\[deepgram\] STARVED|sent=' "$log" 2>/dev/null | tail -6 | sed 's/^/  /'
print ""
print "Voice:"
grep -E 'ok provider=' "$HOME/.openclaw/logs/orion-tts.err.log" 2>/dev/null | tail -2 \
  | sed -E 's/.*(provider=[^ ]+) (engine=[^ ]+).*(first_ms=[0-9]+).*/  \1 \2 \3/'
print ""
print "Press return to close."
read -r _
