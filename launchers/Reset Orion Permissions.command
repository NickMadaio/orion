#!/bin/zsh
#
# Double-click me to clear Orion's stale permission grants.
#
# Why this exists: most Privacy panes (Microphone, Speech Recognition, Camera)
# are toggle-only — there is no (−) button, so a grant attached to an older
# build cannot be removed by hand. Toggling off does not help either: the entry
# stays, and macOS will not re-prompt while it is there.
#
# `tccutil reset` is Apple's own tool for exactly this. It REVOKES a permission
# and returns it to "never asked", so the next launch prompts fresh. It only
# ever removes access, never grants it, and it is scoped here to Orion alone.
#
set -u

bundle="com.nickmadaio.orion.app"
bold=$'\033[1m'; dim=$'\033[2m'; grn=$'\033[32m'; yel=$'\033[33m'; off=$'\033[0m'

print ""
print "${bold}Reset Orion's permissions${off}"
print "  ${dim}Revokes only Orion's own grants, so macOS asks again cleanly.${off}"
print "  ${dim}Nothing else on this Mac is touched.${off}"
print ""

print "Quitting Orion…"
pkill -x Orion 2>/dev/null
sleep 1

for svc in Accessibility Microphone SpeechRecognition ListenEvent; do
  if tccutil reset "$svc" "$bundle" >/dev/null 2>&1; then
    print "  ${grn}reset${off}  $svc"
  else
    print "  ${dim}n/a  ${off}  $svc  ${dim}(nothing recorded, or not resettable)${off}"
  fi
done

print ""
print "Relaunching Orion…"
open /Applications/Orion.app 2>/dev/null || open "$(dirname "$0")/ORION/native/Orion/.build/Orion.app"
sleep 3

cat <<'NEXT'

────────────────────────────────────────────────────────────
  NOW DO THIS

  1. Press and HOLD the Right Option key for a second or two.

  2. macOS should show a permission prompt. Approve it.
     You may get up to three, one after another:
        Accessibility        (may send you to System Settings)
        Microphone
        Speech Recognition

  3. If Accessibility sends you to System Settings, find Orion
     in the list and switch it ON, then come back and hold
     Right Option again.

  4. Speak. The hologram should react while you talk.

  Because Orion is now properly code-signed, this is a one-time
  thing — rebuilds will not undo it.
────────────────────────────────────────────────────────────

NEXT

print "Press return to close."
read -r _
