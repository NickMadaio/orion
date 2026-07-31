#!/bin/zsh
# Double-click me.
#
# Builds Orion, signs it, installs it, starts the voice daemon and the gateway,
# then launches. Safe to run as many times as you like.
cd "$(dirname "$0")/ORION" || exit 1
# Editors and sync tools drop the executable bit surprisingly often, and the
# failure ("permission denied") looks nothing like its cause.
chmod +x scripts/orion-* scripts/*.py native/Orion/make_app_bundle.sh 2>/dev/null
./scripts/orion-setup
print ""
print "Press return to close this window."
read -r _
