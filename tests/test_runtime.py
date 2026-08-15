import sqlite3
import tempfile
import threading
import time
import unittest
import json
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen

from orion.memory import MemoryManager
from orion.computer import ComputerTools
from orion.runtime import OrionRuntime
from orion.store import Store
from orion.tasks import TaskManager
from orion.registry import RegisteredTool, ToolRegistry
from orion.server import OrionHandler, OrionServer
from orion.timers import TimerManager
from orion.planner import LocalPlanner
from orion.planner import ActionPlan, PlannedAction
from orion.executor import PlanExecutor
from orion.scheduler import Scheduler
from orion.cloud import CloudRouter


class FakeProvider:
    def __init__(self, *_args, **_kwargs):
        self.calls = []

    def chat(self, messages, tools):
        self.calls.append(messages)
        if len(self.calls) == 1:
            return {
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{"function": {"name": "get_current_time", "arguments": {"timezone": "America/New_York"}}}],
                }
            }
        return {"message": {"role": "assistant", "content": "It is currently 10:00 AM EDT."}}


class RuntimeTests(unittest.TestCase):
    def test_server_close_stops_its_scheduler_before_the_store_closes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            server = OrionServer(
                ("127.0.0.1", 0),
                root / "data" / "orion.db",
                "gpt-oss:20b",
                root / "Desktop",
            )
            self.assertTrue(server.scheduler._thread.is_alive())
            server.server_close()
            self.assertFalse(server.scheduler._thread.is_alive())
            server.runtime.store.close()

    def test_router_picks_cheapest_workable_tier_and_respects_budget(self):
        disabled = CloudRouter(False, "fast-model", "deep-model", budget_usd=15)
        self.assertEqual(disabled.decide("Analyze this").tier, "local")

        router = CloudRouter(True, "fast-model", "deep-model", budget_usd=15)
        self.assertEqual(router.decide("what's up").tier, "fast")
        self.assertEqual(router.decide("Please analyze this in detail").tier, "deep")
        self.assertEqual(router.decide("hi", local_failed=True).tier, "fast")

        # A spent budget must force everything back to local rather than overspend.
        self.assertEqual(router.decide("Please analyze this", spent_this_month=15.01).tier, "local")

    def test_cost_estimate_uses_published_token_pricing(self):
        from orion.cloud import estimate_cost

        # Haiku 4.5 is $1/M in, $5/M out.
        cost = estimate_cost("claude-haiku-4-5-20251001", {"input_tokens": 1_000_000, "output_tokens": 1_000_000})
        self.assertAlmostEqual(cost, 6.0)
        self.assertAlmostEqual(estimate_cost("claude-haiku-4-5-20251001", {"input_tokens": 1000, "output_tokens": 500}), 0.0035)

    def test_restart_marks_inflight_task_and_scheduler_runs_persisted_job(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "orion.db")
            task_id = store.create_task("Interrupted task")
            store.update_task(task_id, "running")
            self.assertEqual(store.recover_interrupted_tasks(), 1)
            self.assertEqual(store.recent_tasks()[0]["state"], "failed")

            delivered = []
            job_id = store.create_job("notification", {"body": "Tea is ready"}, Store.now())
            scheduler = Scheduler(store, lambda kind, payload: delivered.append((kind, payload)), poll_seconds=0.01)
            scheduler.start()
            deadline = time.time() + 1
            while not delivered and time.time() < deadline:
                time.sleep(0.01)
            scheduler.stop()
            self.assertEqual(delivered, [("notification", {"body": "Tea is ready"})])
            self.assertEqual(store.connection.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()[0], "completed")
            future_job = store.create_job("notification", {"body": "Skip"}, "2099-01-01T00:00:00+00:00")
            self.assertTrue(store.cancel_job(future_job))
            self.assertFalse(store.cancel_job(future_job))
            store.close()

    def test_executor_keeps_low_risk_actions_automatic_and_gates_risk(self):
        plan = ActionPlan("Organize files", [
            PlannedAction("create_folder", {"workspace": "desktop", "path": "vaedyn"}),
            PlannedAction("move_path", {"workspace": "desktop", "source": "inbox/a.txt", "destination": "vaedyn/a.txt"}),
            PlannedAction("write_file", {"workspace": "desktop", "path": "new.txt", "content": "new"}),
            PlannedAction("write_file", {"workspace": "desktop", "path": "existing.txt", "content": "changed"}),
            PlannedAction("delete_path", {"workspace": "desktop", "path": "old.txt"}),
        ])
        result = PlanExecutor(lambda _workspace, path: path == "existing.txt").classify(plan)
        self.assertEqual([item["kind"] for item in result.automatic_actions], ["mkdir", "move", "write"])
        self.assertEqual([item["kind"] for item in result.approval_actions], ["write", "delete"])

    def test_structured_planner_returns_a_nested_folder_plan(self):
        class PlannerProvider:
            def chat(self, _messages, _tools):
                return {"message": {"tool_calls": [{"function": {"name": "submit_action_plan", "arguments": {
                    "summary": "Create project folder structure",
                    "actions": [
                        {"kind": "create_folder", "workspace": "desktop", "path": "vaedyn"},
                        {"kind": "create_folder", "workspace": "desktop", "path": "vaedyn/aaron"},
                        {"kind": "create_folder", "workspace": "desktop", "path": "vaedyn/vaedyn"},
                    ],
                }}}]}}

        plan = LocalPlanner(PlannerProvider()).plan("Create vaedyn with aaron and vaedyn inside it")
        self.assertEqual([action.arguments["path"] for action in plan.actions], ["vaedyn", "vaedyn/aaron", "vaedyn/vaedyn"])
    def test_store_can_be_used_by_a_server_worker_thread(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "orion.db")
            result = []

            def create_conversation() -> None:
                result.append(store.new_conversation())

            worker = threading.Thread(target=create_conversation)
            worker.start()
            worker.join()
            self.assertEqual(result, [1])

    def test_grounded_time_answer_and_audit_are_persisted(self):
        with tempfile.TemporaryDirectory() as directory, patch("orion.runtime.OllamaProvider", FakeProvider):
            database = Path(directory) / "orion.db"
            runtime = OrionRuntime(database)
            conversation_id, answer = runtime.respond("What time is it in New York?")

            self.assertEqual(conversation_id, 1)
            self.assertIn("It’s currently", answer)
            self.assertIn("in New York.", answer)
            connection = sqlite3.connect(database)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 2)
            tool_name, level = connection.execute(
                "SELECT tool_name, permission_level FROM tool_executions"
            ).fetchone()
            self.assertEqual(tool_name, "get_current_time")
            self.assertEqual(level, 0)
            connection.close()
            runtime.store.close()

    def test_runtime_retrieves_relevant_local_memory(self):
        with tempfile.TemporaryDirectory() as directory, patch("orion.runtime.OllamaProvider", FakeProvider):
            runtime = OrionRuntime(Path(directory) / "orion.db")
            runtime.memory.remember("preference", "Keep Orion replies concise.")
            runtime.respond("Can you keep this concise?")
            prompt = runtime.provider.calls[0][0]["content"]
            self.assertIn("Relevant saved memory", prompt)
            self.assertIn("Keep Orion replies concise.", prompt)
            runtime.store.close()

    def test_conversation_history_is_replayed_to_the_model(self):
        """Regression guard: Orion used to answer every turn with no memory of the last one."""
        with tempfile.TemporaryDirectory() as directory, patch("orion.runtime.OllamaProvider", FakeProvider):
            runtime = OrionRuntime(Path(directory) / "orion.db")
            conversation_id, _ = runtime.respond("My rabbit is named Clover.")
            runtime.provider.calls.clear()
            runtime.respond("What is my rabbit's name?", conversation_id)

            replayed = " ".join(str(m.get("content", "")) for m in runtime.provider.calls[0])
            self.assertIn("Clover", replayed)
            runtime.store.close()

    def test_agent_loop_chains_tools_and_stops_at_the_iteration_limit(self):
        """The old runtime did exactly one tool round trip; search-then-read needs several."""

        class ChainProvider:
            model = "fake"

            def __init__(self, *_args, **_kwargs):
                self.rounds = 0

            def chat(self, _messages, _tools):
                self.rounds += 1
                if self.rounds <= 2:
                    name = "web_search" if self.rounds == 1 else "fetch_url"
                    args = {"query": "x"} if self.rounds == 1 else {"url": "http://example.com"}
                    return {"message": {"role": "assistant", "content": "",
                                        "tool_calls": [{"id": f"t{self.rounds}", "function": {"name": name, "arguments": args}}]}}
                return {"message": {"role": "assistant", "content": "Chained answer."}}

        with tempfile.TemporaryDirectory() as directory, patch("orion.runtime.OllamaProvider", ChainProvider):
            runtime = OrionRuntime(Path(directory) / "orion.db")
            _, answer = runtime.respond("Look something up for me please")
            self.assertEqual(answer, "Chained answer.")
            self.assertEqual(runtime.provider.rounds, 3)
            runtime.store.close()

    def test_registry_exposes_only_read_only_tools_to_the_model(self):
        from orion.tools import build_registry

        registry = build_registry(brave_api_key=None)
        names = {schema["function"]["name"] for schema in registry.schemas(max_permission_level=0)}
        self.assertEqual(names, {"get_current_time", "web_search", "fetch_url"})
        for schema in registry.schemas():
            self.assertTrue(schema["function"]["description"], "every tool needs a description the model can act on")

    def test_web_search_degrades_honestly_without_a_key(self):
        from orion.web import web_search

        result = web_search("who won last night", api_key=None)
        self.assertEqual(result["error"], "web_search_unavailable")
        self.assertIn("do not answer", result["guidance"].lower())

    def test_fetch_url_refuses_non_web_and_loopback_targets(self):
        from orion.web import fetch_url

        self.assertIn("error", fetch_url("file:///etc/passwd"))
        self.assertIn("error", fetch_url("http://127.0.0.1:8765/health"))

    def test_html_is_reduced_to_readable_text(self):
        from orion.web import _TextExtractor

        parser = _TextExtractor()
        parser.feed("<html><head><title>Hi</title></head><body><script>evil()</script><p>Real text.</p></body></html>")
        self.assertEqual(parser.title, "Hi")
        self.assertIn("Real text.", parser.text())
        self.assertNotIn("evil", parser.text())

    def test_time_question_is_grounded_without_model_guessing(self):
        with tempfile.TemporaryDirectory() as directory, patch("orion.runtime.OllamaProvider") as provider:
            database = Path(directory) / "orion.db"
            runtime = OrionRuntime(database)
            _, answer = runtime.respond("What time is it?")

            self.assertIn("It’s currently", answer)
            self.assertNotIn("in New York.", answer)
            provider.return_value.chat.assert_not_called()
            connection = sqlite3.connect(database)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM tool_executions").fetchone()[0], 1)
            connection.close()
            runtime.store.close()

    def test_task_approval_and_memory_are_persistent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / "orion.db")
            tasks = TaskManager(store)
            task = tasks.create("Organize the test folder")
            state = tasks.transition(task, task.state, "planning")
            state = tasks.transition(task, state, "waiting_for_approval")
            approval_id = tasks.request_approval(task, "Move two files", {"count": 2})
            store.decide_approval(approval_id, True)
            self.assertEqual(tasks.transition(task, state, "running"), "running")

            memory = MemoryManager(store, root / "vault")
            memory.remember("preference", "Keep Orion replies concise.")
            self.assertEqual(memory.search("concise")[0]["category"], "preference")
            self.assertIn("Keep Orion replies concise.", (root / "vault" / "ORION.md").read_text())

            native_task = tasks.create("Create reminder")
            native_state = tasks.transition(native_task, native_task.state, "planning")
            native_state = tasks.transition(native_task, native_state, "waiting_for_approval")
            native_approval = tasks.request_approval(native_task, "Create reminder", {"title": "Tea"})
            native_action = store.create_native_action(native_task.id, native_approval, "create_reminder", {"title": "Tea"})
            self.assertEqual(store.native_action(native_action)["status"], "pending")
            store.finish_native_action(native_action, result={"status": "created"})
            self.assertEqual(store.connection.execute("SELECT status FROM native_actions WHERE id=?", (native_action,)).fetchone()[0], "completed")

    def test_computer_changes_are_scoped_approved_and_reversible(self):
        with tempfile.TemporaryDirectory() as directory:
            computer = ComputerTools(Path(directory) / "sandbox")
            proposal = computer.propose("Create a note", [{"kind": "create", "path": "notes/todo.txt", "content": "Buy groceries"}])
            self.assertIn("create notes/todo.txt", proposal["preview"][0])
            self.assertEqual(computer.list_files(), [])
            computer.execute(proposal["id"])
            self.assertEqual(computer.read_file("notes/todo.txt"), "Buy groceries")
            computer.rollback(proposal["id"])
            self.assertEqual(computer.list_files(), ["notes"])
            with self.assertRaises(ValueError):
                computer.read_file("../../Desktop/private.txt")
            terminal_proposal = computer.propose_terminal_change(["touch", "notes/terminal-note.txt"])
            computer.execute(terminal_proposal["id"])
            self.assertEqual(computer.read_file("notes/terminal-note.txt"), "")
            with self.assertRaises(ValueError):
                computer.propose_terminal_change(["rm", "notes/todo.txt"])

            organization = computer.propose_organization([{"source": "notes/terminal-note.txt", "destination": "archive/terminal-note.txt"}])
            self.assertIn("move notes/terminal-note.txt", organization["preview"][0])
            computer.execute(organization["id"])
            self.assertEqual(computer.read_file("archive/terminal-note.txt"), "")
            computer.rollback(organization["id"])
            self.assertEqual(computer.read_file("notes/terminal-note.txt"), "")
            self.assertIn("sandbox", computer.run_readonly(["pwd"]))
            with self.assertRaises(ValueError):
                computer.run_readonly(["rm", "notes/todo.txt"])

    def test_tool_registry_rejects_duplicate_registrations(self):
        registry = ToolRegistry()
        tool = RegisteredTool("safe_tool", lambda: {"ok": True}, permission_level=0, timeout_seconds=1)
        registry.register(tool)
        with self.assertRaises(ValueError):
            registry.register(tool)

    def test_computer_api_requires_a_proposal_then_executes_after_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            server = OrionServer(("127.0.0.1", 0), root / "data" / "orion.db", "gpt-oss:20b", root / "Desktop")

            def post(path: str, payload: dict) -> dict:
                worker = threading.Thread(target=server.handle_request)
                worker.start()
                request = Request(
                    f"http://127.0.0.1:{server.server_port}{path}", data=json.dumps(payload).encode(),
                    headers={"Content-Type": "application/json"}, method="POST",
                )
                result = json.load(urlopen(request, timeout=3))
                worker.join()
                return result

            def get(path: str) -> dict:
                worker = threading.Thread(target=server.handle_request)
                worker.start()
                result = json.load(urlopen(f"http://127.0.0.1:{server.server_port}{path}", timeout=3))
                worker.join()
                return result

            post("/memory", {"category": "preference", "content": "Keep answers short."})
            self.assertEqual(get("/memory?query=short")["memories"][0]["content"], "Keep answers short.")

            created = post("/computer/proposals", {"summary": "Create a test note", "actions": [{"kind": "create", "path": "note.txt", "content": "safe"}]})
            self.assertEqual(created["proposal"]["status"], "pending")
            proposal_id = created["proposal"]["id"]
            self.assertFalse((root / "data" / "computer_sandbox" / "note.txt").exists())
            completed = post(f"/computer/proposals/{proposal_id}/approve", {})
            self.assertEqual(completed["proposal"]["status"], "executed")
            self.assertEqual((root / "data" / "computer_sandbox" / "note.txt").read_text(), "safe")
            self.assertIn("note.txt", get("/computer/files")["files"])
            self.assertEqual(get("/computer/read?path=note.txt")["content"], "safe")
            self.assertEqual(get("/tasks")["tasks"][0]["state"], "completed")
            connection = sqlite3.connect(root / "data" / "orion.db")
            self.assertEqual(connection.execute("SELECT status FROM approval_requests").fetchone()[0], "approved")
            self.assertGreaterEqual(connection.execute("SELECT COUNT(*) FROM task_events").fetchone()[0], 4)
            connection.close()

            native = post("/native/proposals", {"action": "create_reminder", "payload": {"title": "Tea"}})
            self.assertEqual(native["proposal"]["status"], "pending")
            self.assertEqual(server.runtime.store.native_action(native["proposal"]["id"])["action"], "create_reminder")
            server.server_close()
            server.runtime.store.close()

    def test_desktop_folder_chat_request_becomes_an_approval_proposal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            server = OrionServer(("127.0.0.1", 0), root / "data" / "orion.db", "gpt-oss:20b", root / "Desktop")

            worker = threading.Thread(target=server.handle_request)
            worker.start()
            request = Request(
                f"http://127.0.0.1:{server.server_port}/chat",
                data=json.dumps({"message": "Add a new folder on my desktop called J lo"}).encode(),
                headers={"Content-Type": "application/json"}, method="POST",
            )
            result = json.load(urlopen(request, timeout=3))
            worker.join()

            self.assertEqual(result["proposal"]["workspace"], "desktop")
            self.assertEqual(result["proposal"]["status"], "executed")
            self.assertTrue((root / "Desktop" / "J lo").exists())
            server.server_close()
            server.runtime.store.close()

    def test_multiple_desktop_folders_are_created_from_chat(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            server = OrionServer(("127.0.0.1", 0), root / "data" / "orion.db", "gpt-oss:20b", root / "Desktop")
            worker = threading.Thread(target=server.handle_request)
            worker.start()
            request = Request(
                f"http://127.0.0.1:{server.server_port}/chat",
                data=json.dumps({"message": "Create folders vaedyn Kirill and aaron"}).encode(),
                headers={"Content-Type": "application/json"}, method="POST",
            )
            result = json.load(urlopen(request, timeout=3))
            worker.join()

            self.assertEqual(result["proposal"]["status"], "executed")
            self.assertTrue(all((root / "Desktop" / name).is_dir() for name in ("vaedyn", "Kirill", "aaron")))
            server.server_close()
            server.runtime.store.close()

    def test_parent_and_child_folder_request_creates_a_nested_structure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            server = OrionServer(("127.0.0.1", 0), root / "data" / "orion.db", "gpt-oss:20b", root / "Desktop")
            worker = threading.Thread(target=server.handle_request)
            worker.start()
            request = Request(
                f"http://127.0.0.1:{server.server_port}/chat",
                data=json.dumps({"message": 'On my desktop, make a parent folder called vaedyn, and then child folders inside of it named "aaron" and "vaedyn"'}).encode(),
                headers={"Content-Type": "application/json"}, method="POST",
            )
            result = json.load(urlopen(request, timeout=3))
            worker.join()
            self.assertEqual(result["proposal"]["status"], "executed")
            self.assertTrue((root / "Desktop" / "vaedyn" / "aaron").is_dir())
            self.assertTrue((root / "Desktop" / "vaedyn" / "vaedyn").is_dir())
            server.server_close()
            server.runtime.store.close()

    def test_incomplete_folder_request_does_not_fall_back_to_false_no_access_answer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            server = OrionServer(("127.0.0.1", 0), root / "data" / "orion.db", "gpt-oss:20b", root / "Desktop")
            worker = threading.Thread(target=server.handle_request)
            worker.start()
            request = Request(
                f"http://127.0.0.1:{server.server_port}/chat",
                data=json.dumps({"message": "Can you create some folders?"}).encode(),
                headers={"Content-Type": "application/json"}, method="POST",
            )
            result = json.load(urlopen(request, timeout=3))
            worker.join()
            # It must ask what to name them, not claim it lacks access.
            self.assertIn("what should I name", result["answer"])
            self.assertNotIn("cannot", result["answer"].lower())
            server.server_close()
            server.runtime.store.close()

    def test_a_question_mentioning_folders_still_reaches_the_model(self):
        """The old handler swallowed every message containing the word 'folder'."""
        self.assertFalse(OrionHandler._looks_like_local_action("what folder should I use for tax documents?"))
        self.assertFalse(OrionHandler._looks_like_local_action("write me an essay about the civil war"))
        self.assertTrue(OrionHandler._looks_like_local_action("create a folder called taxes"))

    def test_timer_is_persistent_and_can_be_cancelled(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "orion.db")
            notifications = []
            timers = TimerManager(store, notify=notifications.append)
            timer = timers.create(60, "Tea")
            self.assertEqual(store.active_timers()[0]["label"], "Tea")
            self.assertTrue(timers.cancel(timer["id"]))
            self.assertEqual(store.recent_timers()[0]["status"], "cancelled")
            self.assertEqual(notifications, [])
            store.close()


if __name__ == "__main__":
    unittest.main()
