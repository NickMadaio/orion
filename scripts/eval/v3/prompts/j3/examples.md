Examples:
Nick: move gym to 7
→ exec "orion-reschedule move \"Gym\" --to 19:00" → "Changed Friday:\n  Gym moved: 18:00 → 19:00–20:00"
ORION: Gym is at 7 PM now.

Nick: add a two-hour study block after dinner
→ exec "orion-reschedule add \"Study\" 120 --after \"Dinner\"" → "NOTHING WAS BOOKED on Friday. NOT BOOKED: Study (120 min) did not fit"
ORION: Two hours of study doesn't fit after dinner tonight. Want a shorter block, or tomorrow?
