# ORION

Phase One local-first conversational core.

## What works

- Local GPT-OSS 20B through Ollama
- One safe, read-only current-time tool
- SQLite conversation and tool-execution records
- Complete model → tool → result → model loop
- Persistent local HTTP runtime for the desktop interface
- A lightweight local chat screen at the runtime address

## Run

1. Open Ollama and make sure `gpt-oss:20b` is available.
2. Start the persistent runtime:

   ```bash
   uv run python main.py serve
   ```

   Then open `http://127.0.0.1:8765` in a browser to use Orion’s local chat screen. It keeps the active conversation together while it is open.

3. Or, test one message directly:

   ```bash
   uv run python main.py "What time is it in New York?"
   ```

The local database is created at `data/orion.db`.
