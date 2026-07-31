#!/bin/zsh
#
# Pick Orion's voice.
#
# Deliberately small. An earlier version tried to LIST your account voices,
# which needs the `voices_read` scope a synthesis-only key does not have — so
# it dead-ended on the one thing it was for. Listing was never necessary: a
# voice id is visible in the URL on elevenlabs.io, and pasting one is faster
# than scrolling a menu.
#
#   e.g. jRAAK67SEFE9m7ci5DhD  (Ollie)
#
set -u

cd "$(dirname "$0")/ORION" || exit 1
env_file="$PWD/.env"
sample="Good evening, Nick. Orion is online, and every action I take is logged."

bold=$'\033[1m'; dim=$'\033[2m'; grn=$'\033[32m'; red=$'\033[31m'; off=$'\033[0m'

get() {
  python3 - "$env_file" "$1" <<'PY' 2>/dev/null
import sys
try:
    for line in open(sys.argv[1], encoding="utf-8"):
        line = line.strip()
        if line.startswith(sys.argv[2] + "="):
            print(line.split("=", 1)[1].strip().strip('"').strip("'"))
            break
except OSError:
    pass
PY
}

put() {
  python3 - "$env_file" "$1" "$2" <<'PY'
import pathlib, sys
p, name, value = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
lines = p.read_text().splitlines() if p.exists() else []
lines = [l for l in lines if not l.strip().startswith(name + "=")]
lines.append(name + "=" + value)
p.write_text("\n".join(l for l in lines if l.strip()) + "\n")
PY
  chmod 600 "$env_file" 2>/dev/null
}

# speak VOICE_ID MODEL -> plays it; returns 0 if it worked
speak() {
  local vid="$1" model="$2" code tmp
  code="$(curl -s -o /tmp/orion-voice.pcm -w '%{http_code}' --max-time 30 -X POST \
    -H "xi-api-key: $KEY" -H "Content-Type: application/json" \
    -d "{\"text\":\"$sample\",\"model_id\":\"$model\"}" \
    "https://api.elevenlabs.io/v1/text-to-speech/$vid?output_format=pcm_24000")"
  if [[ "$code" != "200" ]]; then
    print "${red}HTTP $code${off}"
    head -c 220 /tmp/orion-voice.pcm 2>/dev/null | sed 's/^/    /'
    rm -f /tmp/orion-voice.pcm
    return 1
  fi
  tmp="$(mktemp -t orionvoice).wav"
  python3 - "$tmp" <<'PY'
import sys, wave
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
    w.writeframes(open("/tmp/orion-voice.pcm", "rb").read())
PY
  afplay "$tmp" 2>/dev/null
  rm -f "$tmp" /tmp/orion-voice.pcm
  return 0
}

KEY="$(get ELEVENLABS_API_KEY)"
if [[ -z "$KEY" ]]; then
  print "${red}No ElevenLabs key.${off} Run 'Orion Keys' first."
  print ""
  print "Press return to close."
  read -r _
  exit 1
fi

voice="$(get ORION_ELEVEN_VOICE_ID)"
model="$(get ORION_ELEVEN_MODEL)"
[[ -z "$voice" ]] && voice="21m00Tcm4TlvDq8ikWAM"
[[ -z "$model" ]] && model="eleven_flash_v2_5"

print ""
print "${bold}Orion — voice${off}"
print "  voice: $voice"
print "  model: $model"
print ""
print "  Playing the current voice…"
speak "$voice" "$model"

print ""
print "  ${dim}Paste a different voice id to try it, or return to keep this one.${off}"
print -n "  voice id: "
read -r newvoice

if [[ -n "$newvoice" ]]; then
  print -n "  Trying it… "
  if speak "$newvoice" "$model"; then
    put ORION_ELEVEN_VOICE_ID "$newvoice"
    voice="$newvoice"
    print "  ${grn}saved${off}"
  else
    print "  not saved"
  fi
fi

print ""
print "  ${bold}Model${off}"
print "    1  eleven_flash_v2_5       fastest             ${dim}0.5 credits/char${off}"
print "    2  eleven_turbo_v2_5       better, same price  ${dim}0.5 credits/char${off}"
print "    3  eleven_multilingual_v2  richest             ${dim}1 credit/char (2x)${off}"
print -n "  number (return to keep $model): "
read -r m

case "$m" in
  1) model="eleven_flash_v2_5" ;;
  2) model="eleven_turbo_v2_5" ;;
  3) model="eleven_multilingual_v2" ;;
esac

if [[ -n "$m" ]]; then
  put ORION_ELEVEN_MODEL "$model"
  print "  ${grn}saved${off} $model — listen:"
  speak "$voice" "$model"
fi

print ""
print "  Restarting the voice daemon so Orion uses this…"
pkill -f orion_tts_daemon.py 2>/dev/null
rm -f "$HOME/.openclaw/orion-tts.sock"
py="$(./scripts/orion-python 2>/dev/null)"
[[ -z "$py" ]] && py=python3
mkdir -p "$HOME/.openclaw/logs"
: > "$HOME/.openclaw/logs/orion-tts.err.log"
ORION_TTS_CLOUD_VOICE=1 ORION_ENV_FILE="$env_file" nohup "$py" \
  scripts/orion_tts_daemon.py >>"$HOME/.openclaw/logs/orion-tts.out.log" \
  2>>"$HOME/.openclaw/logs/orion-tts.err.log" </dev/null &
disown

for _ in {1..80}; do
  [[ -S "$HOME/.openclaw/orion-tts.sock" ]] && break
  sleep 0.25
done

print ""
print "  ${bold}Through Orion's own pipeline${off} — one continuous take:"
tmp="$(mktemp -t orionfinal).wav"
if ./scripts/orion-local-tts "$tmp" "Good evening, Nick. Everything is working now." 2>/dev/null; then
  [[ -s "$tmp" ]] && afplay "$tmp" 2>/dev/null
fi
rm -f "$tmp"

print ""
grep -E 'ok provider=' "$HOME/.openclaw/logs/orion-tts.err.log" 2>/dev/null | tail -1 \
  | sed -E 's/.*(provider=[^ ]+) (engine=[^ ]+).*(first_ms=[0-9]+).*/  served by \1 \2 \3/'

print ""
print "Press return to close."
read -r _
