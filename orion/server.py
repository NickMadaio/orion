from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .computer import ComputerTools
from .memory import MemoryManager
from .mac_bridge import MacBridge, MacBridgeUnavailable
from .native_clock import NativeClock, NativeClockUnavailable
from .planner import LocalPlanner, PlanError
from .executor import PlanExecutor
from .runtime import OrionRuntime
from .tasks import Task, TaskManager
from .timers import TimerManager
from .scheduler import Scheduler


class OrionServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], data_path: Path, model: str, desktop_path: Path | None = None) -> None:
        super().__init__(address, OrionHandler)
        self.runtime = OrionRuntime(data_path, model=model)
        self.runtime.store.recover_interrupted_tasks()
        self.tasks = TaskManager(self.runtime.store)
        self.memory = MemoryManager(self.runtime.store, data_path.parent.parent / "vault")
        self.timers = TimerManager(self.runtime.store)
        self.native_clock = NativeClock()
        self.mac_bridge = MacBridge(data_path.parent.parent)
        self.computer = ComputerTools(data_path.parent / "computer_sandbox")
        self.computers = {
            "sandbox": self.computer,
            "desktop": ComputerTools(desktop_path or Path.home() / "Desktop", data_path.parent / "computer_controls" / "desktop"),
        }
        self.planner = LocalPlanner(self.runtime.provider)
        self.executor = PlanExecutor(lambda workspace, path: self.computers[workspace]._path(path).exists())
        self.scheduler = Scheduler(self.runtime.store, self._run_scheduled_job)
        self.scheduler.start()

    def server_close(self) -> None:
        """Stop background users of SQLite before callers close the store.

        Tests and embedding callers historically invoked `server_close()` and
        then closed the database, while the scheduler thread kept polling it.
        The resulting exception was printed from a daemon thread but did not
        fail the suite. Make the HTTP server own the lifecycle it starts.
        """
        self.scheduler.stop()
        super().server_close()

    def _run_scheduled_job(self, kind: str, payload: dict) -> None:
        if kind == "notification":
            self.mac_bridge.request("notify", {"title": payload.get("title", "Orion"), "body": payload.get("body", "")})
            task_id = payload.get("task_id")
            if task_id:
                self.runtime.store.update_task(int(task_id), "completed", result={"notification": "delivered"})
                self.runtime.store.add_task_event(int(task_id), "notification_delivered", {})
            return
        raise ValueError(f"Unsupported scheduled job: {kind}")


