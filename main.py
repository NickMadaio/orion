from __future__ import annotations

import argparse
from pathlib import Path

from orion.runtime import OrionRuntime
from orion.server import serve


def main() -> None:
    parser = argparse.ArgumentParser(description="Orion Phase One local runtime")
    parser.add_argument("message", nargs="*", help="Message for Orion, or 'serve' to start the runtime")
    parser.add_argument("--model", default="gpt-oss:20b")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.message == ["serve"]:
        serve(Path("data/orion.db"), model=args.model, port=args.port)
        return
    message = " ".join(args.message).strip() or input("You: ").strip()
    if not message:
        raise SystemExit("Please enter a message.")
    runtime = OrionRuntime(Path("data/orion.db"), model=args.model)
    conversation_id, answer = runtime.respond(message)
    print(f"\nOrion: {answer}\nConversation: {conversation_id}")


if __name__ == "__main__":
    main()
