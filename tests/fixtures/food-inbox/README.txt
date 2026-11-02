Food inbox fixture (scripts/lib/food/inbox.mjs has the full contract).
The phone drops <id>.jpg first, then <id>.json ({ id, at, note }) last; the .json is the "complete" signal.
The watcher writes <id>.estimate.json and .state.json beside them, and offers the estimate in chat.
