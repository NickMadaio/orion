#!/bin/bash
cd /Users/nickmadaio/Desktop/ORION
D=docs/evals/2026-10-01-schedule; N=~/.openclaw/tools/node-v24.15.0/bin/node
for m in anthropic/claude-haiku-4-5-20251001 anthropic/claude-sonnet-5 ollama/qwen3.5:9b ollama/qwen3.6:27b; do
  tag=$(echo $m | tr '/:.' '---')
  $N scripts/orion-eval-schedule scripts/eval/schedule-scenarios.json --model $m --thinking medium --out $D/$tag.json > $D/$tag.log 2>&1
  echo "$m (thinking medium): $(tail -1 $D/$tag.log) $(python3 -c "import json;r=json.load(open('$D/$tag.json'));s=sorted(x['secs'] for x in r);print('total',sum(s),'s, median',s[len(s)//2],'s per request')" 2>/dev/null)" >> $D/SUMMARY.txt
done
echo done >> $D/SUMMARY.txt
