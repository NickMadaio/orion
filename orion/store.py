from __future__ import annotations

import json
import sqlite3
from threading import RLock
from datetime import datetime, timezone
from pathlib import Path


class Store:
    def __init__(self, path: Path) -> None:
        # The local HTTP server handles browser requests on worker threads.
        # SQLite still receives one operation at a time through this lock.
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self._lock = RLock()
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id)
            );
            CREATE TABLE IF NOT EXISTS tool_executions (
                id INTEGER PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                tool_name TEXT NOT NULL,
                arguments_json TEXT NOT NULL,
                permission_level INTEGER NOT NULL,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id)
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                state TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                result_json TEXT,
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS task_events (
                id INTEGER PRIMARY KEY,
                task_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                detail_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id)
            );
            CREATE TABLE IF NOT EXISTS approval_requests (
                id INTEGER PRIMARY KEY,
                task_id INTEGER NOT NULL,
                summary TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                decided_at TEXT,
                FOREIGN KEY(task_id) REFERENCES tasks(id)
            );
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY,
                category TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL NOT NULL,
                relevance REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS timers (
                id INTEGER PRIMARY KEY,
                label TEXT NOT NULL,
                due_at TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                fired_at TEXT
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                run_at TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS provider_executions (
                id INTEGER PRIMARY KEY,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                reason TEXT NOT NULL,
                usage_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS native_actions (
                id INTEGER PRIMARY KEY,
                task_id INTEGER NOT NULL,
                approval_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                decided_at TEXT,
                result_json TEXT,
                error TEXT,
                FOREIGN KEY(task_id) REFERENCES tasks(id),
                FOREIGN KEY(approval_id) REFERENCES approval_requests(id)
            );
            """
        )
        self.connection.commit()

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    def new_conversation(self) -> int:
        with self._lock:
            cursor = self.connection.execute("INSERT INTO conversations(created_at) VALUES (?)", (self.now(),))
            self.connection.commit()
            return int(cursor.lastrowid)

    def add_message(self, conversation_id: int, role: str, content: str) -> None:
        with self._lock:
            self.connection.execute(
                "INSERT INTO messages(conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (conversation_id, role, content, self.now()),
            )
            self.connection.commit()

    def audit_tool(self, conversation_id: int, name: str, arguments: dict, result: dict) -> None:
        with self._lock:
            self.connection.execute(
                """INSERT INTO tool_executions(conversation_id, tool_name, arguments_json,
                   permission_level, result_json, created_at) VALUES (?, ?, ?, 0, ?, ?)""",
                (conversation_id, name, json.dumps(arguments), json.dumps(result), self.now()),
            )
            self.connection.commit()

    def create_task(self, title: str) -> int:
        with self._lock:
            now = self.now()
            cursor = self.connection.execute(
                "INSERT INTO tasks(title, state, created_at, updated_at) VALUES (?, 'created', ?, ?)",
                (title, now, now),
            )
            task_id = int(cursor.lastrowid)
            self.add_task_event(task_id, "created", {"title": title})
            return task_id

    def update_task(self, task_id: int, state: str, result: dict | None = None, error: str | None = None) -> None:
        with self._lock:
            self.connection.execute(
                "UPDATE tasks SET state=?, updated_at=?, result_json=?, error=? WHERE id=?",
                (state, self.now(), json.dumps(result) if result is not None else None, error, task_id),
            )
            self.connection.commit()

    def add_task_event(self, task_id: int, kind: str, detail: dict) -> None:
        with self._lock:
            self.connection.execute(
                "INSERT INTO task_events(task_id, kind, detail_json, created_at) VALUES (?, ?, ?, ?)",
                (task_id, kind, json.dumps(detail), self.now()),
            )
            self.connection.commit()

    def request_approval(self, task_id: int, summary: str, payload: dict) -> int:
        with self._lock:
            cursor = self.connection.execute(
                "INSERT INTO approval_requests(task_id, summary, payload_json, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
                (task_id, summary, json.dumps(payload), self.now()),
            )
            self.connection.commit()
            return int(cursor.lastrowid)

    def decide_approval(self, approval_id: int, approved: bool) -> None:
        with self._lock:
            self.connection.execute(
                "UPDATE approval_requests SET status=?, decided_at=? WHERE id=? AND status='pending'",
                ("approved" if approved else "rejected", self.now(), approval_id),
            )
            self.connection.commit()

    def add_memory(self, category: str, content: str, source: str, confidence: float, relevance: float) -> int:
        with self._lock:
            now = self.now()
            cursor = self.connection.execute(
                """INSERT INTO memories(category, content, source, confidence, relevance, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (category, content, source, confidence, relevance, now, now),
            )
            self.connection.commit()
            return int(cursor.lastrowid)

    def search_memories(self, query: str, limit: int = 8) -> list[dict]:
        with self._lock:
            rows = self.connection.execute(
                """SELECT id, category, content, source, confidence, relevance, updated_at FROM memories
                   WHERE content LIKE ? ORDER BY relevance DESC, updated_at DESC LIMIT ?""",
                (f"%{query}%", limit),
            ).fetchall()
            return [dict(row) for row in rows]

    def recent_tasks(self, limit: int = 20) -> list[dict]:
        with self._lock:
            rows = self.connection.execute(
                "SELECT id, title, state, created_at, updated_at, error FROM tasks ORDER BY updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(row) for row in rows]

    def recover_interrupted_tasks(self) -> int:
        """Make a restart visible instead of silently leaving work marked as running."""
        with self._lock:
            rows = self.connection.execute("SELECT id, state FROM tasks WHERE state IN ('planning', 'running')").fetchall()
            for row in rows:
                self.connection.execute(
                    "UPDATE tasks SET state='failed', updated_at=?, error=? WHERE id=?",
                    (self.now(), "Orion restarted before this task finished.", row["id"]),
                )
                self.connection.execute(
                    "INSERT INTO task_events(task_id, kind, detail_json, created_at) VALUES (?, ?, ?, ?)",
                    (row["id"], "interrupted_by_restart", json.dumps({"previous_state": row["state"]}), self.now()),
                )
            self.connection.commit()
            return len(rows)

    def create_timer(self, label: str, due_at: str) -> int:
        with self._lock:
            cursor = self.connection.execute(
                "INSERT INTO timers(label, due_at, status, created_at) VALUES (?, ?, 'active', ?)",
                (label, due_at, self.now()),
            )
            self.connection.commit()
            return int(cursor.lastrowid)

    def active_timers(self) -> list[dict]:
        with self._lock:
            rows = self.connection.execute(
                "SELECT id, label, due_at, status, created_at FROM timers WHERE status='active' ORDER BY due_at"
            ).fetchall()
            return [dict(row) for row in rows]

    def recent_timers(self, limit: int = 20) -> list[dict]:
        with self._lock:
            rows = self.connection.execute(
                "SELECT id, label, due_at, status, created_at, fired_at FROM timers ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(row) for row in rows]

    def finish_timer(self, timer_id: int) -> None:
        with self._lock:
            self.connection.execute(
                "UPDATE timers SET status='completed', fired_at=? WHERE id=? AND status='active'", (self.now(), timer_id)
            )
            self.connection.commit()

    def cancel_timer(self, timer_id: int) -> bool:
        with self._lock:
            cursor = self.connection.execute(
                "UPDATE timers SET status='cancelled' WHERE id=? AND status='active'", (timer_id,)
            )
            self.connection.commit()
            return cursor.rowcount == 1

    def create_job(self, kind: str, payload: dict, run_at: str) -> int:
        with self._lock:
            cursor = self.connection.execute(
                "INSERT INTO jobs(kind, payload_json, run_at, status, created_at) VALUES (?, ?, ?, 'scheduled', ?)",
                (kind, json.dumps(payload), run_at, self.now()),
            )
            self.connection.commit()
            return int(cursor.lastrowid)

    def due_jobs(self, now: str) -> list[dict]:
        with self._lock:
            rows = self.connection.execute(
                "SELECT id, kind, payload_json, run_at FROM jobs WHERE status='scheduled' AND run_at<=? ORDER BY run_at", (now,)
            ).fetchall()
            return [dict(row) for row in rows]

    def claim_job(self, job_id: int) -> bool:
        with self._lock:
            cursor = self.connection.execute("UPDATE jobs SET status='running' WHERE id=? AND status='scheduled'", (job_id,))
            self.connection.commit()
            return cursor.rowcount == 1

    def finish_job(self, job_id: int, error: str | None = None) -> None:
        with self._lock:
            self.connection.execute(
                "UPDATE jobs SET status=?, completed_at=?, error=? WHERE id=?",
                ("failed" if error else "completed", self.now(), error, job_id),
            )
            self.connection.commit()

    def recent_jobs(self, limit: int = 20) -> list[dict]:
        with self._lock:
            rows = self.connection.execute(
                "SELECT id, kind, payload_json, run_at, status, created_at, completed_at, error FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(row) for row in rows]

    def cancel_job(self, job_id: int) -> bool:
        with self._lock:
            cursor = self.connection.execute("UPDATE jobs SET status='cancelled', completed_at=? WHERE id=? AND status='scheduled'", (self.now(), job_id))
            self.connection.commit()
            return cursor.rowcount == 1

    def audit_provider(self, provider: str, model: str, reason: str, usage: dict) -> None:
        with self._lock:
            self.connection.execute(
                "INSERT INTO provider_executions(provider, model, reason, usage_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (provider, model, reason, json.dumps(usage), self.now()),
            )
            self.connection.commit()

    def create_native_action(self, task_id: int, approval_id: int, action: str, payload: dict) -> int:
        with self._lock:
            cursor = self.connection.execute(
                "INSERT INTO native_actions(task_id, approval_id, action, payload_json, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
                (task_id, approval_id, action, json.dumps(payload), self.now()),
            )
            self.connection.commit()
            return int(cursor.lastrowid)

    def native_action(self, action_id: int) -> dict:
        with self._lock:
            row = self.connection.execute(
                "SELECT id, task_id, approval_id, action, payload_json, status FROM native_actions WHERE id=?", (action_id,)
            ).fetchone()
            if not row:
                raise ValueError("That native action was not found.")
            return dict(row)

    def finish_native_action(self, action_id: int, result: dict | None = None, error: str | None = None) -> None:
        with self._lock:
            self.connection.execute(
                "UPDATE native_actions SET status=?, decided_at=?, result_json=?, error=? WHERE id=? AND status='pending'",
                ("failed" if error else "completed", self.now(), json.dumps(result) if result else None, error, action_id),
            )
            self.connection.commit()

    def close(self) -> None:
        with self._lock:
            self.connection.close()

    def __del__(self) -> None:
        try:
            self.connection.close()
        except Exception:
            pass
