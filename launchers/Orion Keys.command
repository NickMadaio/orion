#!/bin/zsh
# Double-click me to set or check Orion's API keys.
# Shows whether each key actually works, takes a new one with hidden input,
# checks it with the vendor before saving, and restarts the voice daemon.
cd "$(dirname "$0")/ORION" || exit 1
chmod +x scripts/orion-* scripts/*.py 2>/dev/null
./scripts/orion-keys
print ""
print "Press return to close."
read -r _
