#!/bin/bash
#
# Live check against Ollama: does the model that writes ORION's narratives get
# the direction right for strain 8.4 against a suggested band of 14-18 (below)?
# llama3.2:3b wrote "you may be pushing yourself too hard" for this exact case.
#
# Uses the same request shape as LocalModel.requestBody for the resident 9B
# (think false, num_ctx 32768, keep_alive 24h) so Ollama does not reload it.
# 2026-10-16: qwen3.5:9b passed 3 of 3. Run:  Tests/run-local-model-direction.sh [model] [runs]
set -uo pipefail
MODEL="${1:-qwen3.5:9b}"; RUNS="${2:-3}"
PROMPT='You write a 2-3 sentence health summary for Nick, using only the numbers below. Do not add facts.
Recovery: 71% (green).
Day strain so far: 8.4 on a 0-21 scale.
Suggested strain band for today given recovery: 14-18.
Say plainly whether his strain is below, within, or above the band and what that means for him.'
pass=0
for i in $(seq "$RUNS"); do
  out=$(MODEL="$MODEL" PROMPT="$PROMPT" python3 - <<'PY'
import json, os, urllib.request
body = {"model": os.environ["MODEL"], "prompt": os.environ["PROMPT"], "stream": False, "think": False,
        "keep_alive": "24h", "options": {"temperature": 0.4, "num_predict": 400, "num_ctx": 32768}}
req = urllib.request.Request("http://127.0.0.1:11434/api/generate", json.dumps(body).encode(), {"Content-Type": "application/json"})
t = json.load(urllib.request.urlopen(req, timeout=90))["response"].strip().replace("\n", " ")
low = t.lower()
says = ["below", "under the", "lower than", "less than", "short of", "has room", "room to", "undertrain", "low strain"]
wrong = ["pushing yourself too hard", "too hard", "above the", "within the band",
         "within that band", "within the suggested", "too much strain"]
print(("PASS" if any(s in low for s in says) and not any(w in low for w in wrong) else "FAIL") + " | " + t)
PY
)
  echo "run $i: $out"; case "$out" in PASS*) pass=$((pass+1));; esac
done
echo "$pass/$RUNS correct ($MODEL)"; [ "$pass" -eq "$RUNS" ]