class OrionHandler(BaseHTTPRequestHandler):
    server: OrionServer

    def log_message(self, _format: str, *_args: object) -> None:
        return  # Keep Orion's normal output conversational and uncluttered.

    def _json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _computer(self, scope: str) -> ComputerTools:
        if scope not in self.server.computers:
            raise ValueError("That workspace is not available.")
        return self.server.computers[scope]

    def _computer_for_proposal(self, proposal_id: str) -> ComputerTools:
        for computer in self.server.computers.values():
            try:
                computer.get_proposal(proposal_id)
                return computer
            except FileNotFoundError:
                continue
        raise ValueError("That proposal was not found.")

    def _create_proposal(self, summary: str, actions: list[dict], scope: str) -> tuple[dict, str, int]:
        computer = self._computer(scope)
        task = self.server.tasks.create(summary)
        state = self.server.tasks.transition(task, task.state, "planning")
        self.server.tasks.transition(task, state, "waiting_for_approval")
        approval_id = self.server.tasks.request_approval(task, summary, {"actions": actions, "workspace": scope})
        proposal = computer.propose(summary, actions, {"task_id": task.id, "approval_id": approval_id, "workspace": scope})
        proposal["workspace"] = scope
        return proposal, task.id, approval_id

    def _create_native_proposal(self, summary: str, action: str, payload: dict) -> dict:
        task = self.server.tasks.create(summary)
        state = self.server.tasks.transition(task, task.state, "planning")
        self.server.tasks.transition(task, state, "waiting_for_approval")
        approval_id = self.server.tasks.request_approval(task, summary, {"native_action": action, "payload": payload})
        action_id = self.server.runtime.store.create_native_action(task.id, approval_id, action, payload)
        return {"id": action_id, "summary": summary, "action": action, "payload": payload, "status": "pending"}

    def _run_low_risk_change(self, summary: str, actions: list[dict], scope: str) -> dict:
        """Run a user-requested, reversible action without a confirmation prompt."""
        computer = self._computer(scope)
        task = self.server.tasks.create(summary)
        state = self.server.tasks.transition(task, task.state, "planning")
        self.server.tasks.transition(task, state, "running", permission="automatic_low_risk")
        proposal = computer.propose(summary, actions, {"task_id": task.id, "workspace": scope, "permission": "automatic_low_risk"})
        result = computer.execute(proposal["id"])
        result["workspace"] = scope
        self.server.tasks.transition(task, "running", "completed", proposal_id=result["id"], permission="automatic_low_risk")
        return result

    # Verbs and nouns are checked separately so a verb can never satisfy both
    # halves. "Write me an essay about X" used to match on `write` twice and get
    # routed into the filesystem planner, where it failed. A local action now
    # requires an actual filesystem or timer noun.
    _ACTION_VERB = re.compile(r"\b(?:create|make|add|move|rename|edit|delete|remove|set|start|organize|clean up)\b", re.IGNORECASE)
    _ACTION_NOUN = re.compile(r"\b(?:folders?|subfolders?|files?|directory|directories|timers?|alarms?|desktop)\b", re.IGNORECASE)

    @classmethod
    def _looks_like_local_action(cls, message: str) -> bool:
        return bool(cls._ACTION_VERB.search(message)) and bool(cls._ACTION_NOUN.search(message))

    def _execute_structured_plan(self, message: str) -> tuple[str, dict | None]:
        plan = self.server.planner.plan(message)
        if plan is None:
            raise PlanError("I couldn't turn that into a safe local action yet. Please say the target and action explicitly.")
        result = self.server.executor.classify(plan)
        if result.clarification:
            return result.clarification, None
        automatic_groups: dict[str, list[dict]] = {}
        for action in result.automatic_actions:
            if action["kind"] == "native_timer":
                self.server.mac_bridge.request("set_clock_timer", {"seconds": str(action["seconds"]), "label": action["label"]})
                continue
            action = dict(action)
            action.pop("permission", None)
            workspace = action.pop("workspace")
            automatic_groups.setdefault(workspace, []).append(action)
        for workspace, actions in automatic_groups.items():
            self._run_low_risk_change(plan.summary, actions, workspace)

        approval_groups: dict[str, list[dict]] = {}
        for action in result.approval_actions:
            action = dict(action)
            action.pop("permission", None)
            workspace = action.pop("workspace")
            approval_groups.setdefault(workspace, []).append(action)
        if len(approval_groups) > 1:
            return "I need to separate that into one permitted workspace at a time before asking for approval.", None
        if approval_groups:
            workspace, actions = next(iter(approval_groups.items()))
            proposal, _, _ = self._create_proposal(plan.summary, actions, workspace)
            return "I completed the safe steps and prepared the remaining change for your approval.", proposal
        return "Done — I completed the safe local action.", None

    def _schedule_reminder(self, seconds: int, body: str) -> None:
        task = self.server.tasks.create(f"Reminder: {body}")
        state = self.server.tasks.transition(task, task.state, "planning")
        self.server.tasks.transition(task, state, "running", permission="automatic_low_risk")
        run_at = datetime.now(timezone.utc) + timedelta(seconds=seconds)
        self.server.runtime.store.create_job(
            "notification", {"title": "Orion reminder", "body": body, "task_id": task.id}, run_at.isoformat(timespec="seconds")
        )

    @staticmethod
    def _folder_names(message: str) -> list[str]:
        """Recognize direct folder requests without handing a simple action to the model."""
        match = re.search(
            r"(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?(?:sub[ -]?)?(?P<kind>folders?)\s+"
            r"(?:(?:on|in)\s+(?:my\s+)?desktop\s+)?(?:called|named)?\s*(.+?)[.!?]*$",
            message,
            re.IGNORECASE,
        )
        if not match:
            return []
        raw = match.group(2).strip().strip('"\'')
        if not raw:
            return []
        if match.group("kind").lower() == "folder":
            names = [raw]
        else:
            # A plural request such as "folders vaedyn Kirill aaron" means three names;
            # commas and "and" are supported too.
            names = [piece.strip().strip('"\'') for piece in re.split(r"\s*,\s*|\s+and\s+|\s+", raw) if piece.strip()]
        for name in names:
            if "/" in name or name in {".", ".."}:
                raise ValueError("Please use simple folder names for Desktop requests.")
        return names

    @staticmethod
    def _parent_and_children(message: str) -> tuple[str, list[str]] | None:
        match = re.search(
            r"(?:create|make|add)\s+(?:a\s+)?parent\s+folder\s+(?:called|named)\s+['\"]?(.+?)['\"]?\s*,?\s*"
            r"(?:and\s+then\s+)?(?:child\s+folders?\s+inside\s+(?:of\s+)?it|with\s+child\s+folders?)\s+(?:called|named)\s+(.+?)[.!?]*$",
            message,
            re.IGNORECASE,
        )
        if not match:
            return None
        parent = match.group(1).strip().strip('"\'')
        children = [piece.strip().strip('"\'') for piece in re.split(r"\s*,\s*|\s+and\s+", match.group(2)) if piece.strip()]
        if not parent or not children or any("/" in name or name in {".", ".."} for name in [parent, *children]):
            raise ValueError("Please use simple folder names for the Desktop request.")
        return parent, children

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if self.path == "/health":
            runtime = self.server.runtime
            self._json(HTTPStatus.OK, {
                "status": "ready",
                "provider": "ollama",
                "model": runtime.provider.model,
                "cloud_enabled": runtime.router.enabled,
                "tools": runtime.registry.names(),
                "spend_this_month_usd": round(runtime.store.spend_this_month(), 4),
                "monthly_budget_usd": runtime.router.budget_usd,
            })
            return
        if path == "/conversations":
            self._json(HTTPStatus.OK, {"conversations": self.server.runtime.store.recent_conversations()})
            return
        if path == "/conversations/messages":
            conversation_id = parse_qs(parsed.query).get("id", [""])[0]
            if not conversation_id.isdigit():
                self._json(HTTPStatus.BAD_REQUEST, {"error": "A numeric conversation id is required."})
                return
            self._json(HTTPStatus.OK, {"messages": self.server.runtime.store.conversation_messages(int(conversation_id))})
            return
        if path in {"/", "/index.html"}:
            self._static_file("index.html", "text/html; charset=utf-8")
            return
        if path == "/styles.css":
            self._static_file("styles.css", "text/css; charset=utf-8")
            return
        if path == "/app.js":
            self._static_file("app.js", "application/javascript; charset=utf-8")
            return
        if path == "/memory":
            query = parse_qs(parsed.query).get("query", [""])[0].strip()
            if not query:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "query is required"})
                return
            self._json(HTTPStatus.OK, {"memories": self.server.memory.search(query)})
            return
        if path == "/computer/files":
            relative = parse_qs(parsed.query).get("path", ["."])[0]
            scope = parse_qs(parsed.query).get("workspace", ["sandbox"])[0]
            self._json(HTTPStatus.OK, {"files": self._computer(scope).list_files(relative)})
            return
        if path == "/computer/read":
            relative = parse_qs(parsed.query).get("path", [""])[0]
            if not relative:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "path is required"})
                return
            scope = parse_qs(parsed.query).get("workspace", ["sandbox"])[0]
            self._json(HTTPStatus.OK, {"content": self._computer(scope).read_file(relative)})
            return
        if path == "/tasks":
            self._json(HTTPStatus.OK, {"tasks": self.server.runtime.store.recent_tasks()})
            return
        if path == "/jobs":
            self._json(HTTPStatus.OK, {"jobs": self.server.runtime.store.recent_jobs()})
            return
        if path == "/timers":
            try:
                native_status = self.server.mac_bridge.request("status")
                self._json(HTTPStatus.OK, {"timers": self.server.runtime.store.recent_timers(), "native": native_status})
            except (MacBridgeUnavailable, RuntimeError) as error:
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        if path == "/native/status":
            try:
                self._json(HTTPStatus.OK, {"native": self.server.mac_bridge.request("status")})
            except (MacBridgeUnavailable, RuntimeError) as error:
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        if path == "/native/calendar":
            try:
                native = self.server.mac_bridge.request("list_upcoming_calendar_events")
                self._json(HTTPStatus.OK, {"events": json.loads(native.get("events_json", "[]"))})
            except (MacBridgeUnavailable, RuntimeError) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if path == "/native/reminders":
            try:
                native = self.server.mac_bridge.request("list_incomplete_reminders")
                self._json(HTTPStatus.OK, {"reminders": json.loads(native.get("reminders_json", "[]"))})
            except (MacBridgeUnavailable, RuntimeError) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def _static_file(self, filename: str, content_type: str) -> None:
        content = (Path(__file__).parent / "ui" / filename).read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length))
            if self.path == "/memory":
                memory_id = self.server.memory.remember(
                    str(request["category"]), str(request["content"]), str(request.get("source", "user")),
                    float(request.get("confidence", 1.0)), float(request.get("relevance", 1.0)),
                )
                self._json(HTTPStatus.CREATED, {"memory_id": memory_id})
                return
            if self.path == "/tasks":
                task = self.server.tasks.create(str(request["title"]).strip())
                self._json(HTTPStatus.CREATED, {"task_id": task.id, "state": task.state})
                return
            if self.path.startswith("/jobs/") and self.path.endswith("/cancel"):
                job_id = int(self.path.split("/")[2])
                if not self.server.runtime.store.cancel_job(job_id):
                    raise ValueError("That scheduled item is no longer waiting to run.")
                self._json(HTTPStatus.OK, {"status": "cancelled"})
                return
            if self.path == "/timers":
                seconds = int(request["seconds"])
                label = str(request.get("label") or "Orion timer")
                native = self.server.mac_bridge.request("set_clock_timer", {"seconds": str(seconds), "label": label})
                self._json(HTTPStatus.CREATED, {"timer": native})
                return
            if self.path == "/native/request-permission":
                kind = str(request["kind"])
                action = {
                    "notifications": "request_notifications",
                    "accessibility": "request_accessibility",
                    "reminders": "request_reminders_access",
                    "calendar": "request_calendar_access",
                }.get(kind)
                if not action:
                    raise ValueError("That native permission is not available.")
                self._json(HTTPStatus.OK, {"native": self.server.mac_bridge.request(action)})
                return
            if self.path == "/native/proposals":
                action = str(request["action"])
                payload = {str(key): str(value) for key, value in dict(request.get("payload", {})).items() if value is not None}
                if action not in {"create_reminder", "create_calendar_event"}:
                    raise ValueError("That native change is not supported.")
                summary = "Create Reminder" if action == "create_reminder" else "Create Calendar event"
                self._json(HTTPStatus.CREATED, {"proposal": self._create_native_proposal(summary, action, payload)})
                return
            if self.path.startswith("/native/proposals/") and self.path.endswith("/approve"):
                action_id = int(self.path.split("/")[3])
                pending = self.server.runtime.store.native_action(action_id)
                if pending["status"] != "pending":
                    raise ValueError("That native action is no longer awaiting approval.")
                payload = json.loads(pending["payload_json"])
                task = Task(int(pending["task_id"]), "Native action")
                self.server.runtime.store.decide_approval(int(pending["approval_id"]), True)
                self.server.tasks.transition(task, "waiting_for_approval", "running")
                try:
                    result = self.server.mac_bridge.request(pending["action"], payload)
                except Exception as error:
                    self.server.runtime.store.finish_native_action(action_id, error=str(error))
                    self.server.runtime.store.update_task(task.id, "failed", error=str(error))
                    self.server.runtime.store.add_task_event(task.id, "native_action_failed", {"action": pending["action"]})
                    raise
                self.server.runtime.store.finish_native_action(action_id, result=result)
                self.server.tasks.transition(task, "running", "completed", native_action=action_id)
                self._json(HTTPStatus.OK, {"proposal": {"id": action_id, "status": "completed", "result": result}})
                return
            if self.path.startswith("/timers/") and self.path.endswith("/cancel"):
                timer_id = int(self.path.split("/")[2])
                if not self.server.timers.cancel(timer_id):
                    raise ValueError("That timer is no longer active.")
                self._json(HTTPStatus.OK, {"status": "cancelled"})
                return
            if self.path == "/computer/proposals":
                proposal, task_id, approval_id = self._create_proposal(
                    str(request["summary"]), list(request["actions"]), str(request.get("workspace", "sandbox"))
                )
                self._json(HTTPStatus.CREATED, {"proposal": proposal, "task_id": task_id, "approval_id": approval_id})
                return
            if self.path.startswith("/computer/proposals/") and self.path.endswith("/approve"):
                proposal_id = self.path.split("/")[3]
                computer = self._computer_for_proposal(proposal_id)
                pending = computer.get_proposal(proposal_id)
                metadata = pending["metadata"]
                task = Task(metadata["task_id"], pending["summary"])
                self.server.runtime.store.decide_approval(metadata["approval_id"], True)
                self.server.tasks.transition(task, "waiting_for_approval", "running")
                proposal = computer.execute(proposal_id)
                self.server.tasks.transition(task, "running", "completed", proposal_id=proposal_id)
                self._json(HTTPStatus.OK, {"proposal": proposal})
                return
            if self.path.startswith("/computer/proposals/") and self.path.endswith("/rollback"):
                proposal_id = self.path.split("/")[3]
                computer = self._computer_for_proposal(proposal_id)
                proposal = computer.get_proposal(proposal_id)
                computer.rollback(proposal_id)
                task_id = proposal.get("metadata", {}).get("task_id")
                if task_id:
                    self.server.runtime.store.add_task_event(task_id, "rolled_back", {"proposal_id": proposal_id})
                self._json(HTTPStatus.OK, {"status": "rolled_back"})
                return
            if self.path == "/computer/readonly-terminal":
                computer = self._computer(str(request.get("workspace", "sandbox")))
                self._json(HTTPStatus.OK, {"output": computer.run_readonly(list(request["command"]))})
                return
            if self.path == "/computer/terminal-proposals":
                computer = self._computer(str(request.get("workspace", "sandbox")))
                proposal = computer.propose_terminal_change(list(request["command"]))
                proposal["workspace"] = str(request.get("workspace", "sandbox"))
                self._json(HTTPStatus.CREATED, {"proposal": proposal})
                return
            if self.path == "/chat":
                self._handle_chat(request)
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        except (KeyError, ValueError, json.JSONDecodeError, NativeClockUnavailable, MacBridgeUnavailable) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except RuntimeError as error:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})

    def _handle_chat(self, request: dict) -> None:
        try:
            message = str(request["message"]).strip()
            conversation_id = request.get("conversation_id")
            if not message:
                raise ValueError("message must not be empty")
            hierarchy = self._parent_and_children(message)
            if hierarchy:
                parent, children = hierarchy
                paths = [parent, *[f"{parent}/{child}" for child in children]]
                proposal = self._run_low_risk_change(
                    f"Create Desktop folder {parent} with children: {', '.join(children)}",
                    [{"kind": "mkdir", "path": path} for path in paths],
                    "desktop",
                )
                child_description = ", ".join(f"“{name}”" for name in children)
                answer = f"Done — I created “{parent}” on your Desktop with {child_description} inside it."
                self._json(HTTPStatus.OK, {"conversation_id": conversation_id, "answer": answer, "proposal": proposal})
                return
            folder_names = self._folder_names(message)
            if folder_names:
                proposal = self._run_low_risk_change(
                    f"Create Desktop folders: {', '.join(folder_names)}",
                    [{"kind": "mkdir", "path": name} for name in folder_names],
                    "desktop",
                )
                description = ", ".join(f"“{name}”" for name in folder_names)
                answer = f"Done — I created {description} on your Desktop. You can roll that action back from Workspace if you want to undo it."
                self._json(HTTPStatus.OK, {"conversation_id": conversation_id, "answer": answer, "proposal": proposal})
                return
            # A folder request with no extractable names is a clarification case,
            # not a capability question. Narrow on purpose: it must look like an
            # action, so "which folder should I use?" still reaches the model.
            if self._looks_like_local_action(message) and re.search(r"\bfolders?\b", message, re.IGNORECASE):
                answer = "Sure — what should I name them, and should they go on your Desktop?"
                self._json(HTTPStatus.OK, {"conversation_id": conversation_id, "answer": answer})
                return
            timer_match = re.search(r"(?:set|start)\s+(?:a\s+)?(?:timer\s+for\s+)?(\d+)\s*(second|seconds|minute|minutes|hour|hours)\s*(?:timer)?", message, re.IGNORECASE)
            if timer_match:
                amount = int(timer_match.group(1))
                unit = timer_match.group(2).lower()
                seconds = amount * (3600 if unit.startswith("hour") else 60 if unit.startswith("minute") else 1)
                self.server.mac_bridge.request("set_clock_timer", {"seconds": str(seconds), "label": "Orion timer"})
                answer = f"Done — I set a {amount} {unit} timer in the Mac Clock app."
                self._json(HTTPStatus.OK, {"conversation_id": conversation_id, "answer": answer})
                return
            reminder_match = re.search(
                r"\bremind\s+me\s+in\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours)\s+(?:to\s+)?(.+?)[.!?]*$",
                message,
                re.IGNORECASE,
            )
            if reminder_match:
                amount = int(reminder_match.group(1))
                unit = reminder_match.group(2).lower()
                seconds = amount * (3600 if unit.startswith("hour") else 60 if unit.startswith("minute") else 1)
                body = reminder_match.group(3).strip()
                self._schedule_reminder(seconds, body)
                self._json(HTTPStatus.OK, {"conversation_id": conversation_id, "answer": f"Done — I’ll remind you to {body} in {amount} {unit}."})
                return
            if self._looks_like_local_action(message):
                answer, proposal = self._execute_structured_plan(message)
                self._json(HTTPStatus.OK, {"conversation_id": conversation_id, "answer": answer, "proposal": proposal})
                return
            conversation_id, answer = self.server.runtime.respond(message, conversation_id)
            self._json(HTTPStatus.OK, {"conversation_id": conversation_id, "answer": answer})
        except (KeyError, ValueError, NativeClockUnavailable, MacBridgeUnavailable, PlanError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


def serve(data_path: Path, model: str, port: int = 8765) -> None:
    server = OrionServer(("127.0.0.1", port), data_path, model)
    print(f"Orion runtime is ready at http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nOrion runtime stopped.")
    finally:
        server.scheduler.stop()
        server.server_close()
        server.runtime.store.close()
