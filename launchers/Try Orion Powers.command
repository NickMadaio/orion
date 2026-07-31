#!/bin/zsh
# Restart the gateway with the new capabilities and exercise them for real.
cd "$(dirname "$0")/ORION" || exit 1
chmod +x scripts/orion-* 2>/dev/null
bin="$HOME/.openclaw/bin/openclaw"
ledger="$HOME/.openclaw/orion-controlled/task-ledger.jsonl"
[[ -f "$ledger" ]] || ledger="$(ls -t "$HOME"/.openclaw/orion-controlled/*.jsonl 2>/dev/null | head -1)"
out="data/powers.log"; : > "$out"

print "Retiring the old session and restarting the gateway…"
./scripts/orion-reset-session main orion-app >/dev/null 2>&1
"$bin" daemon restart >/dev/null 2>&1
for _ in {1..40}; do
  python3 -c "import socket,sys;s=socket.socket();s.settimeout(0.6);sys.exit(min(1,s.connect_ex(('127.0.0.1',18789))))" 2>/dev/null && break
  sleep 0.5
done
sleep 3

before=0; [[ -f "$ledger" ]] && before=$(wc -l < "$ledger" | tr -d ' ')

ask() {
  print "" | tee -a "$out"
  print "── $1" | tee -a "$out"
  "$bin" agent --session-key orion-app --message "$1" --json --timeout 120 2>&1 \
  | python3 -c '
import json,sys,re
raw=re.sub(r"\x1b\[[0-9;]*[A-Za-z]","",sys.stdin.read())
try:
    d=json.loads(raw[raw.index("{"):]); r=d.get("result",d)
    print("\n".join(p.get("text","") for p in r.get("payloads",[]))[:600])
except Exception as e: print("unparseable:",e)
' | sed 's/^/   /' | tee -a "$out"
}

ask "what tools can you use now? list just the action names you have available."
ask "open github.com in a new tab"
ask "what tabs do I have open?"

after=0; [[ -f "$ledger" ]] && after=$(wc -l < "$ledger" | tr -d ' ')
print "" | tee -a "$out"
print "ledger: $before -> $after  (every action should be recorded)" | tee -a "$out"
print ""
print "Press return to close."
read -r _
