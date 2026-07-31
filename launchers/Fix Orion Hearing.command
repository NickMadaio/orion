#!/bin/zsh
# Double-click me when Orion can't hear you.
cd "$(dirname "$0")/ORION" || exit 1
chmod +x scripts/orion-* 2>/dev/null
mkdir -p data
./scripts/orion-mic-doctor 2>&1 | tee data/mic-doctor.log
print ""
print "Press return to close."
read -r _
