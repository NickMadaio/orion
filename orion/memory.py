from __future__ import annotations

from pathlib import Path
import re

from .store import Store


ALLOWED_CATEGORIES = {"preference", "person", "project", "decision", "goal", "temporary", "outcome"}


class MemoryManager:
    """Local, attributed memory with a human-readable Markdown mirror."""

    def __init__(self, store: Store, vault_path: Path) -> None:
        self.store = store
        self.vault_path = vault_path
        self.vault_path.mkdir(parents=True, exist_ok=True)
        self.root_document = self.vault_path / "ORION.md"
        if not self.root_document.exists():
            self.root_document.write_text("# Orion memory vault\n\nLocal, user-approved memories.\n")

    def remember(self, category: str, content: str, source: str = "user", confidence: float = 1.0, relevance: float = 1.0) -> int:
        if category not in ALLOWED_CATEGORIES:
            raise ValueError(f"Unknown memory category: {category}")
        if not content.strip():
            raise ValueError("Memory content must not be empty")
        memory_id = self.store.add_memory(category, content.strip(), source, confidence, relevance)
        with self.root_document.open("a") as vault:
            vault.write(f"\n- [{category}] {content.strip()} (source: {source})\n")
        return memory_id

    def search(self, query: str) -> list[dict]:
        return self.store.search_memories(query)

    def relevant(self, query: str, limit: int = 6) -> list[dict]:
        """Retrieve small, grounded context without sending an entire private vault to the model."""
        terms = [term for term in re.findall(r"[a-zA-Z0-9']+", query.lower()) if len(term) >= 4]
        found: dict[int, dict] = {}
        for term in terms:
            for memory in self.store.search_memories(term, limit=limit):
                found[memory["id"]] = memory
        return sorted(found.values(), key=lambda item: (item["relevance"], item["updated_at"]), reverse=True)[:limit]
