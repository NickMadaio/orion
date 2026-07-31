#!/bin/zsh
# Checks whether the signing certificate is trusted yet, and what that means.
cd "$(dirname "$0")/ORION" || exit 1
chmod +x scripts/orion-* 2>/dev/null
mkdir -p data
{
valid="$(security find-identity -v -p codesigning 2>/dev/null | grep -c 'Orion Local Signing')"
all="$(security find-identity -p codesigning 2>/dev/null | grep -c 'Orion Local Signing')"
print ""
print "Orion signing certificate"
print "  certificates named 'Orion Local Signing': $all"
print "  of those, TRUSTED and usable by codesign:  $valid"
print ""
if (( valid > 0 )); then
  print "  ✅ Trusted. Now run 'Start Orion' — it will re-sign with this identity,"
  print "     and Accessibility will stop resetting on every rebuild."
else
  print "  ❌ Not trusted yet. codesign will not use an untrusted certificate,"
  print "     which is why nothing changed."
  print ""
  print "  Do this once:"
  print "    1. Keychain Access  >  login  >  My Certificates"
  print "    2. Double-click 'Orion Local Signing' (the one expiring 2027)"
  print "    3. Click the triangle next to  > Trust"
  print "    4. Set 'Code Signing' to  Always Trust"
  print "    5. Close the window; enter your login password when asked"
  print "    6. Run this again to confirm, then run 'Start Orion'"
fi
print ""
./scripts/orion-mic-doctor 2>/dev/null | sed -n '/1. Is Orion/,/^$/p'
} 2>&1 | tee data/signing.log
print ""
print "Press return to close."
read -r _
