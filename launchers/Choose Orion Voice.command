#!/bin/zsh
#
# Double-click me to hear Orion's available voices and pick one.
#
# Lists the voices on your ElevenLabs account, speaks a sample line in each so
# you can actually judge them, and saves your choice. Also lets you set the
# model — Flash is the fast one, Turbo and Multilingual sound better and cost
# a little more latency.
#
cd "$(dirname "$0")/ORION" || exit 1
chmod +x scripts/orion-* scripts/*.py 2>/dev/null

bold=$'\033[1m'; dim=$'\033[2m'; grn=$'\033[32m'; red=$'\033[31m'; yel=$'\033[33m'; off=$'\033[0m'
env_file="$PWD/.env"
sample="Good evening, Nick. All systems are nominal."

read_env() {
  python3 - "$env_file" "$1" <<'PY' 2>/dev/null
import sys
try:
    for line in open(sys.argv[1], encoding="utf-8"):
        line = line.strip()
        if line.startswith(f"{sys.argv[2]}="):
            print(line.split("=", 1)[1].strip().strip('"').strip("'")); break
except OSError: pass
PY
}

write_env() {
  python3 - "$env_file" "$1" "$2" <<'PY'
import pathlib, sys
p, name, value = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
lines = p.read_text().splitlines() if p.exists() else []
lines = [l for l in lines if not l.strip().startswith(f"{name}=")]
lines.append(f"{name}={value}")
p.write_text("\n".join(l for l in lines if l.strip()) + "\n")
PY
  chmod 600 "$env_file" 2>/dev/null
}

key="$(read_env ELEVENLABS_API_KEY)"
if [[ -z "$key" ]]; then
  print "${red}No ElevenLabs key.${off} Run 'Orion Keys' first."
  print ""; print "Press return to close."; read -r _; exit 1
fi

current_voice="$(read_env ORION_ELEVEN_VOICE_ID)"
current_model="$(read_env ORION_ELEVEN_MODEL)"
[[ -z "$current_model" ]] && current_model="eleven_flash_v2_5"

print ""
print "${bold}Orion — choose a voice${off}"
print "  ${dim}current voice: ${current_voice:-default}   model: $current_model${off}"
print ""
print "  Fetching your voices…"

curl -s --max-time 25 -H "xi-api-key: $key" \
     https://api.elevenlabs.io/v2/voices?page_size=40 > /tmp/ov-voices.json 2>/dev/null \
  || curl -s --max-time 25 -H "xi-api-key: $key" \
     https://api.elevenlabs.io/v1/voices > /tmp/ov-voices.json 2>/dev/null

count="$(python3 -c "
import json
try:
    d=json.load(open('/tmp/ov-voices.json')); print(len(d.get('voices') or []))
except Exception: print(0)")"

if [[ "$count" == "0" ]]; then
  print "  ${red}Could not list voices.${off}"
  head -c 300 /tmp/ov-voices.json 2>/dev/null | sed 's/^/    /'
  print ""
  print "  If this says missing_permissions, your key needs the 'Voices: Read'"
  print "  scope as well as Text to Speech."
  print ""; print "Press return to close."; read -r _; exit 1
fi

python3 -c "
import json
d=json.load(open('/tmp/ov-voices.json'))
for i,v in enumerate(d.get('voices') or [], 1):
    labels=v.get('labels') or {}
    bits=[labels.get(k) for k in ('accent','gender','age','description') if labels.get(k)]
    print(f'  {i:2}. {v.get(\"name\",\"?\"):<22} {\", \".join(bits)[:52]}')
"
print ""
print "  ${dim}Enter numbers to preview (e.g. 1 4 7), or 'a' for all. Return to skip.${off}"
print -n "  preview: "
read -r picks

preview_one() {  # preview_one INDEX
  local vid vname tmp
  vid="$(python3 -c "
import json
d=json.load(open('/tmp/ov-voices.json')); vs=d.get('voices') or []
i=$1-1
print(vs[i].get('voice_id','') if 0<=i<len(vs) else '')")"
  vname="$(python3 -c "
import json
d=json.load(open('/tmp/ov-voices.json')); vs=d.get('voices') or []
i=$1-1
print(vs[i].get('name','?') if 0<=i<len(vs) else '?')")"
  [[ -z "$vid" ]] && { print "    no voice $1"; return; }
  tmp="$(mktemp -t ovprev).wav"
  print -n "    ${bold}${vname}${off} … "
  code="$(curl -s -o /tmp/ov-prev.pcm -w '%{http_code}' --max-time 30 -X POST \
    -H "xi-api-key: $key" -H "Content-Type: application/json" \
    -d "{\"text\":\"$sample\",\"model_id\":\"$current_model\"}" \
    "https://api.elevenlabs.io/v1/text-to-speech/$vid?output_format=pcm_24000")"
  if [[ "$code" == "200" ]]; then
    # Raw PCM needs a WAV header before afplay will touch it.
    python3 -c "
import wave
with wave.open('$tmp','wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
    w.writeframes(open('/tmp/ov-prev.pcm','rb').read())"
    afplay "$tmp" 2>/dev/null
    print "played"
  else
    print "${red}HTTP $code${off}"
  fi
  rm -f "$tmp" /tmp/ov-prev.pcm
}

if [[ "$picks" == "a" || "$picks" == "A" ]]; then
  for i in $(seq 1 "$count"); do preview_one "$i"; done
elif [[ -n "$picks" ]]; then
  for i in ${=picks}; do preview_one "$i"; done
fi

print ""
print -n "  Which number do you want Orion to use? (return to keep current) "
read -r choice
if [[ -n "$choice" ]]; then
  vid="$(python3 -c "
import json
d=json.load(open('/tmp/ov-voices.json')); vs=d.get('voices') or []
i=$choice-1
print(vs[i].get('voice_id','') if 0<=i<len(vs) else '')")"
  vname="$(python3 -c "
import json
d=json.load(open('/tmp/ov-voices.json')); vs=d.get('voices') or []
i=$choice-1
print(vs[i].get('name','?') if 0<=i<len(vs) else '?')")"
  if [[ -n "$vid" ]]; then
    write_env ORION_ELEVEN_VOICE_ID "$vid"
    print "  ${grn}saved${off} — Orion will speak as ${bold}${vname}${off}"
  else
    print "  ${yel}no voice $choice — nothing changed${off}"
  fi
fi


# ---------------------------------------------------------------- library
# Voices you have seen on elevenlabs.io are mostly in the shared Voice
# Library, not on your account. "Ollie - Natural and Relaxed British Voice" is
# one of those. It has to be added to your account before it has a voice_id
# you can synthesise with, which is why it never showed up in the list above.
search_library() {
  print ""
  print -n "  ${bold}Search the ElevenLabs voice library${off} (e.g. Ollie): "
  read -r q
  [[ -z "$q" ]] && return 0

  curl -s --max-time 25 -H "xi-api-key: $key" \
    "https://api.elevenlabs.io/v1/shared-voices?page_size=20&search=$(print -r -- "$q" | sed 's/ /%20/g')" \
    > /tmp/ov-lib.json 2>/dev/null

  n="$(python3 -c "
import json
try:
    d=json.load(open('/tmp/ov-lib.json')); print(len(d.get('voices') or []))
except Exception: print(0)")"
  if [[ "$n" == "0" ]]; then
    print "  ${yel}nothing found for '$q'${off}"
    head -c 200 /tmp/ov-lib.json 2>/dev/null | sed 's/^/    /'
    return 0
  fi

  python3 -c "
import json
d=json.load(open('/tmp/ov-lib.json'))
for i,v in enumerate(d.get('voices') or [], 1):
    bits=[v.get(k) for k in ('accent','gender','age') if v.get(k)]
    d2=(v.get('description') or '')[:38]
    print(f'  {i:2}. {v.get(\"name\",\"?\"):<26} {\", \".join(bits)[:26]:<26} {d2}')
"
  print ""
  print -n "  Preview which? (numbers, or return to skip) "
  read -r pv
  for i in ${=pv}; do
    vid="$(python3 -c "
import json
d=json.load(open('/tmp/ov-lib.json')); vs=d.get('voices') or []
i=$i-1
print(vs[i].get('voice_id','') if 0<=i<len(vs) else '')")"
    nm="$(python3 -c "
import json
d=json.load(open('/tmp/ov-lib.json')); vs=d.get('voices') or []
i=$i-1
print(vs[i].get('name','?') if 0<=i<len(vs) else '?')")"
    [[ -z "$vid" ]] && continue
    tmp="$(mktemp -t ovlib).wav"
    print -n "    ${bold}${nm}${off} … "
    code="$(curl -s -o /tmp/ov-p.pcm -w '%{http_code}' --max-time 30 -X POST \
      -H "xi-api-key: $key" -H "Content-Type: application/json" \
      -d "{\"text\":\"$sample\",\"model_id\":\"$current_model\"}" \
      "https://api.elevenlabs.io/v1/text-to-speech/$vid?output_format=pcm_24000")"
    if [[ "$code" == "200" ]]; then
      python3 -c "
import wave
with wave.open('$tmp','wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
    w.writeframes(open('/tmp/ov-p.pcm','rb').read())"
      afplay "$tmp" 2>/dev/null; print "played"
    else
      print "${yel}HTTP $code — may need adding to your account first${off}"
    fi
    rm -f "$tmp" /tmp/ov-p.pcm
  done

  print ""
  print -n "  Add which one to your account and use it? (number, or return) "
  read -r pick
  [[ -z "$pick" ]] && return 0
  vid="$(python3 -c "
import json
d=json.load(open('/tmp/ov-lib.json')); vs=d.get('voices') or []
i=$pick-1
print(vs[i].get('voice_id','') if 0<=i<len(vs) else '')")"
  pub="$(python3 -c "
import json
d=json.load(open('/tmp/ov-lib.json')); vs=d.get('voices') or []
i=$pick-1
print(vs[i].get('public_owner_id','') if 0<=i<len(vs) else '')")"
  nm="$(python3 -c "
import json
d=json.load(open('/tmp/ov-lib.json')); vs=d.get('voices') or []
i=$pick-1
print(vs[i].get('name','Orion Voice') if 0<=i<len(vs) else 'Orion Voice')")"
  if [[ -z "$vid" || -z "$pub" ]]; then
    print "  ${yel}could not resolve that voice${off}"
    return 0
  fi

  print -n "  Adding \"$nm\" to your account… "
  add="$(curl -s --max-time 25 -X POST \
    -H "xi-api-key: $key" -H "Content-Type: application/json" \
    -d "{\"new_name\":\"$nm\"}" \
    "https://api.elevenlabs.io/v1/voices/add/$pub/$vid" 2>/dev/null)"
  newid="$(print -r -- "$add" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('voice_id',''))
except Exception: print('')")"
  if [[ -n "$newid" ]]; then
    write_env ORION_ELEVEN_VOICE_ID "$newid"
    print "${grn}added and selected${off}"
  else
    # Already on the account, or the add endpoint declined. The library id
    # usually still works for synthesis, so fall back to it rather than fail.
    write_env ORION_ELEVEN_VOICE_ID "$vid"
    print "${yel}using the library id directly${off}"
    print -r -- "$add" | head -c 200 | sed 's/^/    /'
  fi
  rm -f /tmp/ov-lib.json
}

print ""
print -n "  ${dim}Not seeing the voice you want? Search the voice library? [y/N] ${off}"
read -r wantlib
[[ "$wantlib" == [yY]* ]] && search_library

print ""
print "  ${bold}Model${off}  ${dim}(affects how natural it sounds vs how fast)${off}"
print "    1. eleven_flash_v2_5      fastest        ${dim}0.5 credits/char${off}"
print "    2. eleven_turbo_v2_5      better, same price ${dim}0.5 credits/char  <- free upgrade${off}"
print "    3. eleven_multilingual_v2 richest         ${dim}1 credit/char — 2x the cost${off}"
print -n "  Model number (return to keep $current_model): "
read -r m
case "$m" in
  1) write_env ORION_ELEVEN_MODEL eleven_flash_v2_5;      print "  ${grn}saved${off} flash" ;;
  2) write_env ORION_ELEVEN_MODEL eleven_turbo_v2_5;      print "  ${grn}saved${off} turbo" ;;
  3) write_env ORION_ELEVEN_MODEL eleven_multilingual_v2; print "  ${grn}saved${off} multilingual" ;;
esac

rm -f /tmp/ov-voices.json

print ""
print "  Restarting the voice daemon…"
pkill -f orion_tts_daemon.py 2>/dev/null
rm -f "$HOME/.openclaw/orion-tts.sock"
py="$(./scripts/orion-python 2>/dev/null)"; [[ -z "$py" ]] && py=python3
: > "$HOME/.openclaw/logs/orion-tts.err.log"
ORION_TTS_CLOUD_VOICE=1 ORION_ENV_FILE="$env_file" nohup "$py" \
  scripts/orion_tts_daemon.py >>"$HOME/.openclaw/logs/orion-tts.out.log" \
  2>>"$HOME/.openclaw/logs/orion-tts.err.log" </dev/null &
disown
for _ in {1..80}; do [[ -S "$HOME/.openclaw/orion-tts.sock" ]] && break; sleep 0.25; done

print ""
print "  ${bold}Hearing it for real${off} — one continuous line, no chunking:"
tmp="$(mktemp -t ovfinal).wav"
if ./scripts/orion-local-tts "$tmp" "Good evening, Nick. Orion is online, and every action I take is logged and reversible." 2>/dev/null && [[ -s "$tmp" ]]; then
  afplay "$tmp" 2>/dev/null
fi
rm -f "$tmp"
grep -E 'ok provider=' "$HOME/.openclaw/logs/orion-tts.err.log" 2>/dev/null | tail -1 \
  | sed -E 's/.*(provider=[^ ]+) (engine=[^ ]+).*(first_ms=[0-9]+).*/    \1 \2 \3/'

print ""
print "Press return to close."
read -r _
