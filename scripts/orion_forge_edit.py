#!/usr/bin/env python3
"""Stage a targeted edit to one of Orion's own Swift sources.

Called by `orion-forge edit`. Kept out of the shell script because the matching
rule below deserves to be read on its own.

THE MATCH MUST BE UNIQUE. A find string that appears twice is ambiguous about
which occurrence was meant, and picking one is how an edit silently lands in the
wrong place — in a file the app is about to be rebuilt from. Ambiguity is
refused rather than resolved.

Exit codes: 0 staged, 1 refused.
"""

import sys


def main() -> int:
    if len(sys.argv) != 5:
        sys.stderr.write("usage: orion_forge_edit.py <target> <find> <replace> <staged>\n")
        return 1

    target, find_path, replace_path, staged = sys.argv[1:5]

    try:
        source = open(target, encoding="utf-8").read()
        # Trailing newlines here are an artefact of writing the strings out to
        # files, not part of what the caller meant to match.
        needle = open(find_path, encoding="utf-8").read().rstrip("\n")
        replacement = open(replace_path, encoding="utf-8").read().rstrip("\n")
    except OSError as error:
        sys.stderr.write(f"refused: {error}\n")
        return 1

    if not needle:
        sys.stderr.write("refused: the find text is empty\n")
        return 1

    count = source.count(needle)
    if count == 0:
        sys.stderr.write(
            "refused: the find text does not appear in the file. "
            "Read the file first and quote it exactly, whitespace included.\n"
        )
        return 1
    if count > 1:
        sys.stderr.write(
            f"refused: the find text appears {count} times and must be unique. "
            "Include a surrounding line or two to disambiguate.\n"
        )
        return 1

    try:
        with open(staged, "w", encoding="utf-8") as handle:
            handle.write(source.replace(needle, replacement, 1))
    except OSError as error:
        sys.stderr.write(f"refused: {error}\n")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
