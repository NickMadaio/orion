#!/bin/zsh
#
# Double-click me to hear Orion and see which engine really served it.
#
# Checks the key against the real TTS endpoint, restarts the daemon with the
# cloud voice selected, speaks three lines, and reports time-to-first-audio
# plus the engine that ACTUALLY served each one — because "it spoke" is not
# the same as "ElevenLabs spoke", and the daemon falls back silently by design.
#
cd "$(dirname "$0")/ORION" || exit 1
chmod +x scripts/orion-* scripts/*.py 2>/dev/null

bold=$'\033[1m'; dim=$'\033[2m'; grn=$'\033[32m'; red=$'\033[31m'; yel=$'\033[33m'; off=$'\033[0m'
log="$HOME/.openclaw/logs/orion-tts.err.log"
sock="$HOME/.openclaw/orion-tts.sock"

print ""
print "${bold}ORION voice test${off}"

# ---------------------------------------------------------------- 1. the key
print ""
print "${bold}1. ElevenLabs key${off}"
key="$(python3 - "$PWD/.env" <<'PY' 2>/dev/null
import sys
try:
    for line in open(sys.argv[1], encoding="utf-8"):
        line = line.strip()
        if line.startswith("ELEVENLABS_API_KEY="):
            print(line.split("=", 1)[1].strip().strip('"').strip("'")); break
except OSError: pass
PY
)"
if [[ -z "$key" ]]; then
  print "  ${red}no key in .env${off} — run 'Orion Keys' first"
  print ""; print "Press return to close."; read -r _; exit 1
fi

code="$(curl -s -o /tmp/ov.bin -w '%{http_code}' --max-time 25 -X POST \
        -H "xi-api-key: $key" -H "Content-Type: application/json" \
        -d '{"text":"ok","model_id":"eleven_flash_v2_5"}' \
        "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=pcm_24000")"
if [[ "$code" == "200" ]]; then
  print "  ${grn}working${off} — $(wc -c < /tmp/ov.bin | tr -d ' ') bytes of audio"
else
  print "  ${red}HTTP $code${off}"
  head -c 300 /tmp/ov.bin 2>/dev/null | sed 's/^/    /'
  print ""
  print "  Orion will still speak, using the local voice."
fi
rm -f /tmp/ov.bin

# ------------------------------------------------------------- 2. the daemon
print ""
print "${bold}2. Restarting the voice daemon with the cloud voice on${off}"
pkill -f orion_tts_daemon.py 2>/dev/null
rm -f "$sock"
py="$(./scripts/orion-python 2>/dev/null)"; [[ -z "$py" ]] && py=python3
mkdir -p "$HOME/.openclaw/logs"
: > "$log"   # fresh log so "which engine served" is unambiguous
ORION_TTS_CLOUD_VOICE=1 ORION_TTS_ENGINE=auto ORION_ENV_FILE="$PWD/.env" \
  nohup "$py" scripts/orion_tts_daemon.py >>"$HOME/.openclaw/logs/orion-tts.out.log" \
  2>>"$log" </dev/null &
disown
for _ in {1..80}; do [[ -S "$sock" ]] && break; sleep 0.25; done
if [[ -S "$sock" ]]; then
  print "  ${grn}up${off}"
  grep -m1 -E 'voice provider=' "$log" 2>/dev/null | sed 's/^/  /'
else
  print "  ${red}did not start${off} — see $log"
  print ""; print "Press return to close."; read -r _; exit 1
fi

# -------------------------------------------------------------- 3. speak
print ""
print "${bold}3. Speaking${off}  ${dim}(listen)${off}"
say_line() {
  local text="$1" tmp start ms
  tmp="$(mktemp -t orionvoice).wav"
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  if ./scripts/orion-local-tts "$tmp" "$text" 2>/dev/null && [[ -s "$tmp" ]]; then
    ms=$(( $(python3 -c 'import time;print(int(time.time()*1000))') - start ))
    print "  ${dim}${ms}ms${off}  \"$text\""
    afplay "$tmp" 2>/dev/null
  else
    print "  ${red}failed${off}  \"$text\""
  fi
  rm -f "$tmp"
}

say_line "Orion online."
say_line "All systems nominal. The permission gate is active and every action is logged."
say_line "Good evening, Nick."

# ------------------------------------------------------- 4. what really served
print ""
print "${bold}4. Which engine actually served those${off}"
if grep -q 'provider=elevenlabs engine=elevenlabs' "$log" 2>/dev/null; then
  print "  ${grn}ElevenLabs${off} — the cloud voice is live"
elif grep -q 'engine=mlx-warm' "$log" 2>/dev/null; then
  print "  ${yel}local MLX${off} — ElevenLabs was selected but fell back"
  print "  ${dim}reason:${off}"
  grep -E 'failed|falling back|http [0-9]+' "$log" 2>/dev/null | tail -3 | sed 's/^/    /'
elif grep -q 'engine=say' "$log" 2>/dev/null; then
  print "  ${red}macOS 'say'${off} — both real engines failed"
  grep -E 'warn|error' "$log" 2>/dev/null | tail -4 | sed 's/^/    /'
fi
print ""
print "  ${dim}per-job detail:${off}"
grep -E 'ok provider=' "$log" 2>/dev/null | tail -3 \
  | sed -E 's/.*(provider=[^ ]+) (engine=[^ ]+).*(first_ms=[0-9]+).*/    \1 \2 \3/'

print ""
print "Press return to close."
read -r _
