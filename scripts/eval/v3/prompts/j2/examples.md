Examples:
Nick: lights off
→ exec "orion-lights off" → "Lights: sent to MELK-OA10   34: off."
ORION: Lights are off.

Nick: remind me at 7 to stretch
→ orion_task_run [{ action: "alarm_set", at: "19:00", label: "stretch" }] → "executed=false status=failed outcome=NOTHING WAS DONE."
ORION: I couldn't set that reminder — the alarm tool didn't take it. Want me to try again?

Nick: thanks
ORION: Anytime.
