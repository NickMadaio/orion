#!/bin/zsh
# Live gauntlet (2026-10-12): Nick-style messages through the REAL gateway route on his REAL calendar,
# each line a turn in one session; prints the reply, the scheduling flow call and the day after it.
# Both rounds end by emptying what they added. Usage: DAYARG=today|tomorrow run.sh < today.txt
# Only run with Nick's OK and while he is not mid-conversation with ORION. 12/12 passed on 2026-10-12.
O=~/.openclaw/bin/openclaw; A=/Users/nickmadaio/Desktop/ORION/scripts/orion-agenda; DAYARG=${DAYARG:-today}; KEY=orion-gauntlet-$(date +%H%M)
i=0
while IFS= read -r msg; do
  [[ -z "$msg" ]] && continue; i=$((i+1))
  s=$(date +%s)
  reply=$($O agent --session-key $KEY --message "$msg" --timeout 240 2>&1 | grep -v "^\[plugins\]" | tail -4 | tr '\n' ' ')
  t=$(( $(date +%s)-s ))
  flow=$(tail -1 ~/.openclaw/orion-controlled/local-routing/shadow.jsonl | python3 -c "import sys,json; e=json.loads(sys.stdin.read()); f=e.get('flow') or {}; print(f.get('outcome'), (f.get('calls') or [f.get('reason','')])[0][:110] if f else 'no-flow', e['findings'])")
  day=$($A day $DAYARG 2>&1 | grep -v "id:" | grep -E "PM|AM" | grep -v "all day" | sed 's/^ *today //' | tr '\n' '|')
  echo "[$i] ($t s) NICK: $msg"
  echo "    ORION: $reply"
  echo "    FLOW: $flow"
  echo "    DAY: $day"
done
